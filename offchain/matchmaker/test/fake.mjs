// A fake chain and a harness for the matchmaker's tests: SurroundRatings'
// ticket statuses and events, the channel's games, and players whose accounts
// verify signatures with a Stark key.
import { typedData } from '../../sdk/node_modules/starknet/dist/index.mjs';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import { ACCEPTED, RATED, VOID, VOID_SHORT } from '../chain.mjs';
import { Matchmaker } from '../matchmaker.mjs';
import { memoryStore } from '../store.mjs';

export const CHAIN = p.tag('SN_SEPOLIA'), CHANNEL = 0x111n;
export const MATCHMAKER_KEY = 0x3a7c4n, REFEREE = p.publicKey(0x7e7e7en);
export const T0 = 1_700_000_000;
export const WAITING = 0, ACTIVE = 1, SETTLED = 4, CANCELLED = 5;
/** A store that exists but holds nothing: a matchmaker key that never issued a ticket. */
export const EMPTY = {};

// Test accounts: each name gets a Stark key, verified the way an account contract would.
const keys = new Map();
const keyOf = name => { if (!keys.has(name)) keys.set(name, 0x1000n + BigInt(keys.size)); return keys.get(name); };
export const address = name => p.hex(0x100000n + keyOf(name));
const byAddress = () => new Map([...keys].map(([name, key]) => [address(name), key]));

export function fakeChain() {
  const state = {
    now: BigInt(T0), block: 0, events: [], games: new Map(), tickets: new Map(), ranks: new Map(), records: new Map(),
    bands: 0b1110, fee: 10n, noop: new Set(), short: new Set(), failEstimate: false, rateCalls: [],
  };
  return {
    state,
    now: async () => state.now,
    ranks: async list => new Map(list.map(x => [x, state.ranks.get(x) ?? { rank_tenths: 0, provisional: true, rated: false }])),
    games: async player => state.records.get(player) ?? 0,
    startBands: async () => state.bands,
    ratingEvents: async from => ({ events: state.events.filter(e => e.block >= from), to: state.block }),
    game: async id => ({ status: state.games.get(id)?.status ?? WAITING, winner: state.games.get(id)?.winner ?? 0 }),
    playedAt: async id => state.games.get(id)?.played_at ?? 0,
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

export const config = extra => ({
  chain_id: CHAIN, channel: CHANNEL, prover: 0x555n, matchmakerKey: MATCHMAKER_KEY,
  clocks: { turn: p.rankedClock(REFEREE) }, boards: { 9: 14, 19: 15 }, response_seconds: 3600, ticket_seconds: 240, ...extra,
});

let nonces = 0;

/**
 * A matchmaker on a fake chain, a wall clock the tests move, and helpers that
 * play the players and the chain. `store` starts as EMPTY (a matchmaker that
 * ran before); pass `memoryStore()` for one that lost it.
 */
export async function harness({ extra = {}, store = memoryStore(EMPTY), fetch, chain = fakeChain(), clock = { ms: T0 * 1000 } } = {}) {
  const logs = [];
  const open = (s = store) => Matchmaker.open(config(extra), chain, { now: () => clock.ms, log: m => logs.push(m), store: s, fetch });
  const h = {
    chain, clock, logs, store, matchmaker: await open(), open,
    at: () => Math.floor(clock.ms / 1000),
    advance(ms) { clock.ms += ms; chain.state.now += BigInt(Math.floor(ms / 1000)); },
    /** A signed request body from player `name`. */
    request(name, action, fields = {}) {
      const body = { player: address(name), at: h.at(), nonce: p.hex(++nonces), ...fields };
      const typed = c.matchmakerRequest({ chainId: CHAIN, action, ...body });
      const signature = p.sign(BigInt(typedData.getMessageHash(typed, body.player)), keyOf(name));
      return { ...body, signature: [p.hex(signature.r), p.hex(signature.s)] };
    },
    queue: (name, fields = {}, m = h.matchmaker) => m.enqueue(h.request(name, 'queue', { size: 19, clock: 'turn', band: 2, ...fields })),
    /** Pair `a` (black: equal ranks, waited longer) and `b`; returns the ticket's digest. */
    async pair(a, b, m = h.matchmaker) {
      await h.queue(a, {}, m);
      return BigInt((await h.queue(b, {}, m)).digest);
    },
    /** Black creates game `id` from the ticket `digest` (TicketUsed), at `created_at`. */
    create(digest, id, { created_at = Number(chain.state.now), m = h.matchmaker } = {}) {
      const ticket = m.tickets.get(digest)?.ticket;
      const block = ++chain.state.block;
      chain.state.events.push({ type: 'TicketUsed', digest, channel: CHANNEL, game_id: id, ticket, created_at, block });
      chain.state.tickets.set(digest, ACCEPTED);
      chain.state.games.set(id, { status: WAITING, winner: 0, played_at: 0 });
      return ticket;
    },
    join(id) { Object.assign(chain.state.games.get(id), { status: ACTIVE, played_at: Number(chain.state.now) }); },
    settle(id, winner = 1) { Object.assign(chain.state.games.get(id), { status: SETTLED, winner }); },
    cancel(id) { chain.state.games.get(id).status = CANCELLED; },
    /** Pair, create, join: a live rated game. */
    async play(a, b, id) {
      const digest = await h.pair(a, b);
      h.create(digest, id);
      h.join(id);
      await h.matchmaker.tick();
      return digest;
    },
  };
  return h;
}
