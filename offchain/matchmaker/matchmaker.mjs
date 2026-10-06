// Surround's matchmaker: pairs players for rated games (quick match and
// brokered open tables), signs their tickets, gathers both wallets'
// signatures over each game's terms and registers the game with a keeper that
// referees it, and reports every settled rated game to SurroundRatings
// (`rate`). It holds the matchmaker key and an account that pays for `rate`,
// and keeps what the chain can't give back in a store (store.mjs); see
// README.md for its trust model.
//
// It also pairs players with AI anchors (`anchors` in the config, each pinned
// in SurroundRatings): an anchor's daemon offers session keys ahead of time,
// and a player who asks for that anchor is paired at once.
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
export const DEFAULTS = { ticket_seconds: 240, sign_seconds: 60, max_rate_attempts: 3, min_table_games: 5, max_anchor_keys: 16,
  delegation_seconds: 0 };
/** How long a read of an anchor's pin is trusted. */
const ANCHOR_MS = 60_000;
/** Time an anchor's daemon keeps to sign its side once the player has signed an offer. */
const ANCHOR_SIGN_MS = 15_000;
/** Most AI game offers held at once; past it, the oldest goes. */
const MAX_OFFERS = 1024;
/** The lobby requests a signed-in browser's key may sign: queue, leave, tables, and revoking itself. */
const DELEGABLE = new Set(['queue', 'leave', 'table', 'join', 'close', 'revoke']);
/** Browser keys a player keeps signed in at once; a new one past that revokes the oldest. */
const MAX_DELEGATES = 8;
/**
 * The least a sign-in must still run for its key to agree to a game: the
 * keeper opens a game onchain when it settles, and a rated game on the
 * per-turn clock lasts at most its 1148 steps of 60 s, about 19 hours.
 */
const DELEGATION_MARGIN_SECONDS = 24 * 3600;

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
/** The session key an AI anchor plays its pairing with. */
const anchorKey = pairing => pairing[pairing.black === pairing.anchor ? 'black_key' : 'white_key'];

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
 * max_rate_attempts, min_table_games, delegation_seconds (0: no signing in;
 * the channel's DELEGATION_SECONDS where its keepers take delegations),
 * rules }. `chain`: see chain.mjs.
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
    // The AI anchors this matchmaker pairs players with, and the session keys
    // each offered for its next games (not stored: an anchor offers more).
    // Each anchor is an address, or `{ player, id }` with the id a client
    // shows it by (a character in shared/lobby.ts).
    const anchors = (config.anchors ?? []).map(a => (typeof a === 'object' ? a : { player: a }));
    this.anchors = new Set(anchors.map(a => p.hex(p.felt(a.player))));
    this.anchorIds = new Map(anchors.filter(a => a.id).map(a => [p.hex(p.felt(a.player)), String(a.id)]));
    this.anchorKeys = new Map([...this.anchors].map(a => [a, []]));
    if (this.anchors.size && this.config.sign_seconds * 1000 <= ANCHOR_SIGN_MS)
      throw Error(`AI anchors need sign_seconds over ${ANCHOR_SIGN_MS / 1000}: the player signs an offer first, then the anchor`);
    this.pins = new Map();        // anchor -> { mu, at }: its pin, as the contract last said
    this.offers = new Map();      // digest -> an AI game offered and not signed yet, as `tickets` holds one (not stored)
    this.delegates = new Map();   // player -> [{ key, expires_at, delegation }]: signed-in browser keys, oldest first
    this.revoked = new Map();     // `player:key` -> when its delegation expires: refused until then, signed again or not
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
      for (const player of [t.pairing.black, t.pairing.white]) if (player !== t.pairing.anchor) this.assigned.set(player, entry.digest);
    }
    for (const g of state.games ?? []) {
      const game_id = BigInt(g.game_id);
      this.games.set(game_id, { ...g, game_id, digest: BigInt(g.digest), ticket: c.reviveTicket(g.ticket) });
    }
    this.seen = new Map(state.seen ?? []);
    this.delegates = new Map(state.delegates ?? []);
    this.revoked = new Map(state.revoked ?? []);
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
      delegates: [...this.delegates],
      revoked: [...this.revoked],
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
    const { chain_id, channel, prover, clocks, boards, response_seconds, sign_seconds, min_table_games,
      delegation_seconds } = this.config;
    const mask = await this.startBands();
    return { chain_id: p.hex(chain_id), channel: p.hex(channel), prover: p.hex(prover), matchmaker: p.hex(this.key), boards,
      response_seconds, sign_seconds, min_table_games, delegation_seconds, clocks,
      keepers: this.keepers.map(k => ({ url: k.url, referee: p.hex(k.referee) })),
      bands: Object.fromEntries(Object.entries(BAND_NAMES).filter(([b]) => mask & (1 << Number(b)))),
      anchors: await this.anchorList() };
  }

  /**
   * What a player's client shows before they play: whether their account is
   * deployed (an undeployed one can't sign for rated games yet), their rating
   * as SurroundRatings holds it (`rank_tenths` 0 = 30k, 300 = 1d, with the
   * contract's offset; `rank` its label; `provisional`, the "?"), and whether
   * they are one of this matchmaker's AI anchors.
   */
  async player(address) {
    const player = playerOf({ player: address });
    const [deployed, r] = await Promise.all([this.chain.deployed(player), this.chain.player(player)]);
    const rated = r.phi !== 0n;
    return { player, deployed, rated, anchor: Boolean(r.anchor), rank_tenths: rated ? r.rank_tenths : null,
      rank: rated ? rating.rankLabel(r.rank_tenths) : null, provisional: r.provisional, established: r.established,
      games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, band: r.band || null };
  }

  /** Each AI anchor: its address, id, pinned rank in tenths (null if not pinned onchain), and how many games it has keys for. */
  async anchorList() {
    return Promise.all([...this.anchors].map(async player => {
      const mu = await this.#pin(player);
      return { player, id: this.anchorIds.get(player) ?? null, rank_tenths: mu === null ? null : rating.rankTenths(mu),
        keys: this.anchorKeys.get(player).length };
    }));
  }

  /** An anchor's pinned μ, as the contract last said (null: not an anchor). */
  async #pin(player) {
    const nowMs = this.now(), cached = this.pins.get(player);
    if (cached && nowMs - cached.at <= ANCHOR_MS) return cached.mu;
    const mu = await this.chain.anchor(player);
    this.pins.set(player, { mu, at: nowMs });
    return mu;
  }

  /** `player` as one of this matchmaker's anchors, pinned onchain; refused otherwise. */
  async #anchor(player) {
    if (!this.anchors.has(player)) throw new LobbyError(404, 'No such AI opponent');
    const mu = await this.#pin(player);
    if (mu === null) throw new LobbyError(503, 'That AI opponent is not rated yet');
    return { player, rank: rating.rankTenths(mu) };
  }

  /** Anchors play only through `play`: they never queue, host or join. */
  #notAnchor(player) {
    if (this.anchors.has(player)) throw new LobbyError(403, 'An AI opponent only plays those who ask for it');
  }

  /** Whether pairing is open, and the games whose rating stopped after `max_rate_attempts`. */
  health() {
    return { ok: true, pairing: this.#pairingOpen(),
      stuck: [...this.games.values()].filter(g => g.stuck).map(g => p.hex(g.game_id)) };
  }

  /**
   * Check a signed request: fresh, its nonce never seen, and signed by
   * `player`'s account, or (naming it as `delegate`) by a browser key the
   * account delegated, for what such a key may sign.
   */
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
    let opponent;
    try { opponent = p.felt(body.anchor ?? 0); } catch { throw new LobbyError(400, 'Invalid opponent'); }
    const typed = c.matchmakerRequest({ chainId: this.config.chain_id, action, player, size: body.size ?? 0,
      clock: body.clock ?? '', band: body.band ?? 0, table: body.table ?? '', key, opponent, at, nonce });
    let ok = false;
    if (body.delegate == null) {
      try { ok = await this.chain.verify(player, typed, body.signature); } catch { ok = false; }
    } else {
      const refuse = (status, message) => { this.seen.delete(seenKey); throw new LobbyError(status, message); };
      if (!DELEGABLE.has(action)) refuse(403, 'Only the wallet signs that');
      let delegate;
      try { delegate = p.felt(body.delegate); } catch { refuse(400, 'Invalid browser key'); }
      if (!this.#delegation(player, p.hex(delegate))) refuse(401, 'Browser key revoked, expired or unknown; sign in again');
      try {
        const [r, s] = Array.isArray(body.signature) ? body.signature : [body.signature.r, body.signature.s];
        ok = p.verify(c.requestHash(typed, player), { r: p.felt(r), s: p.felt(s) }, delegate);
      } catch { ok = false; }
    }
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
      ...[...this.anchorKeys].flatMap(([anchor, keys]) => keys.map(k => [anchor, k])),
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
    this.#notAnchor(entry.player);
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
    this.#notAnchor(entry.player);
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

  /**
   * Sign in: the player's wallet signed `delegationTypedData(go, { chain_id,
   * channel, key, expires_at })`, letting browser key `key` sign their lobby
   * requests (DELEGABLE) and agree to rated games' terms in its place
   * (`open_rated_game_delegable`) until `expires_at`, at most
   * `delegation_seconds` away. The same signature opens those games onchain,
   * so it carries no nonce: a revoked key is refused until its delegation
   * expires, however often it's signed again. A player keeps MAX_DELEGATES
   * keys; signing in past that revokes the oldest.
   */
  async delegate(body) {
    const max = this.config.delegation_seconds, now = Math.floor(this.now() / 1000);
    if (!max) throw new LobbyError(403, 'Signing in is not open here');
    const player = playerOf(body), key = keyOf(body), expires_at = Number(body.expires_at);
    if (!Number.isSafeInteger(expires_at) || expires_at <= now || expires_at - now > max)
      throw new LobbyError(400, `A sign-in expires within ${max} seconds`);
    for (const [k, until] of this.revoked) if (until <= now) this.revoked.delete(k);
    if (this.revoked.has(`${player}:${key}`)) throw new LobbyError(403, 'That browser key was revoked; sign in with a new one');
    const delegation = walletSignature(body.signature);
    const typed = p.delegationTypedData(p.go, { chain_id: this.config.chain_id, channel: this.config.channel, key, expires_at });
    let ok = false;
    try { ok = await this.chain.verify(player, typed, delegation); } catch { ok = false; }
    if (!ok) throw new LobbyError(401, 'Bad signature');
    const delegates = (this.delegates.get(player) ?? []).filter(d => d.key !== key && d.expires_at > now);
    delegates.push({ key, expires_at, delegation });
    if (delegates.length > MAX_DELEGATES) this.#revoke(player, delegates.shift());
    this.delegates.set(player, delegates);
    await this.#save();
    return this.delegatesOf(player);
  }

  /**
   * Revoke browser key `key` (signing out), signed by the wallet or by that
   * key; or, with `key` 0, every key the player signed in (signing out
   * everywhere), signed by the wallet.
   */
  async revoke(body) {
    await this.authenticate('revoke', body);
    const player = playerOf(body);
    let key;
    try { key = p.felt(body.key ?? 0); } catch { throw new LobbyError(400, 'Invalid browser key'); }
    if (body.delegate != null && (key === 0n || key !== p.felt(body.delegate)))
      throw new LobbyError(403, 'A browser key revokes only itself');
    const delegates = this.delegates.get(player) ?? [];
    const gone = key === 0n ? delegates : delegates.filter(d => d.key === p.hex(key));
    // A key this matchmaker never saw is refused for as long as any delegation could run.
    if (key !== 0n && !gone.length) gone.push({ key: p.hex(key), expires_at: Math.floor(this.now() / 1000) + this.config.delegation_seconds });
    for (const d of gone) this.#revoke(player, d);
    const left = delegates.filter(d => !gone.includes(d));
    if (left.length) this.delegates.set(player, left);
    else this.delegates.delete(player);
    await this.#save();
    return this.delegatesOf(player);
  }

  /** The browser keys `player` is signed in with, oldest first, and when each sign-in expires. */
  delegatesOf(player) {
    player = playerOf({ player });
    const now = this.now() / 1000;
    const delegates = (this.delegates.get(player) ?? []).filter(d => d.expires_at > now);
    return { player, delegates: delegates.map(({ key, expires_at }) => ({ key, expires_at })) };
  }

  /** `player`'s sign-in with browser key `key` (hex), while it runs and signing in is open. */
  #delegation(player, key) {
    if (!this.config.delegation_seconds) return null;
    const now = this.now() / 1000;
    return this.delegates.get(player)?.find(d => d.key === key && d.expires_at > now) ?? null;
  }

  // A delegation revoked before it expires: its key is refused until then.
  #revoke(player, { key, expires_at }) {
    this.revoked.set(`${player}:${key}`, expires_at);
  }

  /**
   * A signed-in player's agreement to pairing `t`'s terms: their browser
   * key's signature over the terms message, with the delegation it signs
   * under, which must run long enough for the game to open onchain when it
   * settles (DELEGATION_MARGIN_SECONDS). Checked here without an RPC call.
   */
  #approval(player, t, approval) {
    let key, r, s;
    try {
      key = p.hex(p.felt(approval.key));
      const signature = walletSignature(approval.signature);
      [r, s] = (Array.isArray(signature) ? signature : [signature.r, signature.s]).map(p.felt);
    } catch { throw new LobbyError(400, 'Invalid approval'); }
    const d = this.#delegation(player, key);
    if (!d) throw new LobbyError(401, 'Browser key revoked, expired or unknown; sign in again');
    if (d.expires_at - this.now() / 1000 < DELEGATION_MARGIN_SECONDS)
      throw new LobbyError(409, 'Your sign-in ends too soon for a game; sign in again');
    if (!p.verify(p.termsMessageHash(p.go, t.terms, player), { r, s }, p.felt(key))) throw new LobbyError(401, 'Bad signature');
    return { key, expires_at: d.expires_at, delegation: d.delegation, signature: { r: p.hex(r), s: p.hex(s) } };
  }

  async join(id, body) {
    await this.authenticate('join', { ...body, table: id });
    const player = playerOf(body), key = keyOf(body);
    this.#notAnchor(player);
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

  /**
   * Offer a game against an AI anchor now (`anchor`), on a session key it
   * offered: a rated game like any other, which only the player's rating
   * feels. The offer is the pairing as `status` would show it, ticket and
   * terms included, but nothing is reserved or stored for it: it becomes the
   * player's pairing once their wallet signs its terms (`sign`) by its
   * `sign_by`. So the request itself is unsigned; the terms signature
   * authenticates it, binding the player's seat, session key and opponent to
   * a fresh ticket. An offer can't be opened onchain meanwhile: its anchor
   * signs only pairings stored here.
   */
  async play(body) {
    const entry = this.#entry(body);
    this.#notAnchor(entry.player);
    let anchor;
    try { anchor = await this.#anchor(p.hex(p.felt(body.anchor))); } catch (e) { if (e instanceof LobbyError) throw e; throw new LobbyError(400, 'Invalid opponent'); }
    const ranked = await this.rank(entry.player, entry.band);
    if (!this.#pairingOpen()) throw new LobbyError(503, 'Pairing resumes a few minutes after a restart');
    this.#freshKey(entry.player, entry.key);
    const keys = this.anchorKeys.get(anchor.player);
    if (!keys.length) throw new LobbyError(503, 'That AI opponent is busy; try again shortly');
    const keeper = (await this.#rooms()).find(r => r.room > 0)?.keeper;
    if (!keeper) throw new LobbyError(503, 'Every keeper is full; try again shortly');
    const nowMs = this.now();
    for (const [digest, o] of this.offers) if (o.offer_by_ms < nowMs) this.offers.delete(digest);
    // A key no other offer names, while one is left, so players asking at once rarely race for one.
    const offered = new Set([...this.offers.values()].map(o => anchorKey(o.pairing)));
    const key = keys.find(k => !offered.has(k)) ?? keys[0];
    const pairing = this.lobby.withAnchor({ ...entry, ...ranked }, { ...anchor, key }, nowMs);
    const t = this.#ticketed(pairing, keeper, await this.chain.now());
    t.offer_by_ms = t.sign_by_ms - ANCHOR_SIGN_MS;
    if (this.offers.size >= MAX_OFFERS) this.offers.delete(this.offers.keys().next().value);
    this.offers.set(t.digest, t);
    return { ...this.#pairingStatus(t, entry.player), status: 'offer', sign_by: t.offer_by_ms };
  }

  /**
   * The player signed offer `t`'s terms: if the anchor's key, a keeper and
   * the lobby still allow it, the offer becomes their pairing, signed by
   * them, for the anchor to sign.
   */
  async #take(t, seat, signature) {
    const rooms = await this.#rooms();
    if (this.offers.get(t.digest) !== t) {
      // Another copy of this request took it while the keepers answered.
      if (this.#live(t)) return;
      throw new LobbyError(409, 'That offer expired; ask again');
    }
    this.offers.delete(t.digest);
    if (!this.#pairingOpen()) throw new LobbyError(503, 'Pairing resumes a few minutes after a restart');
    const keys = this.anchorKeys.get(t.pairing.anchor), i = keys.indexOf(anchorKey(t.pairing));
    if (i < 0) throw new LobbyError(409, 'That AI opponent took another game; ask again');
    this.#freshKey(t.pairing[seat], t.pairing[`${seat}_key`]);
    const keeper = this.#reserve(rooms.filter(r => r.keeper.url === t.keeper));
    if (!keeper) throw new LobbyError(503, 'Every keeper is full; try again shortly');
    try { this.lobby.begin(t.pairing, this.now()); } catch (e) { this.#release(keeper); throw e; }
    keys.splice(i, 1);
    t.signatures[seat] = signature;
    await this.#record(t, keeper);
  }

  /** An anchor offers a fresh session key for one of its next games (signed by the anchor's wallet). */
  async offerKey(anchor, body) {
    await this.authenticate('anchor_key', body);
    const player = playerOf(body), key = keyOf(body);
    if (player !== p.hex(p.felt(anchor))) throw new LobbyError(401, 'Not this anchor');
    await this.#anchor(player);
    const keys = this.anchorKeys.get(player);
    if (keys.includes(key)) return { keys: keys.length };
    if (keys.length >= this.config.max_anchor_keys) throw new LobbyError(409, 'Enough keys offered');
    this.#freshKey(player, key);
    keys.push(key);
    return { keys: keys.length };
  }

  /**
   * An anchor's pairings until their games are over, each as a player's
   * status shows it (plus its session `key`), and how many keys it has left.
   */
  anchorGames(anchor) {
    const player = playerOf({ player: anchor });
    if (!this.anchors.has(player)) throw new LobbyError(404, 'No such AI opponent');
    const games = [...this.tickets.values()].filter(t => t.pairing.anchor === player).map(t => {
      const color = t.pairing.black === player ? 'black' : 'white';
      return { ...this.#pairingStatus(t, player), key: t.pairing[`${color}_key`] };
    });
    return { player, keys: this.anchorKeys.get(player).length, games };
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
    if (digest) return this.#pairingStatus(this.tickets.get(digest), player);
    if (this.lobby.queue.has(player)) return { status: 'waiting', since: this.lobby.queue.get(player).since };
    return { status: 'none' };
  }

  #pairingStatus(t, player) {
    return { status: 'paired', color: t.pairing.black === player ? 'black' : 'white', ticket: c.ticketJson(t.ticket),
      signature: { r: p.hex(t.signature.r), s: p.hex(t.signature.s) }, digest: p.hex(t.digest),
      game_id: p.hex(t.terms.game_id), terms: termsJson(t.terms), keeper: t.keeper, sign_by: t.sign_by_ms,
      signed: { black: t.signatures.black !== null, white: t.signatures.white !== null }, ready: t.registered,
      ...(t.pairing.anchor ? { anchor: t.pairing.anchor } : {}) };
  }

  /**
   * A seat's wallet signature over its game's terms (`goTermsTypedData`),
   * checked through its account, or a signed-in player's `approval`
   * (`delegatedApproval`): it authenticates the request. The player's
   * signature on an AI game offer (`play`) makes it their pairing. Once both
   * seats signed, the game goes to its keeper.
   */
  async sign(digest, body) {
    let t;
    try { digest = p.felt(digest); } catch { throw new LobbyError(400, 'Invalid digest'); }
    t = this.tickets.get(digest) ?? this.offers.get(digest);
    if (!t) throw new LobbyError(404, 'No such pairing');
    const player = playerOf(body), seat = SEATS.find(s => t.pairing[s] === player);
    if (!seat) throw new LobbyError(401, 'Not a player of this game');
    // Signed in, a browser key agrees in the wallet's place.
    const signature = body.approval != null ? this.#approval(player, t, body.approval) : walletSignature(body.signature);
    const offer = this.offers.get(digest) === t;
    if (offer && player === t.pairing.anchor) throw new LobbyError(409, 'The player signs an offer first');
    if (offer && this.now() > t.offer_by_ms) throw new LobbyError(409, 'That offer expired; ask again');
    // After the deadline, the next round blames whoever hadn't signed.
    if (t.signatures[seat] === null && this.now() > t.sign_by_ms) throw new LobbyError(409, 'Too late to sign');
    if (!p.isDelegated(signature)) {
      let ok = false;
      try { ok = await this.chain.verify(player, c.goTermsTypedData(t.terms), signature); } catch { ok = false; }
      if (!ok) throw new LobbyError(401, 'Bad signature');
    }
    if (offer) await this.#take(t, seat, signature);
    if (this.#live(t) && t.signatures[seat] === null) {
      t.signatures[seat] = signature;
      this.log(`${player} (${seat}) signed game ${p.hex(t.terms.game_id)}`);
      await this.#save();
    }
    if (this.#live(t) && t.signatures.black && t.signatures.white && !t.registered) await this.#register(t);
    return this.#live(t) ? this.#pairingStatus(t, player) : this.status(player);
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
    let t;
    try {
      t = this.#ticketed(pairing, keeper, await this.chain.now());
    } catch (e) {
      // Nobody ever sees a ticket: the pairing never happened.
      this.#release(keeper);
      pairing.digest = `unissued:${randomBytes(8).toString('hex')}`;
      this.lobby.finished(pairing);
      throw e;
    }
    await this.#record(t, keeper);
  }

  /**
   * A pairing as `tickets` holds it: its ticket, signed, for a game refereed
   * by `keeper`, issued at the chain's time `at`, and the game's terms for
   * both wallets to sign. Recorded nowhere yet.
   */
  #ticketed(pairing, keeper, at) {
    const cfg = this.config;
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
    const digest = c.ticketDigest(ticket);
    pairing.digest = p.hex(digest);
    const nowMs = this.now();
    return { digest, pairing, ticket, signature: c.signTicket(ticket, cfg.matchmakerKey),
      terms: c.ratedTerms(ticket, [pairing.black_key, pairing.white_key]), keeper: keeper.url,
      expires_ms: nowMs + Number(ticket.expires_at - at) * 1000, sign_by_ms: nowMs + cfg.sign_seconds * 1000,
      signatures: { black: null, white: null }, registered: false };
  }

  /** Store pairing `t` for its players, holding `keeper`'s room for it until then. */
  async #record(t, keeper) {
    const { digest, pairing } = t;
    try {
      this.tickets.set(digest, t);
      // Stored before its anchor or a second player sees it: a ticket can't
      // be found onchain until its game settles.
      await this.#save();
    } catch (e) {
      // The pairing never happened.
      this.tickets.delete(digest);
      this.lobby.finished(pairing);
      throw e;
    } finally {
      this.#release(keeper);
    }
    for (const player of [pairing.black, pairing.white]) if (player !== pairing.anchor) this.assigned.set(player, digest);
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
