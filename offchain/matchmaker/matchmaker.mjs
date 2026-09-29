// Surround's matchmaker: pairs players for rated games (quick match and
// brokered open tables), signs their tickets, and reports every settled rated
// game to SurroundRatings (`rate`). It holds the matchmaker key and an account
// that pays for `rate`, and keeps what the chain can't give back in a store
// (store.mjs); see README.md for its trust model.
import { randomBytes } from 'node:crypto';
import * as p from '../sdk/src/index.mjs';
import * as c from '../sdk/src/client.mjs';
import * as rating from '../sdk/src/rating.mjs';
import { RATED, VOID, VOID_SHORT } from './chain.mjs';
import { Lobby, LobbyError } from './pairing.mjs';
import { memoryStore } from './store.mjs';

const SETTLED = 4, CANCELLED = 5;
/** Largest distance a request's `at` may be from the matchmaker's clock, in seconds. */
const REQUEST_SKEW = 120;
/** How long a read of the contract's starting bands is trusted. */
const BANDS_MS = 60_000;
/** Time for the chain to show a creation or a join before a ticket counts as unused. */
const EXPIRY_SLACK_MS = 30_000;

export const BAND_NAMES = { 1: '23k', 2: '17k', 3: '6k', 4: '1k' };
export const DEFAULTS = { ticket_seconds: 240, join_seconds: 60, max_rate_attempts: 3, min_table_games: 5 };

/** A starting band's rank in tenths: 23k, 17k, 6k, 1k. */
export const bandRank = band => rating.rankTenths(rating.start(band).mu);
const bandList = mask => Object.entries(BAND_NAMES).filter(([b]) => mask & (1 << Number(b))).map(([b, name]) => `${b} (${name})`).join(', ');
const playerOf = body => { try { return p.hex(p.felt(body.player)); } catch { throw new LobbyError(400, 'Invalid player'); } };
/** The band a request names, if any (0 or none: no band). */
const bandOf = body => (body.band == null || Number(body.band) === 0 ? undefined : Number(body.band));

/**
 * `config`: { chain_id, channel, prover, matchmakerKey, clocks: { name: time control },
 * boards: { size: komi_half }, response_seconds, ticket_seconds, join_seconds, from_block,
 * max_fee_fri, max_rate_attempts, min_table_games, keeper_url, rules }.
 * `chain`: see chain.mjs. `now()` is the wall clock in milliseconds. `store`:
 * see store.mjs. `fetch` reads the keeper's `/info`.
 */
export class Matchmaker {
  /** A matchmaker restored from its store; with nothing stored, it rebuilds its games from the chain. */
  static async open(config, chain, options = {}) {
    const matchmaker = new Matchmaker(config, chain, options);
    await matchmaker.#restore();
    return matchmaker;
  }

  constructor(config, chain, { now = Date.now, log = () => {}, store = memoryStore(), fetch = globalThis.fetch } = {}) {
    this.config = { ...DEFAULTS, ...config };
    this.chain = chain;
    this.now = now;
    this.log = log;
    this.store = store;
    this.fetch = fetch;
    this.key = p.publicKey(config.matchmakerKey);
    this.lobby = new Lobby(config.rules);
    this.tickets = new Map();     // digest -> { digest, pairing, ticket, signature, expires_ms, game_id? }, until joined or over
    this.assigned = new Map();    // player -> digest of the ticket waiting for them
    this.games = new Map();       // game_id -> the game of an accepted ticket (see #accepted), until rated or void
    this.cursor = config.from_block ?? 0;
    this.seen = new Map();        // request replay guard: `player:nonce` -> expiry ms
    this.pausedUntil = 0;         // no pairing before then, or while `rebuilding`
    this.rebuilding = false;
    this.issuing = 0;             // pairings not yet ticketed
    this.bands = null;            // { mask, at }
    this.saving = Promise.resolve();
  }

  // A store holding `{}` is one that exists with nothing in it: a matchmaker
  // key that never issued a ticket starts at once.
  async #restore() {
    const state = await this.store.load();
    if (state === null) {
      // Tickets issued before the store was lost may still be used, and can't
      // be found onchain until they are: pair no one for one ticket life.
      this.pausedUntil = this.now() + (this.config.ticket_seconds + 60) * 1000;
      this.rebuilding = true;
      this.log(`nothing stored: rebuilding games from block ${this.cursor}; pairing resumes at ${new Date(this.pausedUntil).toISOString()}`);
      return;
    }
    this.cursor = state.cursor ?? this.cursor;
    for (const t of state.tickets ?? []) {
      const entry = { digest: BigInt(t.digest), pairing: t.pairing, ticket: c.reviveTicket(t.ticket),
        signature: { r: BigInt(t.signature.r), s: BigInt(t.signature.s) }, expires_ms: t.expires_ms,
        game_id: t.game_id === null ? undefined : BigInt(t.game_id) };
      this.tickets.set(entry.digest, entry);
      for (const player of [t.pairing.black, t.pairing.white]) this.assigned.set(player, entry.digest);
    }
    for (const g of state.games ?? []) {
      const game_id = BigInt(g.game_id);
      this.games.set(game_id, { ...g, game_id, digest: BigInt(g.digest), ticket: c.reviveTicket(g.ticket) });
    }
    this.seen = new Map(state.seen ?? []);
    this.lobby.restore(state.lobby ?? {});
  }

  #snapshot() {
    return {
      version: 1, cursor: this.cursor,
      tickets: [...this.tickets.values()].map(t => ({ digest: p.hex(t.digest), pairing: t.pairing, ticket: c.ticketJson(t.ticket),
        signature: { r: p.hex(t.signature.r), s: p.hex(t.signature.s) }, expires_ms: t.expires_ms,
        game_id: t.game_id === undefined ? null : p.hex(t.game_id) })),
      games: [...this.games.values()].map(g => ({ ...g, game_id: p.hex(g.game_id), digest: p.hex(g.digest), ticket: c.ticketJson(g.ticket) })),
      seen: [...this.seen],
      lobby: this.lobby.snapshot(),
    };
  }

  /** Write the current state; writes land in order. */
  #save() {
    const state = this.#snapshot();
    const saved = this.saving.then(() => this.store.save(state));
    this.saving = saved.catch(() => {});
    return saved;
  }

  async info() {
    const { chain_id, channel, prover, clocks, boards, response_seconds, min_table_games } = this.config;
    const mask = await this.startBands();
    return { chain_id: p.hex(chain_id), channel: p.hex(channel), prover: p.hex(prover), matchmaker: p.hex(this.key), boards,
      response_seconds, min_table_games,
      clocks: Object.fromEntries(Object.entries(clocks).map(([k, v]) => [k, { referee: p.hex(v.referee), settings: v.settings }])),
      bands: Object.fromEntries(Object.entries(BAND_NAMES).filter(([b]) => mask & (1 << Number(b)))) };
  }

  /** Whether pairing is open, and the games whose rating stopped after `max_rate_attempts`. */
  health() {
    return { ok: true, pairing: this.#pairingOpen(),
      stuck: [...this.games.values()].filter(g => g.stuck).map(g => p.hex(g.game_id)) };
  }

  /** Check a signed request: fresh, its nonce never seen, and signed by `player`'s account. */
  async authenticate(action, body) {
    const at = Number(body.at), nowMs = this.now();
    if (!Number.isInteger(at) || Math.abs(at - nowMs / 1000) > REQUEST_SKEW) throw new LobbyError(401, 'Stale request');
    const player = playerOf(body);
    let nonce;
    try { nonce = p.felt(body.nonce); } catch { throw new LobbyError(400, 'Invalid nonce'); }
    for (const [k, until] of this.seen) if (until < nowMs) this.seen.delete(k);
    const key = `${player}:${p.hex(nonce)}`;
    if (this.seen.has(key)) throw new LobbyError(401, 'Replayed request');
    // Held while the signature is checked, so a concurrent copy is refused too;
    // kept until `at` is too old to pass the check above anyway.
    this.seen.set(key, (at + REQUEST_SKEW + 1) * 1000);
    const typed = c.matchmakerRequest({ chainId: this.config.chain_id, action, player, size: body.size ?? 0,
      clock: body.clock ?? '', band: body.band ?? 0, table: body.table ?? '', at, nonce });
    let ok = false;
    try { ok = await this.chain.verify(player, typed, body.signature); } catch { ok = false; }
    if (!ok) {
      this.seen.delete(key);
      throw new LobbyError(401, 'Bad signature');
    }
  }

  /** The starting bands a new player may choose (bit b for band b), as the contract last said. */
  async startBands() {
    const nowMs = this.now();
    if (!this.bands || nowMs - this.bands.at > BANDS_MS) this.bands = { mask: await this.chain.startBands(), at: nowMs };
    return this.bands.mask;
  }

  /**
   * A player's rank in tenths and the band their ticket names. A rated
   * player's rank is their rating's, and their band isn't used (the contract
   * only checks its range). A new player must choose a starting band the
   * contract allows; there is no default.
   */
  async rank(player, band) {
    const r = (await this.chain.ranks([player])).get(player);
    if (r?.rated) {
      if (band !== undefined && !(band >= 1 && band <= 4)) throw new LobbyError(400, 'Invalid band');
      return { rank: r.rank_tenths, band: band ?? 1 };
    }
    const mask = await this.startBands();
    if (!(band >= 1 && band <= 4 && mask & (1 << band))) throw new LobbyError(400, `Choose a starting band: ${bandList(mask)}`);
    return { rank: bandRank(band), band };
  }

  #entry(body) {
    const size = Number(body.size), clock = String(body.clock);
    if (!(size in this.config.boards)) throw new LobbyError(400, 'Board not rated');
    if (!(clock in this.config.clocks)) throw new LobbyError(400, 'Unknown clock');
    return { player: playerOf(body), size, clock, band: bandOf(body) };
  }

  /** Open tables are for players with `min_table_games` rated games. */
  async #tableReady(player) {
    const min = this.config.min_table_games;
    if (min > 0 && (await this.chain.games(player)) < min)
      throw new LobbyError(403, `Open tables need ${min} rated games; play in the queue first`);
  }

  async enqueue(body) {
    await this.authenticate('queue', body);
    const entry = this.#entry(body);
    this.lobby.enqueue({ ...entry, ...(await this.rank(entry.player, entry.band)) }, this.now());
    await this.pair();
    await this.#save();
    return this.status(entry.player);
  }

  async leave(body) {
    await this.authenticate('leave', body);
    const left = this.lobby.leave(playerOf(body));
    await this.#save();
    return { left };
  }

  async host(body) {
    await this.authenticate('table', body);
    const entry = this.#entry(body);
    await this.#tableReady(entry.player);
    const table = this.lobby.host({ ...entry, ...(await this.rank(entry.player, entry.band)) }, this.now());
    await this.#save();
    return { table };
  }

  async close(id, body) {
    await this.authenticate('close', { ...body, table: id });
    this.lobby.close(id, playerOf(body));
    await this.#save();
    return { closed: id };
  }

  async join(id, body) {
    await this.authenticate('join', { ...body, table: id });
    const player = playerOf(body);
    if (!this.lobby.tables.has(id)) throw new LobbyError(404, 'No such table');
    await this.#tableReady(player);
    const ranked = await this.rank(player, bandOf(body));
    if (!this.#pairingOpen()) throw new LobbyError(503, 'Pairing resumes a few minutes after a restart');
    if (this.#room(await this.#keeperFree()) < 1) throw new LobbyError(503, 'The referee is full; try again shortly');
    const pairing = this.lobby.join(id, { player, ...ranked }, this.now());
    this.issuing++;
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

  #pairingOpen() { return !this.rebuilding && this.now() >= this.pausedUntil; }

  /** Games the keeper can still take for us: its free capacity less our tickets whose games haven't joined. */
  #room(free) { return free - this.tickets.size - this.issuing; }

  /** The free capacity of the keeper that referees rated games (`GET /info`); unlimited without `keeper_url`. */
  async #keeperFree() {
    const url = this.config.keeper_url;
    if (!url) return Infinity;
    try {
      const response = await this.fetch(`${url.replace(/\/$/, '')}/info`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const free = (await response.json()).capacity?.free;
      if (free == null) throw Error('no capacity reported');
      return Number(free.$n ?? free);
    } catch (e) {
      this.log(`keeper capacity unknown (${e.message}); pairing no one`);
      return 0;
    }
  }

  /** Pair the queue and sign tickets for every new pairing, as far as the keeper has room. */
  async pair() {
    if (!this.#pairingOpen() || this.lobby.queue.size < 2) return;
    const free = await this.#keeperFree();
    const pairings = this.lobby.pair(this.now(), Math.max(0, this.#room(free)));
    this.issuing += pairings.length;
    for (const pairing of pairings) {
      try { await this.#issue(pairing); } catch (e) { this.log(`no ticket for ${pairing.black} and ${pairing.white}: ${e.message}`); }
    }
  }

  async #issue(pairing) {
    const cfg = this.config;
    let digest = null;
    try {
      const at = await this.chain.now();
      const ticket = {
        chain_id: BigInt(cfg.chain_id), channel: BigInt(cfg.channel), black: BigInt(pairing.black), white: BigInt(pairing.white),
        size: pairing.size, komi_half: cfg.boards[pairing.size], clock: cfg.clocks[pairing.clock], prover: BigInt(cfg.prover),
        response_seconds: cfg.response_seconds, source: pairing.source, black_band: pairing.black_band, white_band: pairing.white_band,
        matchmaker: this.key,
        // A minute of slack before the chain's clock, and the rest of the life to create and join.
        issued_at: at - 60n, expires_at: at + BigInt(cfg.ticket_seconds), nonce: BigInt(`0x${randomBytes(16).toString('hex')}`),
      };
      digest = c.ticketDigest(ticket);
      pairing.digest = p.hex(digest);
      this.tickets.set(digest, { digest, pairing, ticket, signature: c.signTicket(ticket, cfg.matchmakerKey),
        expires_ms: this.now() + Number(ticket.expires_at - at) * 1000 });
      // Stored before either player sees it: an unused ticket can't be found onchain.
      await this.#save();
    } catch (e) {
      // Neither player ever sees this ticket: the pairing never happened.
      if (digest !== null) this.tickets.delete(digest);
      pairing.digest ??= `unissued:${randomBytes(8).toString('hex')}`;
      this.lobby.finished(pairing);
      throw e;
    } finally {
      this.issuing--;
    }
    for (const player of [pairing.black, pairing.white]) this.assigned.set(player, digest);
    this.log(`paired ${pairing.black} (black) and ${pairing.white} on ${pairing.size}x${pairing.size}, ticket ${p.hex(digest)}`);
  }

  /**
   * One round of chain work: follow the channel's accepted tickets and voided
   * games, free the players of every game that is over, cool down no-shows and
   * aborters, and rate settled games. Returns the games rated and voided, and
   * the `rate` transactions.
   */
  async tick() {
    const nowMs = this.now();
    const { events, to } = await this.chain.ratingEvents(this.cursor);
    for (const e of events) {
      if (e.type === 'TicketUsed') this.#accepted(e);
      else {
        const g = this.games.get(e.game_id);
        if (g && g.digest === e.digest) g.void_reason = e.reason;
      }
    }
    this.cursor = to + 1;
    await this.#follow(nowMs);
    const round = await this.#rateSettled();
    this.rebuilding = false;
    await this.#save();
    await this.pair();
    return round;
  }

  /** A game created from a ticket (SurroundRatings' `TicketUsed`). */
  #accepted({ digest, game_id, ticket, created_at }) {
    if (this.games.has(game_id)) return;
    const t = this.tickets.get(digest);
    const black = p.hex(ticket.black), white = p.hex(ticket.white), mine = ticket.matchmaker === this.key;
    if (t) t.game_id = game_id;
    // A ticket of ours the store lost: its players are busy until the game ends.
    else if (mine) this.lobby.adopt({ black, white, digest: p.hex(digest) });
    // `adopted`: no ticket of ours (another key's, or lost), so no cooldowns.
    this.games.set(game_id, { game_id, digest, ticket, black, white, mine, adopted: !t, created_at: created_at ?? 0,
      joined: false, over: false, winner: null, attempts: 0, stuck: false });
  }

  /** Follow each open game and each unused ticket: joins, cancellations, settlements and expiries. */
  async #follow(nowMs) {
    for (const g of [...this.games.values()]) {
      if (g.over) continue;
      const { status, winner } = await this.chain.game(g.game_id);
      if (!g.joined) g.joined = (await this.chain.playedAt(g.game_id)) !== 0;
      const t = this.tickets.get(g.digest);
      if (g.joined && t) this.#drop(t);
      if (status === CANCELLED) {
        // Only black, the creator, can cancel, and only before white joins.
        if (t) this.lobby.missed(g.black, nowMs);
        this.#over(g);
        this.games.delete(g.game_id);
      } else if (status === SETTLED) {
        g.winner = winner;
        this.#over(g);
      } else if (!g.joined && nowMs > (t?.expires_ms ?? Number(g.ticket.expires_at) * 1000) + EXPIRY_SLACK_MS) {
        // White never joined. Black is at fault if it created the game too late for white to.
        const late = g.created_at > Number(g.ticket.expires_at) - this.config.join_seconds;
        if (t) this.lobby.missed(late ? g.black : g.white, nowMs);
        this.#over(g);
        this.games.delete(g.game_id);
      }
    }
    // Tickets never used: black didn't create the game.
    for (const t of [...this.tickets.values()]) {
      if (t.game_id !== undefined || nowMs <= t.expires_ms + EXPIRY_SLACK_MS) continue;
      this.lobby.missed(t.pairing.black, nowMs);
      this.lobby.finished(t.pairing);
      this.#drop(t);
    }
  }

  /** A game is over for matchmaking (settled, cancelled or never joined): its players are free. */
  #over(g) {
    g.over = true;
    if (g.mine) this.lobby.finished({ black: g.black, white: g.white, digest: p.hex(g.digest) });
    const t = this.tickets.get(g.digest);
    if (t) this.#drop(t);
  }

  /** Forget a ticket; nobody waits on it any more. */
  #drop(t) {
    for (const player of [t.pairing.black, t.pairing.white]) if (this.assigned.get(player) === t.digest) this.assigned.delete(player);
    this.tickets.delete(t.digest);
  }

  /** Rate every settled game SurroundRatings hasn't rated or voided yet. */
  async #rateSettled() {
    const due = [];
    for (const g of [...this.games.values()]) {
      if (!g.over || g.stuck) continue;
      if (g.void_reason !== undefined) { this.#voided(g); continue; }
      const { status } = await this.chain.ticketStatus(g.digest);
      if (status === RATED) this.games.delete(g.game_id);
      else if (status === VOID) this.#awaitVoid(g);
      else due.push(g);
    }
    return this.#rate(due);
  }

  /**
   * Rate `due` in batches whose estimated fee fits `max_fee_fri`. A batch that
   * doesn't fit, or can't be estimated, is halved, down to one game per
   * transaction. Then each game sent is rated, voided, or a failed attempt.
   */
  async #rate(due) {
    const cap = this.config.max_fee_fri == null ? null : BigInt(this.config.max_fee_fri);
    const round = { rated: [], voided: [], txs: [] }, sent = [];
    const batches = due.length ? [due] : [];
    while (batches.length) {
      const batch = batches.shift(), games = batch.map(g => ({ game_id: g.game_id, ticket: g.ticket }));
      let why;
      try {
        const estimate = await this.chain.estimateRate(games);
        if (cap === null || estimate.fee <= cap) {
          const tx = await this.chain.rate(games, estimate);
          this.log(`rate ${batch.map(g => p.hex(g.game_id)).join(', ')} in ${tx}`);
          round.txs.push(tx);
          sent.push(...batch);
          continue;
        }
        why = `fee ${estimate.fee} over max_fee_fri ${cap}`;
      } catch (e) {
        why = e.message;
      }
      if (batch.length > 1) {
        const half = Math.ceil(batch.length / 2);
        batches.unshift(batch.slice(0, half), batch.slice(half));
      } else this.#failed(batch[0], why);
    }
    for (const g of sent) {
      const { status } = await this.chain.ticketStatus(g.digest);
      if (status === RATED) {
        this.games.delete(g.game_id);
        round.rated.push(g.game_id);
      } else if (status === VOID) round.voided.push(g.game_id); // its GameVoided event says why, next round
      else this.#failed(g, 'rate changed nothing');
    }
    return { ...round, tx: round.txs.at(-1) ?? null };
  }

  /** A rating attempt that left the ticket accepted. After `max_rate_attempts` in a row, stop and alert. */
  #failed(g, why) {
    g.attempts++;
    if (g.attempts < this.config.max_rate_attempts) return;
    g.stuck = true;
    this.log(`ALERT: game ${p.hex(g.game_id)} (ticket ${p.hex(g.digest)}) still unrated after ${g.attempts} attempts (${why}); not retrying`);
  }

  /** Voided, but its GameVoided event hasn't been read yet: wait a few rounds for it. */
  #awaitVoid(g) {
    g.void_waits = (g.void_waits ?? 0) + 1;
    if (g.void_waits <= this.config.max_rate_attempts) return;
    this.log(`game ${p.hex(g.game_id)} was voided; its GameVoided event never came`);
    this.games.delete(g.game_id);
  }

  /** A voided game. One too short to rate is an abort by whoever lost it (both, in a draw). */
  #voided(g) {
    this.games.delete(g.game_id);
    if (g.void_reason !== VOID_SHORT || g.adopted) return;
    const nowMs = this.now();
    const quitters = g.winner === 1 ? [g.white] : g.winner === 2 ? [g.black] : [g.black, g.white];
    for (const player of quitters) if (this.lobby.aborted(player, nowMs)) this.log(`${player} cools down after repeated aborted games`);
  }
}
