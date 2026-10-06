// A fake chain, fake keepers and a harness for the matchmaker's tests:
// SurroundRatings' ticket statuses and events, the channel's games, keepers
// that hold and referee games (over a stubbed `fetch`), and players whose
// accounts verify signatures with a Stark key.
import { typedData } from '../../sdk/node_modules/starknet/dist/index.mjs';
import { parse, stringify } from '../../sdk/node_modules/@arbiter/sdk/sdk/src/store.mjs';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import { ACCEPTED, RATED, VOID, VOID_SHORT } from '../chain.mjs';
import { Matchmaker } from '../matchmaker.mjs';
import { memoryStore } from '../store.mjs';

export const CHAIN = p.tag('SN_SEPOLIA'), CHANNEL = 0x111n;
export const MATCHMAKER_KEY = 0x3a7c4n, REFEREE_KEY = 0x7e7e7en;
export const T0 = 1_700_000_000;
export const UNOPENED = 0, ACTIVE = 1, SETTLED = 4;
/** The `turn` clock's settings: 60 s per turn. */
export const TURN = p.rankedClock(0n).settings;
/** A store that exists but holds nothing: a matchmaker key that never issued a ticket. */
export const EMPTY = {};

// Test accounts: each name gets a Stark key, verified the way an account contract would.
const keys = new Map();
const walletKey = name => { if (!keys.has(name)) keys.set(name, 0x1000n + BigInt(keys.size)); return keys.get(name); };
export const address = name => p.hex(0x100000n + walletKey(name));
const byAddress = () => new Map([...keys].map(([name, key]) => [address(name), key]));

/** `name`'s wallet signature over `typed` (SNIP-12), as an account's `signMessage` returns it. */
export function walletSign(name, typed) {
  const s = p.sign(BigInt(typedData.getMessageHash(typed, address(name))), walletKey(name));
  return [p.hex(s.r), p.hex(s.s)];
}

export function fakeChain() {
  const state = {
    now: BigInt(T0), block: 0, events: [], games: new Map(), tickets: new Map(), ranks: new Map(), records: new Map(),
    bands: 0b1110, fee: 10n, noop: new Set(), short: new Set(), failEstimate: false, rateCalls: [], anchors: new Map(),
    players: new Map(), undeployed: new Set(),
  };
  return {
    state,
    now: async () => state.now,
    ranks: async list => new Map(list.map(x => [x, state.ranks.get(x) ?? { rank_tenths: 0, provisional: true, rated: false }])),
    games: async player => state.records.get(player) ?? 0,
    anchor: async player => state.anchors.get(player) ?? null,
    // SurroundRatings `player`, as the SDK's getPlayerRating decodes it: all zeros until rated.
    player: async player => state.players.get(player) ?? { mu: 0n, phi: 0n, last_played: 0n, games: 0, wins: 0, losses: 0,
      draws: 0, rank_tenths: 0, provisional: true, established: false, settled: false, peak: 0n, has_peak: false, band: 0,
      params: 0, anchor: false },
    deployed: async player => !state.undeployed.has(player),
    startBands: async () => state.bands,
    ratingEvents: async from => ({ events: state.events.filter(e => e.block >= from), to: state.block }),
    game: async id => ({ status: state.games.get(id)?.status ?? UNOPENED, winner: state.games.get(id)?.winner ?? 0 }),
    ticketStatus: async digest => ({ status: state.tickets.get(digest) ?? 0, game_id: 0n }),
    // A fee per game rated, as a multicall of `rate` costs.
    estimateRate: async games => {
      if (state.failEstimate) throw Error('estimate failed');
      return { fee: state.fee * BigInt(games.length) };
    },
    // `rate` as the channel and SurroundRatings do it: a no-op unless settled and accepted.
    rate: async games => {
      state.rateCalls.push(games.map(g => g.game_id));
      const block = ++state.block;
      for (const { game_id, ticket } of games) {
        const digest = c.ticketDigest(ticket);
        if (state.tickets.get(digest) !== ACCEPTED || state.games.get(game_id)?.status !== SETTLED || state.noop.has(game_id)) continue;
        if (!state.short.has(game_id)) { state.tickets.set(digest, RATED); continue; }
        state.tickets.set(digest, VOID);
        state.events.push({ type: 'GameVoided', digest, channel: CHANNEL, game_id, reason: VOID_SHORT, block });
      }
      return `0x7a${state.rateCalls.length}`;
    },
    verify: async (player, typed, signature) => {
      const key = byAddress().get(player);
      return key != null && p.verify(BigInt(typedData.getMessageHash(typed, player)), { r: BigInt(signature[0]), s: BigInt(signature[1]) }, p.publicKey(key));
    },
  };
}

const reply = (status, body) => ({ ok: status < 400, status, json: async () => JSON.parse(stringify(body)), text: async () => stringify(body) });
const gamePath = terms => `/games/${p.hex(terms.channel)}/${p.hex(terms.game_id)}`;

/**
 * A keeper as the matchmaker sees it: `/info` with its referee key and free
 * capacity, `POST /games` (every body kept in `registrations`), and each
 * game's record and steps. `up`, `free`, `failRegister`, `referee` and `slow`
 * (a promise registrations wait for) are the tests' to change.
 */
export function fakeKeeper({ url = 'http://keeper.test', free = 1000, refereeKey = REFEREE_KEY } = {}) {
  const k = { url, free, refereeKey, referee: p.publicKey(refereeKey), up: true, failRegister: false, registrations: [], games: new Map(),
    slow: null };
  k.handle = async (path, init = {}) => {
    if (!k.up) throw Error('connection refused');
    const method = init.method ?? 'GET';
    if (path === '/info' && method === 'GET') return reply(200, { referee: p.hex(k.referee),
      capacity: { open: k.games.size, max_open_games: 1000, reserved_games: 0, free: k.free, free_unreserved: k.free } });
    if (path === '/games' && method === 'POST') {
      const body = parse(init.body);
      k.registrations.push(body);
      await k.slow;
      if (k.failRegister) return reply(503, { error: { message: 'The keeper is full' } });
      // Admitted as the keeper does: the record must import.
      const session = p.Session.import(p.go, body.record);
      const key = gamePath(session.terms);
      if (!k.games.has(key)) k.games.set(key, session);
      return reply(200, { start: 0, seq: 0, transcript: session.env.transcript, created: true });
    }
    const [route, query] = path.split('?');
    const steps = route.endsWith('/steps'), session = k.games.get(steps ? route.slice(0, -'/steps'.length) : route);
    if (method !== 'GET' || !route.startsWith('/games/')) return reply(404, { error: { message: 'Not found' } });
    if (!session) return reply(404, { error: { message: 'Unknown game' } });
    const head = { start: session.start.seq, seq: session.env.seq, transcript: session.env.transcript };
    if (!steps) return reply(200, { record: session.export(), ...head });
    const from = Number(new URLSearchParams(query).get('from'));
    return reply(200, { ...head, steps: session.steps.filter(r => r.seq >= from) });
  };
  /** Seat `seat` resigns the game on `terms` with its session key; the referee stamps it at `stamp`. */
  k.resign = (terms, seat, sessionKey, stamp) => {
    const session = k.games.get(gamePath(terms));
    session.stamp(p.signedStep(session.sign(p.resignStep(seat), sessionKey)), stamp, k.refereeKey);
  };
  /** A step that doesn't end the game: black plays at `point`. */
  k.play = (terms, point, sessionKey, stamp) => {
    const session = k.games.get(gamePath(terms));
    session.stamp(p.signedStep(session.sign(p.goStep(p.PLAY, point), sessionKey)), stamp, k.refereeKey);
  };
  k.forget = terms => k.games.delete(gamePath(terms));
  return k;
}

/** A `fetch` that reaches `keepers` by their urls. */
export const keeperFetch = keepers => async (url, init) => {
  const k = keepers.find(k => url.startsWith(`${k.url}/`));
  if (!k) throw Error(`Nothing at ${url}`);
  return k.handle(url.slice(k.url.length), init);
};

export const config = extra => ({
  chain_id: CHAIN, channel: CHANNEL, prover: 0x555n, matchmakerKey: MATCHMAKER_KEY,
  clocks: { turn: TURN }, boards: { 9: 14, 19: 15 }, response_seconds: 3600, ticket_seconds: 240, ...extra,
});

/** Terms as the status sends them (felts as hex), revived as a client does. */
export const reviveTerms = t => p.goTerms({ ...t, ...t.config });

let nonces = 0, sessions = 0;

/**
 * A matchmaker on a fake chain and fake keepers, a wall clock the tests move,
 * and helpers that play the players, the keeper and the chain. `store` starts
 * as EMPTY (a matchmaker that ran before); pass `memoryStore()` for one that
 * lost it.
 */
export async function harness({ extra = {}, store = memoryStore(EMPTY), keepers = [fakeKeeper()], chain = fakeChain(),
  clock = { ms: T0 * 1000 } } = {}) {
  const logs = [];
  const fetch = keeperFetch(keepers);
  const settings = { keepers: keepers.map(k => ({ url: k.url, referee: k.referee })), ...extra };
  const open = (s = store) => Matchmaker.open(config(settings), chain, { now: () => clock.ms, log: m => logs.push(m), store: s, fetch });
  const h = {
    chain, clock, logs, store, keepers, keeper: keepers[0], matchmaker: await open(), open,
    sessionKeys: new Map(),       // session public key (hex) -> private key
    at: () => Math.floor(clock.ms / 1000),
    advance(ms) { clock.ms += ms; chain.state.now += BigInt(Math.floor(ms / 1000)); },
    /** A fresh session public key, its private key kept for the player's moves. */
    newKey() {
      const key = 0x5000n + BigInt(++sessions), pub = p.hex(p.publicKey(key));
      h.sessionKeys.set(pub, key);
      return pub;
    },
    /** A signed request body from player `name`; one that asks for a game carries a fresh session key. */
    request(name, action, fields = {}) {
      const key = ['queue', 'table', 'join', 'ai', 'anchor_key'].includes(action) ? { key: h.newKey() } : {};
      const body = { player: address(name), at: h.at(), nonce: p.hex(++nonces), ...key, ...fields };
      return { ...body, signature: walletSign(name, c.matchmakerRequest({ chainId: CHAIN, action, ...body, opponent: body.anchor ?? 0 })) };
    },
    queue: (name, fields = {}, m = h.matchmaker) => m.enqueue(h.request(name, 'queue', { size: 19, clock: 'turn', band: 2, ...fields })),
    /** Pair `a` (black: equal ranks, waited longer) and `b`; returns the ticket's digest. */
    async pair(a, b, m = h.matchmaker) {
      await h.queue(a, {}, m);
      return BigInt((await h.queue(b, {}, m)).digest);
    },
    /** `name`'s wallet signature over the terms of its pairing, after checking them as a client does. */
    termsSignature(name, m = h.matchmaker) {
      const status = m.status(address(name)), terms = reviveTerms(status.terms);
      const ticket = c.reviveTicket(status.ticket);
      if (p.contextHash(p.go, terms) !== p.contextHash(p.go, c.ratedTerms(ticket, terms.keys))) throw Error('Not the ticket\'s terms');
      if (!h.sessionKeys.has(p.hex(terms.keys[status.color === 'black' ? 0 : 1]))) throw Error('Not my session key');
      return walletSign(name, c.goTermsTypedData(terms));
    },
    /** `name` signs the terms of its pairing. */
    sign(name, m = h.matchmaker) {
      return m.sign(m.status(address(name)).digest, { player: address(name), signature: h.termsSignature(name, m) });
    },
    /** Pair `a` (black) and `b`, and both sign: a game its keeper holds. */
    async play(a, b, m = h.matchmaker) {
      const digest = await h.pair(a, b, m);
      await h.sign(a, m);
      await h.sign(b, m);
      return h.game(digest, m);
    },
    /** A pairing's game: { digest, game_id, terms, ticket, keeper }. */
    game(digest, m = h.matchmaker) {
      const t = m.tickets.get(digest);
      return { digest, game_id: t.terms.game_id, terms: t.terms, ticket: t.ticket, keeper: keepers.find(k => k.url === t.keeper) };
    },
    /** Seat `seat` (0 black, 1 white) resigns `game` on its keeper, which then holds it finished. */
    resign(game, seat = 0) { game.keeper.resign(game.terms, seat, h.sessionKeys.get(p.hex(game.terms.keys[seat])), clock.ms); },
    /** `game` reaches the chain: opened from its ticket (TicketUsed), and settled with `winner` unless null. */
    settle(game, winner = 1) {
      const block = ++chain.state.block;
      chain.state.events.push({ type: 'TicketUsed', digest: game.digest, channel: CHANNEL, game_id: game.game_id, ticket: game.ticket, block });
      chain.state.tickets.set(game.digest, ACCEPTED);
      chain.state.games.set(game.game_id, winner === null ? { status: ACTIVE, winner: 0 } : { status: SETTLED, winner });
    },
  };
  return h;
}
