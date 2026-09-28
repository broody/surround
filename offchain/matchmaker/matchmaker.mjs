// Surround's matchmaker: pairs players for rated games (quick match and
// brokered open tables), signs their tickets, and reports every settled rated
// game to SurroundRatings (`rate`). It holds the matchmaker key and an account
// that pays for `rate`; see README.md for its trust model.
import { randomBytes } from 'node:crypto';
import * as p from '../sdk/src/index.mjs';
import * as c from '../sdk/src/client.mjs';
import * as rating from '../sdk/src/rating.mjs';
import { Lobby, LobbyError } from './pairing.mjs';

const SETTLED = 4, CANCELLED = 5;
/** Largest distance a request's `at` may be from the matchmaker's clock, in seconds. */
const REQUEST_SKEW = 120;

/** A starting band's rank in tenths: 23k, 17k, 6k, 1k. */
export const bandRank = band => rating.rankTenths(rating.start(band).mu);

/**
 * `config`: { chain_id, channel, prover, matchmakerKey, clocks: { name: time control },
 * boards: { size: komi_half }, response_seconds, ticket_seconds, from_block, rules }.
 * `chain`: see chain.mjs. `now()` is the wall clock in milliseconds.
 */
export class Matchmaker {
  constructor(config, chain, { now = Date.now, log = () => {} } = {}) {
    this.config = config;
    this.chain = chain;
    this.now = now;
    this.log = log;
    this.lobby = new Lobby(config.rules);
    this.tickets = new Map();     // digest -> { pairing, ticket, signature, digest, expires_ms, game_id?, joined }
    this.assigned = new Map();    // player -> digest of the ticket waiting for them
    this.games = new Map();       // game_id -> pairing (null if issued before a restart), until rated or cancelled
    this.cursor = config.from_block ?? 0;
    this.seen = new Map();        // request replay guard: key -> expiry ms
  }

  info() {
    const { chain_id, channel, prover, clocks, boards, response_seconds } = this.config;
    return { chain_id: p.hex(chain_id), channel: p.hex(channel), prover: p.hex(prover),
      matchmaker: p.hex(p.publicKey(this.config.matchmakerKey)), boards, response_seconds,
      clocks: Object.fromEntries(Object.entries(clocks).map(([k, v]) => [k, { referee: p.hex(v.referee), settings: v.settings }])),
      bands: { 1: '23k', 2: '17k', 3: '6k', 4: '1k' } };
  }

  /** Check a signed request: fresh, not replayed, and signed by `player`'s account. */
  async authenticate(action, body) {
    const at = Number(body.at);
    if (!Number.isInteger(at) || Math.abs(at - this.now() / 1000) > REQUEST_SKEW) throw new LobbyError(401, 'Stale request');
    const key = `${action}:${BigInt(body.player)}:${at}:${body.table ?? ''}`;
    const nowMs = this.now();
    for (const [k, until] of this.seen) if (until < nowMs) this.seen.delete(k);
    if (this.seen.has(key)) throw new LobbyError(401, 'Replayed request');
    const typed = c.matchmakerRequest({ chainId: this.config.chain_id, action, player: body.player, size: body.size ?? 0,
      clock: body.clock ?? '', band: body.band ?? 0, table: body.table ?? '', at });
    let ok = false;
    try { ok = await this.chain.verify(p.hex(body.player), typed, body.signature); } catch { ok = false; }
    if (!ok) throw new LobbyError(401, 'Bad signature');
    this.seen.set(key, nowMs + 2 * REQUEST_SKEW * 1000);
  }

  /** A player's rank in tenths: their rating's, or their starting band's. */
  async rank(player, band) {
    const r = (await this.chain.ranks([p.hex(player)])).get(p.hex(player));
    if (r?.rated) return r.rank_tenths;
    if (!(band >= 1 && band <= 4)) throw new LobbyError(400, 'Choose a starting band (1–4)');
    return bandRank(band);
  }

  #entry(body) {
    const size = Number(body.size), clock = String(body.clock), band = Number(body.band ?? 3);
    if (!(size in this.config.boards)) throw new LobbyError(400, 'Board not rated');
    if (!(clock in this.config.clocks)) throw new LobbyError(400, 'Unknown clock');
    if (!(band >= 1 && band <= 4)) throw new LobbyError(400, 'Invalid band');
    return { player: p.hex(body.player), size, clock, band };
  }

  async enqueue(body) {
    await this.authenticate('queue', body);
    const entry = this.#entry(body);
    this.#free(entry.player);
    this.lobby.enqueue({ ...entry, rank: await this.rank(entry.player, entry.band) }, this.now());
    await this.pair();
    return this.status(entry.player);
  }

  async leave(body) {
    await this.authenticate('leave', body);
    return { left: this.lobby.leave(p.hex(body.player)) };
  }

  async host(body) {
    await this.authenticate('table', body);
    const entry = this.#entry(body);
    this.#free(entry.player);
    return { table: this.lobby.host({ ...entry, rank: await this.rank(entry.player, entry.band) }, this.now()) };
  }

  async close(id, body) {
    await this.authenticate('close', { ...body, table: id });
    this.lobby.close(id, p.hex(body.player));
    return { closed: id };
  }

  async join(id, body) {
    await this.authenticate('join', { ...body, table: id });
    const player = p.hex(body.player), band = Number(body.band ?? 3);
    if (!(band >= 1 && band <= 4)) throw new LobbyError(400, 'Invalid band');
    this.#free(player);
    const pairing = this.lobby.join(id, { player, band, rank: await this.rank(player, band) }, this.now());
    await this.#issue(pairing);
    return this.status(player);
  }

  tables() {
    return [...this.lobby.tables.values()].map(({ id, host, size, clock, rank }) => ({ id, host, size, clock, rank_tenths: rank }));
  }

  /** A player's queue state, or their ticket once paired. */
  status(player) {
    player = p.hex(player);
    const digest = this.assigned.get(player);
    if (digest) {
      const t = this.tickets.get(digest);
      return { status: 'paired', color: t.pairing.black === player ? 'black' : 'white', ticket: c.ticketJson(t.ticket),
        signature: { r: p.hex(t.signature.r), s: p.hex(t.signature.s) }, digest: p.hex(digest) };
    }
    if (this.lobby.queue.has(player)) return { status: 'waiting', since: this.lobby.queue.get(player).since };
    return { status: 'none' };
  }

  /** Pair the queue and sign tickets for every new pairing. */
  async pair() {
    for (const pairing of this.lobby.pair(this.now())) await this.#issue(pairing);
  }

  async #issue(pairing) {
    const cfg = this.config;
    const at = await this.chain.now();
    const ticket = {
      chain_id: BigInt(cfg.chain_id), channel: BigInt(cfg.channel), black: BigInt(pairing.black), white: BigInt(pairing.white),
      size: pairing.size, komi_half: cfg.boards[pairing.size], clock: cfg.clocks[pairing.clock], prover: BigInt(cfg.prover),
      response_seconds: cfg.response_seconds, source: pairing.source, black_band: pairing.black_band, white_band: pairing.white_band,
      matchmaker: p.publicKey(cfg.matchmakerKey),
      // A minute of slack before the chain's clock, and the rest of the life to create and join.
      issued_at: at - 60n, expires_at: at + BigInt(cfg.ticket_seconds ?? 240), nonce: BigInt(`0x${randomBytes(16).toString('hex')}`),
    };
    const digest = c.ticketDigest(ticket);
    const expires_ms = this.now() + Number(ticket.expires_at - at) * 1000;
    this.tickets.set(digest, { pairing, ticket, signature: c.signTicket(ticket, cfg.matchmakerKey), digest, expires_ms, joined: false });
    for (const player of [pairing.black, pairing.white]) this.assigned.set(player, digest);
    this.log(`paired ${pairing.black} (black) and ${pairing.white} on ${pairing.size}x${pairing.size}, ticket ${p.hex(digest)}`);
  }

  /** A new request from a paired player means they're done with that ticket's slot. */
  #free(player) {
    const digest = this.assigned.get(player);
    if (digest && !this.tickets.has(digest)) this.assigned.delete(player);
  }

  /**
   * One round of chain work: learn which tickets became games, penalize
   * no-shows once tickets expire, and rate settled games.
   */
  async tick() {
    await this.pair();
    const { games, to } = await this.chain.ratedGames(this.cursor);
    this.cursor = to + 1;
    for (const g of games) {
      const t = this.tickets.get(g.ticket);
      if (t && t.game_id === undefined) t.game_id = g.game_id;
      if (!this.games.has(g.game_id)) this.games.set(g.game_id, t?.pairing ?? null);
    }
    const nowMs = this.now();
    for (const [digest, t] of this.tickets) {
      if (t.game_id !== undefined && !t.joined) t.joined = (await this.chain.playedAt(t.game_id)) !== 0;
      // A joined game stays open (in `games`) until it is rated or cancelled.
      if (t.joined) { this.#release(t); this.tickets.delete(digest); continue; }
      if (nowMs <= t.expires_ms) continue;
      // Expired unused: black never created it, or white never joined.
      this.lobby.missed(t.game_id === undefined ? t.pairing.black : t.pairing.white, nowMs);
      this.lobby.finished(t.pairing);
      this.#release(t);
      this.tickets.delete(digest);
      if (t.game_id !== undefined) this.games.delete(t.game_id);
    }
    const due = [];
    for (const gameId of this.games.keys()) {
      const status = await this.chain.status(gameId);
      if (status === CANCELLED || (status === SETTLED && (await this.chain.rated(gameId)) !== 0)) this.#finish(gameId);
      else if (status === SETTLED) due.push(gameId);
    }
    let tx = null;
    if (due.length) {
      tx = await this.chain.rate(due);
      this.log(`rated ${due.map(p.hex).join(', ')} in ${tx}`);
      for (const gameId of due) this.#finish(gameId);
    }
    return { rated: due, tx };
  }

  #release(t) {
    for (const player of [t.pairing.black, t.pairing.white]) if (this.assigned.get(player) === t.digest) this.assigned.delete(player);
  }

  /** A game is over for matchmaking: its players may be paired again. */
  #finish(gameId) {
    const pairing = this.games.get(gameId);
    this.games.delete(gameId);
    if (pairing) this.lobby.finished(pairing);
  }
}
