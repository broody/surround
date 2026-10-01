// Surround's matchmaker: pairs players for rated games (quick match and
// brokered open tables), signs their tickets, gathers both wallets'
// signatures over each game's terms and registers the game with a keeper that
// referees it, and reports every settled rated game to SurroundRatings
// (`rate`). It holds the matchmaker key and an account that pays for `rate`,
// and keeps what the chain can't give back in a store (store.mjs); see
// README.md for its trust model.
import { randomBytes } from 'node:crypto';
import * as p from '../sdk/src/index.mjs';
import * as c from '../sdk/src/client.mjs';
import * as rating from '../sdk/src/rating.mjs';
import { RATED, VOID, VOID_SHORT } from './chain.mjs';
import { Lobby, LobbyError } from './pairing.mjs';
import { memoryStore } from './store.mjs';

const SETTLED = 4;
const SEATS = ['black', 'white'];
/** The layout of the stored state; a store holding another is refused. */
const SNAPSHOT_VERSION = 2;
/** Largest distance a request's `at` may be from the matchmaker's clock, in seconds. */
const REQUEST_SKEW = 120;
/** How long a read of the contract's starting bands is trusted. */
const BANDS_MS = 60_000;
/** Time a keeper gets to show a game after its ticket expires, before a game it doesn't hold counts as over. */
const EXPIRY_SLACK_MS = 30_000;
/** How long a keeper gets to answer a request. */
const KEEPER_MS = 10_000;

export const BAND_NAMES = { 1: '23k', 2: '17k', 3: '6k', 4: '1k' };
export const DEFAULTS = { ticket_seconds: 240, sign_seconds: 60, max_rate_attempts: 3, min_table_games: 5 };

/** A starting band's rank in tenths: 23k, 17k, 6k, 1k. */
export const bandRank = band => rating.rankTenths(rating.start(band).mu);
const bandList = mask => Object.entries(BAND_NAMES).filter(([b]) => mask & (1 << Number(b))).map(([b, name]) => `${b} (${name})`).join(', ');
const playerOf = body => { try { return p.hex(p.felt(body.player)); } catch { throw new LobbyError(400, 'Invalid player'); } };
/** The band a request names, if any (0 or none: no band). */
const bandOf = body => (body.band == null || Number(body.band) === 0 ? undefined : Number(body.band));
/** The session key a request asks to play with: a nonzero felt. */
const keyOf = body => {
  let key = 0n;
  try { key = p.felt(body.key); } catch { /* refused below */ }
  if (key === 0n) throw new LobbyError(400, 'Invalid session key');
  return p.hex(key);
};
/** A wallet's signature as it returned it, an array of felts or `{ r, s }`, in hex. */
function walletSignature(signature) {
  try {
    if (Array.isArray(signature) && signature.length > 0) return signature.map(x => p.hex(p.felt(x)));
    if (signature?.r != null && signature?.s != null) return { r: p.hex(p.felt(signature.r)), s: p.hex(p.felt(signature.s)) };
  } catch { /* refused below */ }
  throw new LobbyError(400, 'Invalid signature');
}
/** Terms as JSON, felts as hex, and back (`goTerms` revives them). */
const termsJson = terms => JSON.parse(p.json(terms));
const reviveTerms = t => p.goTerms({ ...t, ...t.config });

/**
 * The keepers that referee rated games, in order of preference: `keepers`
 * ([{ url, referee }], `referee` the keeper's referee public key), or the
 * older `keeper_url` and `referee` as a list of one.
 */
export function keepersOf(config) {
  const list = config.keepers ?? (config.keeper_url ? [{ url: config.keeper_url, referee: config.referee }] : []);
  if (!list.length) throw Error('Configure the keepers that referee rated games (`keepers`)');
  return list.map(({ url, referee }) => ({ url: String(url).replace(/\/$/, ''), referee: p.felt(referee) }));
}

/**
 * `config`: { chain_id, channel, prover, matchmakerKey, keepers, clocks: {
 * name: time control settings }, boards: { size: komi_half },
 * response_seconds, ticket_seconds, sign_seconds, from_block, max_fee_fri,
 * max_rate_attempts, min_table_games, rules }. `chain`: see chain.mjs.
 * `now()` is the wall clock in milliseconds. `store`: see store.mjs. `fetch`
 * reaches the keepers.
 */
export class Matchmaker {
  /** A matchmaker restored from its store; with nothing stored, it rebuilds its games from the chain. */
  static async open(config, chain, options = {}) {
    const matchmaker = new Matchmaker(config, chain, options);
    await matchmaker.#restore();
    return matchmaker;
  }

  constructor(config, chain, { now = Date.now, log = () => {}, store = memoryStore(), fetch = globalThis.fetch } = {}) {
    // `join_seconds` is `sign_seconds`' old name.
    this.config = { ...DEFAULTS, ...config, sign_seconds: config.sign_seconds ?? config.join_seconds ?? DEFAULTS.sign_seconds };
    this.keepers = keepersOf(config);
    this.chain = chain;
    this.now = now;
    this.log = log;
    this.store = store;
    // A keeper that doesn't answer holds up no round for long.
    this.fetch = (url, init = {}) => fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(KEEPER_MS) });
    this.key = p.publicKey(config.matchmakerKey);
    this.lobby = new Lobby(config.rules);
    this.tickets = new Map();     // digest -> a pairing: its ticket, terms, keeper and signatures (see #issue), until its game is over
    this.assigned = new Map();    // player -> digest of their pairing's ticket
    this.games = new Map();       // game_id -> a rated game the chain opened (see #accepted), until rated or void
    this.sessions = new Map();    // digest -> the keeper's copy of a registered game, as far as followed (not stored)
    this.cursor = config.from_block ?? 0;
    this.seen = new Map();        // request replay guard: `player:nonce` -> expiry ms
    this.pausedUntil = 0;         // no pairing before then, or while `rebuilding`
    this.rebuilding = false;
    this.issuing = new Map();     // keeper url -> pairings given to it and not yet ticketed
    this.bands = null;            // { mask, at }
    this.saving = Promise.resolve();
  }

  // A store holding `{}` is one that exists with nothing in it: a matchmaker
  // key that never issued a ticket starts at once.
  async #restore() {
    const state = await this.store.load();
    if (state === null) {
      // Tickets issued before the store was lost may still be played, and
      // can't be found onchain until their games settle: pair no one for one
      // ticket life.
      this.pausedUntil = this.now() + (this.config.ticket_seconds + 60) * 1000;
      this.rebuilding = true;
      this.log(`nothing stored: rebuilding games from block ${this.cursor}; pairing resumes at ${new Date(this.pausedUntil).toISOString()}`);
      return;
    }
    if (state.version !== undefined && state.version !== SNAPSHOT_VERSION)
      throw Error(`The store holds the matchmaker's state version ${state.version}, not ${SNAPSHOT_VERSION}`);
    this.cursor = state.cursor ?? this.cursor;
    for (const t of state.tickets ?? []) {
      const entry = { ...t, digest: BigInt(t.digest), ticket: c.reviveTicket(t.ticket),
        signature: { r: BigInt(t.signature.r), s: BigInt(t.signature.s) }, terms: reviveTerms(t.terms) };
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
      version: SNAPSHOT_VERSION, cursor: this.cursor,
      tickets: [...this.tickets.values()].map(t => ({ digest: p.hex(t.digest), pairing: t.pairing, ticket: c.ticketJson(t.ticket),
        signature: { r: p.hex(t.signature.r), s: p.hex(t.signature.s) }, expires_ms: t.expires_ms, sign_by_ms: t.sign_by_ms,
        keeper: t.keeper, terms: termsJson(t.terms), signatures: t.signatures, registered: t.registered })),
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
    const { chain_id, channel, prover, clocks, boards, response_seconds, sign_seconds, min_table_games } = this.config;
    const mask = await this.startBands();
    return { chain_id: p.hex(chain_id), channel: p.hex(channel), prover: p.hex(prover), matchmaker: p.hex(this.key), boards,
      response_seconds, sign_seconds, min_table_games, clocks,
      keepers: this.keepers.map(k => ({ url: k.url, referee: p.hex(k.referee) })),
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
    let nonce, key;
    try { nonce = p.felt(body.nonce); } catch { throw new LobbyError(400, 'Invalid nonce'); }
    try { key = p.felt(body.key ?? 0); } catch { throw new LobbyError(400, 'Invalid session key'); }
    for (const [k, until] of this.seen) if (until < nowMs) this.seen.delete(k);
    const seenKey = `${player}:${p.hex(nonce)}`;
    if (this.seen.has(seenKey)) throw new LobbyError(401, 'Replayed request');
    // Held while the signature is checked, so a concurrent copy is refused too;
    // kept until `at` is too old to pass the check above anyway.
    this.seen.set(seenKey, (at + REQUEST_SKEW + 1) * 1000);
    const typed = c.matchmakerRequest({ chainId: this.config.chain_id, action, player, size: body.size ?? 0,
      clock: body.clock ?? '', band: body.band ?? 0, table: body.table ?? '', key, at, nonce });
    let ok = false;
    try { ok = await this.chain.verify(player, typed, body.signature); } catch { ok = false; }
    if (!ok) {
      this.seen.delete(seenKey);
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
    return { player: playerOf(body), key: keyOf(body), size, clock, band: bandOf(body) };
  }

  /**
   * Refuse a session key that another player waiting, hosting or paired
   * already uses: two seats of one game must not share a key.
   */
  #freshKey(player, key) {
    const holders = [...[...this.lobby.queue.values()].map(e => [e.player, e.key]),
      ...[...this.lobby.tables.values()].map(e => [e.host, e.key]),
      ...[...this.tickets.values()].flatMap(({ pairing: q }) => [[q.black, q.black_key], [q.white, q.white_key]])];
    if (holders.some(([holder, k]) => holder !== player && k === key)) throw new LobbyError(409, 'Session key in use');
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
    const ranked = await this.rank(entry.player, entry.band);
    this.#freshKey(entry.player, entry.key);
    this.lobby.enqueue({ ...entry, ...ranked }, this.now());
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
    const ranked = await this.rank(entry.player, entry.band);
    this.#freshKey(entry.player, entry.key);
    const table = this.lobby.host({ ...entry, ...ranked }, this.now());
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
    const player = playerOf(body), key = keyOf(body);
    if (!this.lobby.tables.has(id)) throw new LobbyError(404, 'No such table');
    await this.#tableReady(player);
    const ranked = await this.rank(player, bandOf(body));
    if (!this.#pairingOpen()) throw new LobbyError(503, 'Pairing resumes a few minutes after a restart');
    const rooms = await this.#rooms();
    this.#freshKey(player, key);
    const keeper = this.#reserve(rooms);
    if (!keeper) throw new LobbyError(503, 'Every keeper is full; try again shortly');
    let pairing;
    try { pairing = this.lobby.join(id, { player, key, ...ranked }, this.now()); } catch (e) { this.#release(keeper); throw e; }
    await this.#issue(pairing, keeper);
    return this.status(player);
  }

  tables() {
    return [...this.lobby.tables.values()].map(({ id, host, size, clock, rank }) => ({ id, host, size, clock, rank_tenths: rank }));
  }

  /**
   * A player's queue state, or their pairing until its game is over: the
   * ticket, the game's terms (felts as hex) and keeper, who signed the terms,
   * and whether the keeper holds the game (`ready`).
   */
  status(player) {
    player = playerOf({ player });
    const digest = this.assigned.get(player);
    if (digest) {
      const t = this.tickets.get(digest);
      return { status: 'paired', color: t.pairing.black === player ? 'black' : 'white', ticket: c.ticketJson(t.ticket),
        signature: { r: p.hex(t.signature.r), s: p.hex(t.signature.s) }, digest: p.hex(digest),
        game_id: p.hex(t.terms.game_id), terms: termsJson(t.terms), keeper: t.keeper, sign_by: t.sign_by_ms,
        signed: { black: t.signatures.black !== null, white: t.signatures.white !== null }, ready: t.registered };
    }
    if (this.lobby.queue.has(player)) return { status: 'waiting', since: this.lobby.queue.get(player).since };
    return { status: 'none' };
  }

  /**
   * A seat's wallet signature over its game's terms (`goTermsTypedData`),
   * checked through its account: it authenticates the request. Once both
   * seats signed, the game goes to its keeper.
   */
  async sign(digest, body) {
    let t;
    try { t = this.tickets.get(p.felt(digest)); } catch { throw new LobbyError(400, 'Invalid digest'); }
    if (!t) throw new LobbyError(404, 'No such pairing');
    const player = playerOf(body), seat = SEATS.find(s => t.pairing[s] === player);
    if (!seat) throw new LobbyError(401, 'Not a player of this game');
    const signature = walletSignature(body.signature);
    // After the deadline, the next round blames whoever hadn't signed.
    if (t.signatures[seat] === null && this.now() > t.sign_by_ms) throw new LobbyError(409, 'Too late to sign');
    let ok = false;
    try { ok = await this.chain.verify(player, c.goTermsTypedData(t.terms), signature); } catch { ok = false; }
    if (!ok) throw new LobbyError(401, 'Bad signature');
    if (this.#live(t) && t.signatures[seat] === null) {
      t.signatures[seat] = signature;
      this.log(`${player} (${seat}) signed game ${p.hex(t.terms.game_id)}`);
      await this.#save();
    }
    if (this.#live(t) && t.signatures.black && t.signatures.white && !t.registered) await this.#register(t);
    return this.status(player);
  }

  #pairingOpen() { return !this.rebuilding && this.now() >= this.pausedUntil; }

  /** Whether `t` is still a pairing in play (not ended while we awaited). */
  #live(t) { return this.tickets.get(t.digest) === t; }

  #keeper(url) { return new c.KeeperClient(url, { fetch: this.fetch }); }

  /** A keeper's free capacity (`GET /info`); none if it doesn't answer or referees with another key than configured. */
  async #keeperFree(keeper) {
    try {
      const response = await this.fetch(`${keeper.url}/info`);
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const info = await response.json();
      // A game whose clock names a key the keeper doesn't hold could never be played.
      if (info.referee == null || p.felt(info.referee) !== keeper.referee)
        throw Error(`it referees with ${info.referee ?? 'no key'}, not ${p.hex(keeper.referee)}`);
      const free = info.capacity?.free;
      if (free == null) throw Error('no capacity reported');
      return Number(free.$n ?? free);
    } catch (e) {
      this.log(`keeper ${keeper.url} has no room (${e.message})`);
      return 0;
    }
  }

  /** Games this matchmaker gave `url` that it doesn't hold yet: its `/info` doesn't count them. */
  #pending(url) {
    let n = this.issuing.get(url) ?? 0;
    for (const t of this.tickets.values()) if (t.keeper === url && !t.registered) n++;
    return n;
  }

  /** Each keeper's room for new games: its free capacity less our games pending on it. */
  async #rooms() {
    const free = await Promise.all(this.keepers.map(k => this.#keeperFree(k)));
    return this.keepers.map((keeper, i) => ({ keeper, room: Math.max(0, free[i] - this.#pending(keeper.url)) }));
  }

  /** The first keeper in `rooms` with room, holding it until the pairing's ticket is issued; null if none has. */
  #reserve(rooms) {
    const r = rooms.find(r => r.room > 0);
    if (!r) return null;
    r.room--;
    this.issuing.set(r.keeper.url, (this.issuing.get(r.keeper.url) ?? 0) + 1);
    return r.keeper;
  }

  #release(keeper) { this.issuing.set(keeper.url, this.issuing.get(keeper.url) - 1); }

  /** Pair the queue and sign tickets for every new pairing, as far as the keepers have room. */
  async pair() {
    if (!this.#pairingOpen() || this.lobby.queue.size < 2) return;
    const rooms = await this.#rooms();
    const pairings = this.lobby.pair(this.now(), rooms.reduce((n, r) => n + r.room, 0));
    const keepers = pairings.map(() => this.#reserve(rooms));
    for (const [i, pairing] of pairings.entries()) {
      try { await this.#issue(pairing, keepers[i]); } catch (e) { this.log(`no ticket for ${pairing.black} and ${pairing.white}: ${e.message}`); }
    }
  }

  /** Sign a pairing's ticket for a game refereed by `keeper`, and build the game's terms for both wallets to sign. */
  async #issue(pairing, keeper) {
    const cfg = this.config;
    let digest = null;
    try {
      const at = await this.chain.now();
      const ticket = {
        chain_id: BigInt(cfg.chain_id), channel: BigInt(cfg.channel), black: BigInt(pairing.black), white: BigInt(pairing.white),
        size: pairing.size, komi_half: cfg.boards[pairing.size],
        clock: { referee: keeper.referee, settings: cfg.clocks[pairing.clock], rng_tip: 0n }, prover: BigInt(cfg.prover),
        response_seconds: cfg.response_seconds, source: pairing.source, black_band: pairing.black_band, white_band: pairing.white_band,
        matchmaker: this.key,
        // A minute of slack before the chain's clock, and the rest of the life
        // for both to sign and the game to start.
        issued_at: at - 60n, expires_at: at + BigInt(cfg.ticket_seconds), nonce: BigInt(`0x${randomBytes(16).toString('hex')}`),
      };
      digest = c.ticketDigest(ticket);
      pairing.digest = p.hex(digest);
      const nowMs = this.now();
      this.tickets.set(digest, { digest, pairing, ticket, signature: c.signTicket(ticket, cfg.matchmakerKey),
        terms: c.ratedTerms(ticket, [pairing.black_key, pairing.white_key]), keeper: keeper.url,
        expires_ms: nowMs + Number(ticket.expires_at - at) * 1000, sign_by_ms: nowMs + cfg.sign_seconds * 1000,
        signatures: { black: null, white: null }, registered: false });
      // Stored before either player sees it: a ticket can't be found onchain until its game settles.
      await this.#save();
    } catch (e) {
      // Neither player ever sees this ticket: the pairing never happened.
      if (digest !== null) this.tickets.delete(digest);
      pairing.digest ??= `unissued:${randomBytes(8).toString('hex')}`;
      this.lobby.finished(pairing);
      throw e;
    } finally {
      this.#release(keeper);
    }
    for (const player of [pairing.black, pairing.white]) this.assigned.set(player, digest);
    this.log(`paired ${pairing.black} (black) and ${pairing.white} on ${pairing.size}x${pairing.size}, ticket ${p.hex(digest)}, keeper ${keeper.url}`);
  }

  /** Register a game both seats signed with its keeper; one attempt at a time. */
  #register(t) {
    t.registering ??= this.#send(t).finally(() => { t.registering = null; });
    return t.registering;
  }

  async #send(t) {
    try {
      await this.#keeper(t.keeper).register(p.goSession(t.terms), {
        authorizations: SEATS.map(seat => t.signatures[seat]),
        // What the keeper's `openCall` hook (keeper-hooks.mjs) opens the game with.
        extras: { ticket: c.ticketJson(t.ticket), signature: { r: p.hex(t.signature.r), s: p.hex(t.signature.s) } },
      });
    } catch (e) {
      this.log(`game ${p.hex(t.terms.game_id)} not registered with ${t.keeper} (${e.message}); retrying`);
      return;
    }
    t.registered = true;
    this.log(`game ${p.hex(t.terms.game_id)} (ticket ${p.hex(t.digest)}) registered with ${t.keeper}`);
    await this.#save();
  }

  /**
   * One round of work: follow the channel's opened rated games and voided
   * games, every pairing's signatures and its game on its keeper, free the
   * players of every game that is over, cool down no-shows and aborters, and
   * rate settled games. Returns the games rated and voided, and the `rate`
   * transactions.
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

  /** A rated game the chain opened from a ticket (SurroundRatings' `TicketUsed`), usually as it settles. */
  #accepted({ digest, game_id, ticket }) {
    if (this.games.has(game_id)) return;
    const black = p.hex(ticket.black), white = p.hex(ticket.white), mine = ticket.matchmaker === this.key;
    // Ours if we remember issuing it: still in play, or over.
    const known = this.tickets.has(digest) || this.lobby.done.has(p.hex(digest));
    // A ticket of ours the store lost: its players are busy until the game settles.
    if (mine && !known) this.lobby.adopt({ black, white, digest: p.hex(digest) });
    // `adopted`: no ticket we remember (another key's, or lost), so no cooldowns.
    this.games.set(game_id, { game_id, digest, ticket, black, white, mine, adopted: !known,
      over: false, winner: null, attempts: 0, stuck: false });
  }

  /** Follow each game the chain opened until it settles, and each pairing until its game is over. */
  async #follow(nowMs) {
    for (const g of [...this.games.values()]) {
      if (g.over) continue;
      const { status, winner } = await this.chain.game(g.game_id);
      if (status === SETTLED) {
        g.winner = winner;
        this.#over(g);
      }
    }
    await Promise.all([...this.tickets.values()].map(t => (t.registered ? this.#watch(t, nowMs) : this.#unregistered(t, nowMs))));
  }

  /** A pairing its keeper doesn't hold yet: registered once both seats signed, else ended at the deadline. */
  async #unregistered(t, nowMs) {
    if (t.signatures.black && t.signatures.white) {
      if (nowMs <= t.expires_ms) return this.#register(t);
      // Its keeper never took it: nobody is at fault.
      this.log(`game ${p.hex(t.terms.game_id)} never reached ${t.keeper} before its ticket expired`);
      return this.#end(t);
    }
    if (nowMs <= t.sign_by_ms) return;
    for (const seat of SEATS) if (t.signatures[seat] === null) this.lobby.missed(t.pairing[seat], nowMs);
    this.#end(t);
  }

  /**
   * A game its keeper holds: over once the keeper's copy is finished, or if
   * the keeper doesn't hold it after its ticket expired. The first look
   * verifies every step; later ones only the new steps.
   */
  async #watch(t, nowMs) {
    const keeper = this.#keeper(t.keeper);
    let session = this.sessions.get(t.digest);
    try {
      if (session) await keeper.pull(session);
      else {
        session = await keeper.load(p.go, t.terms);
        if (session.context !== p.contextHash(p.go, t.terms)) throw Error('the keeper holds other terms');
      }
    } catch (e) {
      // Another branch, or no answer: look again from scratch next round.
      this.sessions.delete(t.digest);
      if (e.status !== 404) this.log(`game ${p.hex(t.terms.game_id)} on ${t.keeper}: ${e.message}`);
      else if (nowMs > t.expires_ms + EXPIRY_SLACK_MS && this.#live(t)) {
        this.log(`game ${p.hex(t.terms.game_id)} is not on ${t.keeper}; its pairing is over`);
        this.#end(t);
      }
      return;
    }
    if (!this.#live(t)) return;
    if (session.env.outcome.finished) this.#end(t);
    else this.sessions.set(t.digest, session);
  }

  /** A pairing is over for matchmaking: its players are free. */
  #end(t) {
    this.lobby.finished(t.pairing);
    this.#drop(t);
  }

  /** A game is over for matchmaking (settled): its players are free. */
  #over(g) {
    g.over = true;
    if (g.mine) this.lobby.finished({ black: g.black, white: g.white, digest: p.hex(g.digest) });
    const t = this.tickets.get(g.digest);
    if (t) this.#drop(t);
  }

  /** Forget a pairing; nobody waits on it any more. */
  #drop(t) {
    for (const player of [t.pairing.black, t.pairing.white]) if (this.assigned.get(player) === t.digest) this.assigned.delete(player);
    this.tickets.delete(t.digest);
    this.sessions.delete(t.digest);
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
