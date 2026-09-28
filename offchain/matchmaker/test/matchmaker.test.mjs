import test from 'node:test';
import assert from 'node:assert/strict';
import { typedData } from '../../sdk/node_modules/starknet/dist/index.mjs';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import { Matchmaker, bandRank } from '../matchmaker.mjs';
import { serve } from '../server.mjs';

const CHAIN = p.tag('SN_SEPOLIA');
const MATCHMAKER_KEY = 0x3a7c4n, REFEREE = p.publicKey(0x7e7e7en);
// Test accounts: each is a Stark key, verified the way an account contract would.
const players = { a: 0xa11cen, b: 0xb0bn, c: 0xca7n };
const address = name => p.hex(0x1000n + players[name]);
const keyOf = new Map(Object.keys(players).map(n => [address(n), players[n]]));

function fakeChain() {
  const state = { now: 1_700_000_000n, block: 0, records: [], statuses: new Map(), rated: new Map(), playedAt: new Map(),
    ranks: new Map(), rateCalls: [] };
  return {
    state,
    now: async () => state.now,
    ranks: async list => new Map(list.map(x => [x, state.ranks.get(x) ?? { rank_tenths: 0, provisional: true, rated: false }])),
    ratedGames: async from => ({ games: state.records.filter(r => r.block >= from), to: state.block }),
    status: async id => state.statuses.get(id) ?? 1,
    playedAt: async id => state.playedAt.get(id) ?? 0,
    rated: async id => state.rated.get(id) ?? 0,
    rate: async ids => { state.rateCalls.push(ids); for (const id of ids) state.rated.set(id, 1); return '0x7a'; },
    verify: async (player, typed, signature) => {
      const key = keyOf.get(player);
      return key != null && p.verify(BigInt(typedData.getMessageHash(typed, player)), { r: BigInt(signature[0]), s: BigInt(signature[1]) }, p.publicKey(key));
    },
  };
}

function setup() {
  const chain = fakeChain();
  const clock = { ms: 1_700_000_000_000 };
  const matchmaker = new Matchmaker({
    chain_id: CHAIN, channel: 0x111n, prover: 0x555n, matchmakerKey: MATCHMAKER_KEY,
    clocks: { turn: p.rankedClock(REFEREE) }, boards: { 9: 14, 19: 15 }, response_seconds: 3600, ticket_seconds: 240,
  }, chain, { now: () => clock.ms });
  return { chain, clock, matchmaker };
}

/** A signed request body from test player `name`. */
function request(name, action, fields = {}, at = 1_700_000_000) {
  const body = { player: address(name), at, ...fields };
  const typed = c.matchmakerRequest({ chainId: CHAIN, action, ...body });
  const signature = p.sign(BigInt(typedData.getMessageHash(typed, body.player)), players[name]);
  return { ...body, signature: [p.hex(signature.r), p.hex(signature.s)] };
}

async function http(matchmaker, fn) {
  const server = await serve(matchmaker, { poll_ms: 0 });
  const call = async (method, path, body) => {
    const r = await fetch(`${server.url}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  try { await fn(call); } finally { await server.close(); }
}

test('quick match pairs two players and signs a ticket the contract accepts', async () => {
  const { chain, matchmaker } = setup();
  chain.state.ranks.set(address('b'), { rank_tenths: 225, provisional: false, rated: true });
  await http(matchmaker, async call => {
    assert.equal((await call('POST', '/queue', request('a', 'queue', { size: 19, clock: 'turn', band: 3 }))).body.status, 'waiting');
    const paired = (await call('POST', '/queue', request('b', 'queue', { size: 19, clock: 'turn', band: 1 }))).body;
    assert.equal(paired.status, 'paired');
    // b is rated 8k, a starts at 6k: the weaker, b, takes black.
    assert.equal(paired.color, 'black');
    const other = (await call('GET', `/queue/${address('a')}`)).body;
    assert.equal(other.color, 'white');
    assert.equal(other.digest, paired.digest);
    const ticket = c.reviveTicket(paired.ticket);
    assert.equal(p.hex(c.ticketDigest(ticket)), paired.digest);
    assert.ok(p.verify(c.ticketDigest(ticket), { r: BigInt(paired.signature.r), s: BigInt(paired.signature.s) }, p.publicKey(MATCHMAKER_KEY)));
    assert.deepEqual([p.hex(ticket.black), p.hex(ticket.white), ticket.size, ticket.komi_half, ticket.source, ticket.black_band, ticket.white_band],
      [address('b'), address('a'), 19, 15, c.QUEUE, 1, 3]);
    assert.deepEqual([ticket.chain_id, ticket.channel, ticket.prover, ticket.response_seconds, ticket.clock.referee],
      [CHAIN, 0x111n, 0x555n, 3600, REFEREE]);
    assert.equal(ticket.expires_at - ticket.issued_at, 300n);
    assert.equal(c.createRatedChannelCall({ channel: 0x111n, ticket, signature: paired.signature, session_key: 1n }).entrypoint, 'create_rated_channel');
  });
});

test('requests must be signed, fresh and new', async () => {
  const { matchmaker } = setup();
  await http(matchmaker, async call => {
    const good = request('a', 'queue', { size: 19, clock: 'turn', band: 3 });
    assert.equal((await call('POST', '/queue', { ...good, band: 4 })).status, 401);                   // not what was signed
    assert.equal((await call('POST', '/queue', { ...good, player: address('b') })).status, 401);      // someone else's
    assert.equal((await call('POST', '/queue', request('a', 'queue', { size: 19, clock: 'turn' }, 1_699_999_000))).status, 401);
    assert.equal((await call('POST', '/queue', good)).status, 200);
    assert.equal((await call('POST', '/queue', good)).body.error, 'Replayed request');
    assert.equal((await call('POST', '/queue', request('b', 'queue', { size: 11, clock: 'turn' }))).body.error, 'Board not rated');
    assert.equal((await call('POST', '/queue/leave', request('a', 'leave'))).body.left, true);
    assert.equal((await call('GET', '/nope')).status, 404);
  });
});

test('open tables: the host plays black against a player the lobby admits', async () => {
  const { matchmaker } = setup();
  await http(matchmaker, async call => {
    const { table } = (await call('POST', '/tables', request('a', 'table', { size: 9, clock: 'turn', band: 3 }))).body;
    assert.deepEqual((await call('GET', '/tables')).body, [{ id: table, host: address('a'), size: 9, clock: 'turn', rank_tenths: bandRank(3) }]);
    const joined = (await call('POST', `/tables/${table}/join`, request('b', 'join', { table, band: 3 }))).body;
    assert.equal(joined.color, 'white');
    const ticket = c.reviveTicket(joined.ticket);
    assert.deepEqual([p.hex(ticket.black), ticket.size, ticket.komi_half, ticket.source], [address('a'), 9, 14, c.TABLE]);
    assert.deepEqual((await call('GET', '/tables')).body, []);
    const other = (await call('POST', '/tables', request('c', 'table', { size: 9, clock: 'turn', band: 3 }))).body.table;
    assert.equal((await call('POST', `/tables/${other}/close`, request('a', 'close', { table: other }))).status, 403);
    assert.equal((await call('POST', `/tables/${other}/close`, request('c', 'close', { table: other }))).status, 200);
  });
});

/** Pair a (black: equal ranks, waited longer) and b, returning the ticket's digest. */
async function paired(matchmaker) {
  await matchmaker.enqueue(request('a', 'queue', { size: 19, clock: 'turn', band: 3 }));
  return BigInt((await matchmaker.enqueue(request('b', 'queue', { size: 19, clock: 'turn', band: 3 }))).digest);
}

test('rates a game once it settles, then frees both players', async () => {
  const { chain, clock, matchmaker } = setup();
  const digest = await paired(matchmaker);
  chain.state.block = 5;
  chain.state.records.push({ block: 5, game_id: 42n, ticket: digest });
  chain.state.playedAt.set(42n, 1_700_000_050);
  await matchmaker.tick();
  assert.equal(matchmaker.status(address('a')).status, 'none');
  assert.throws(() => matchmaker.lobby.enqueue({ player: address('a'), size: 19, clock: 'turn', band: 3, rank: 242 }, clock.ms), /Finish your rated game/);
  chain.state.statuses.set(42n, 4);
  assert.deepEqual((await matchmaker.tick()).rated, [42n]);
  assert.deepEqual(chain.state.rateCalls, [[42n]]);
  assert.deepEqual((await matchmaker.tick()).rated, []);
  clock.ms += 1000;
  assert.equal((await matchmaker.enqueue(request('a', 'queue', { size: 19, clock: 'turn', band: 3 }, 1_700_000_001))).status, 'waiting');
});

test('black who never creates the game cools down; white is free', async () => {
  const { clock, matchmaker } = setup();
  await paired(matchmaker);
  clock.ms += 301_000;
  await matchmaker.tick();
  const at = Math.floor(clock.ms / 1000);
  await assert.rejects(matchmaker.enqueue(request('a', 'queue', { size: 19, clock: 'turn', band: 3 }, at)), /Cooling down/);
  assert.equal((await matchmaker.enqueue(request('b', 'queue', { size: 19, clock: 'turn', band: 3 }, at))).status, 'waiting');
});

test('white who never joins cools down; black is free', async () => {
  const { chain, clock, matchmaker } = setup();
  const digest = await paired(matchmaker);
  chain.state.block = 3;
  chain.state.records.push({ block: 3, game_id: 7n, ticket: digest });
  await matchmaker.tick();
  clock.ms += 301_000;
  await matchmaker.tick();
  const at = Math.floor(clock.ms / 1000);
  await assert.rejects(matchmaker.enqueue(request('b', 'queue', { size: 19, clock: 'turn', band: 3 }, at)), /Cooling down/);
  assert.equal((await matchmaker.enqueue(request('a', 'queue', { size: 19, clock: 'turn', band: 3 }, at))).status, 'waiting');
});
