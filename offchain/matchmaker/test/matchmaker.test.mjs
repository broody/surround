import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import { bandRank } from '../matchmaker.mjs';
import { serve } from '../server.mjs';
import { memoryStore } from '../store.mjs';
import { CHAIN, CHANNEL, MATCHMAKER_KEY, REFEREE, address, harness } from './fake.mjs';

async function http(matchmaker, fn) {
  const server = await serve(matchmaker, { poll_ms: 0 });
  const call = async (method, path, body) => {
    const r = await fetch(`${server.url}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  try { await fn(call); } finally { await server.close(); }
}

const MINUTE = 60_000;
/** Past a ticket's life (240 s) and the slack the matchmaker gives the chain. */
const EXPIRED = 301_000;

test('quick match pairs two players and signs a ticket the contract accepts', async () => {
  const h = await harness();
  h.chain.state.ranks.set(address('b'), { rank_tenths: 110, provisional: false, rated: true });
  await http(h.matchmaker, async call => {
    assert.equal((await call('POST', '/queue', h.request('a', 'queue', { size: 19, clock: 'turn', band: 2 }))).body.status, 'waiting');
    // A rated player needs no band.
    const paired = (await call('POST', '/queue', h.request('b', 'queue', { size: 19, clock: 'turn' }))).body;
    assert.equal(paired.status, 'paired');
    // b is rated 19k, a starts at 17k: the weaker, b, takes black.
    assert.equal(paired.color, 'black');
    const other = (await call('GET', `/queue/${address('a')}`)).body;
    assert.equal(other.color, 'white');
    assert.equal(other.digest, paired.digest);
    const ticket = c.reviveTicket(paired.ticket);
    assert.equal(p.hex(c.ticketDigest(ticket)), paired.digest);
    assert.ok(p.verify(c.ticketDigest(ticket), { r: BigInt(paired.signature.r), s: BigInt(paired.signature.s) }, p.publicKey(MATCHMAKER_KEY)));
    assert.deepEqual([p.hex(ticket.black), p.hex(ticket.white), ticket.size, ticket.komi_half, ticket.source, ticket.black_band, ticket.white_band],
      [address('b'), address('a'), 19, 15, c.QUEUE, 1, 2]);
    assert.deepEqual([ticket.chain_id, ticket.channel, ticket.prover, ticket.response_seconds, ticket.clock.referee],
      [CHAIN, CHANNEL, 0x555n, 3600, REFEREE]);
    assert.equal(ticket.expires_at - ticket.issued_at, 300n);
    assert.equal(c.createRatedChannelCall({ channel: CHANNEL, ticket, signature: paired.signature, session_key: 1n }).entrypoint, 'create_rated_channel');
    const info = (await call('GET', '/info')).body;
    assert.deepEqual(info.bands, { 1: '23k', 2: '17k', 3: '6k' });
    assert.equal(info.min_table_games, 5);
    assert.deepEqual((await call('GET', '/health')).body, { ok: true, pairing: true, stuck: [] });
  });
});

test('requests must be signed, fresh, and carry a nonce never used before', async () => {
  const h = await harness();
  await http(h.matchmaker, async call => {
    const good = h.request('a', 'queue', { size: 19, clock: 'turn', band: 2 });
    assert.equal((await call('POST', '/queue', { ...good, band: 1 })).status, 401);                   // not what was signed
    assert.equal((await call('POST', '/queue', { ...good, nonce: '0x99999' })).status, 401);          // another nonce
    assert.equal((await call('POST', '/queue', { ...good, player: address('b') })).status, 401);      // someone else's
    assert.equal((await call('POST', '/queue', { ...good, nonce: undefined })).body.error, 'Invalid nonce');
    assert.equal((await call('POST', '/queue', { ...h.request('a', 'queue', { size: 19, clock: 'turn', band: 2 }), at: h.at() - 1000 })).status, 401);
    assert.equal((await call('POST', '/queue', good)).status, 200);
    assert.equal((await call('POST', '/queue', good)).body.error, 'Replayed request');
    // Two requests in the same second differ by their nonces.
    assert.equal((await call('POST', '/queue/leave', h.request('a', 'leave'))).body.left, true);
    assert.equal((await call('POST', '/queue', h.request('a', 'queue', { size: 19, clock: 'turn', band: 2 }))).status, 200);
    assert.equal((await call('POST', '/queue', h.request('b', 'queue', { size: 11, clock: 'turn', band: 2 }))).body.error, 'Board not rated');
    assert.equal((await call('GET', '/nope')).status, 404);
  });
});

test('a new player chooses a starting band the contract allows; there is no default', async () => {
  const h = await harness();
  await assert.rejects(h.queue('a', { band: undefined }), /Choose a starting band: 1 \(23k\), 2 \(17k\), 3 \(6k\)/);
  await assert.rejects(h.queue('a', { band: 4 }), /Choose a starting band/);
  assert.equal((await h.queue('a', { band: 1 })).status, 'waiting');
  // The owner drops 6k: the matchmaker follows once it reads the contract again.
  h.chain.state.bands = 0b110;
  assert.equal((await h.queue('b', { band: 3 })).status, 'waiting');
  h.advance(MINUTE + 1000);
  await assert.rejects(h.queue('d', { band: 3 }), /Choose a starting band/);
  assert.deepEqual((await h.matchmaker.info()).bands, { 1: '23k', 2: '17k' });
  // A rated player's band isn't used, but must still be one.
  h.chain.state.ranks.set(address('c'), { rank_tenths: 150, provisional: false, rated: true });
  await assert.rejects(h.queue('c', { band: 9 }), /Invalid band/);
});

test('open tables: random ids, players with 5 rated games, the host playing black', async () => {
  const h = await harness();
  for (const name of ['a', 'b', 'c']) h.chain.state.records.set(address(name), 5);
  h.chain.state.records.set(address('d'), 4);
  await http(h.matchmaker, async call => {
    assert.equal((await call('POST', '/tables', h.request('d', 'table', { size: 9, clock: 'turn', band: 2 }))).status, 403);
    const { table } = (await call('POST', '/tables', h.request('a', 'table', { size: 9, clock: 'turn', band: 2 }))).body;
    assert.match(table, /^[0-9a-f]{16}$/);
    assert.deepEqual((await call('GET', '/tables')).body, [{ id: table, host: address('a'), size: 9, clock: 'turn', rank_tenths: bandRank(2) }]);
    const refused = await call('POST', `/tables/${table}/join`, h.request('d', 'join', { table, band: 2 }));
    assert.deepEqual([refused.status, refused.body.error], [403, 'Open tables need 5 rated games; play in the queue first']);
    const joined = (await call('POST', `/tables/${table}/join`, h.request('b', 'join', { table, band: 2 }))).body;
    assert.equal(joined.color, 'white');
    const ticket = c.reviveTicket(joined.ticket);
    assert.deepEqual([p.hex(ticket.black), ticket.size, ticket.komi_half, ticket.source], [address('a'), 9, 14, c.TABLE]);
    assert.deepEqual((await call('GET', '/tables')).body, []);
    const other = (await call('POST', '/tables', h.request('c', 'table', { size: 9, clock: 'turn', band: 2 }))).body.table;
    assert.notEqual(other, table);
    assert.equal((await call('POST', `/tables/${other}/close`, h.request('a', 'close', { table: other }))).status, 403);
    assert.equal((await call('POST', `/tables/${other}/close`, h.request('c', 'close', { table: other }))).status, 200);
  });
});

test('rates a game once it settles; its players are free at settlement', async () => {
  const h = await harness();
  const digest = await h.play('a', 'b', 42n);
  assert.equal(h.matchmaker.status(address('a')).status, 'none');
  await assert.rejects(h.queue('a'), /Finish your rated game/);
  // Rating fails (say the RPC can't estimate): the players are free anyway.
  h.settle(42n, 2);
  h.chain.state.failEstimate = true;
  assert.deepEqual((await h.matchmaker.tick()).rated, []);
  assert.equal((await h.queue('a')).status, 'waiting');
  h.chain.state.failEstimate = false;
  const round = await h.matchmaker.tick();
  assert.deepEqual([round.rated, round.txs], [[42n], ['0x7a1']]);
  assert.deepEqual(h.chain.state.rateCalls, [[42n]]);
  assert.equal(h.chain.state.tickets.get(digest), 2);
  assert.deepEqual((await h.matchmaker.tick()).rated, []);
  assert.equal(h.chain.state.rateCalls.length, 1);
});

test('rates in batches whose fee fits max_fee_fri, halving down to one game per transaction', async () => {
  const h = await harness({ extra: { max_fee_fri: 25n, rules: { max_repeats: 10 } } });
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  for (let i = 0; i < 5; i++) await h.play(names[2 * i], names[2 * i + 1], BigInt(100 + i));
  for (let i = 0; i < 5; i++) h.settle(BigInt(100 + i));
  const round = await h.matchmaker.tick();
  // 10 per game against a cap of 25: 5 → 3 + 2 → (2 + 1) + 2.
  assert.deepEqual(h.chain.state.rateCalls, [[100n, 101n], [102n], [103n, 104n]]);
  assert.deepEqual(round.rated, [100n, 101n, 102n, 103n, 104n]);
  assert.equal(round.txs.length, 3);
  // One game whose fee alone is over the cap counts as a failed attempt.
  h.chain.state.fee = 30n;
  await h.play('a', 'b', 200n);
  h.settle(200n);
  assert.deepEqual((await h.matchmaker.tick()).rated, []);
  assert.equal(h.matchmaker.games.get(200n).attempts, 1);
});

test('stops rating after a few attempts that change nothing, and alerts', async () => {
  const h = await harness();
  const digest = await h.play('a', 'b', 7n);
  h.settle(7n);
  h.chain.state.noop.add(7n);
  for (let i = 0; i < 3; i++) await h.matchmaker.tick();
  assert.equal(h.chain.state.rateCalls.length, 3);
  assert.match(h.logs.find(m => m.startsWith('ALERT')), new RegExp(`game 0x7 \\(ticket ${p.hex(digest)}\\) still unrated after 3 attempts`));
  for (let i = 0; i < 3; i++) await h.matchmaker.tick();
  assert.equal(h.chain.state.rateCalls.length, 3);
  assert.deepEqual(h.matchmaker.health().stuck, ['0x7']);
  // The players were freed when the game settled.
  assert.equal((await h.queue('a')).status, 'waiting');
});

test('black who never creates the game cools down; white is free', async () => {
  const h = await harness();
  await h.pair('a', 'b');
  h.advance(EXPIRED);
  await h.matchmaker.tick();
  await assert.rejects(h.queue('a'), /Cooling down/);
  assert.equal((await h.queue('b')).status, 'waiting');
});

test('white who never joins in time cools down; black is free', async () => {
  const h = await harness();
  const digest = await h.pair('a', 'b');
  h.create(digest, 7n);
  await h.matchmaker.tick();
  h.advance(EXPIRED);
  await h.matchmaker.tick();
  await assert.rejects(h.queue('b'), /Cooling down/);
  assert.equal((await h.queue('a')).status, 'waiting');
  assert.equal(h.matchmaker.games.size, 0);
});

test('black who creates the game too late for white to join cools down; white is free', async () => {
  const h = await harness();
  const digest = await h.pair('a', 'b');
  const ticket = h.matchmaker.tickets.get(digest).ticket;
  // 30 s before the deadline, under `join_seconds` (60).
  h.create(digest, 7n, { created_at: Number(ticket.expires_at) - 30 });
  h.advance(EXPIRED);
  await h.matchmaker.tick();
  await assert.rejects(h.queue('a'), /Cooling down/);
  assert.equal((await h.queue('b')).status, 'waiting');
});

test('black who cancels cools down at once; white is free and never blamed', async () => {
  const h = await harness();
  const digest = await h.pair('a', 'b');
  h.create(digest, 7n);
  h.cancel(7n);
  await h.matchmaker.tick();
  await assert.rejects(h.queue('a'), /Cooling down/);
  assert.equal((await h.queue('b')).status, 'waiting');
  await h.matchmaker.leave(h.request('b', 'leave'));
  h.advance(EXPIRED);
  await h.matchmaker.tick();
  assert.equal((await h.queue('b')).status, 'waiting');
  assert.equal(h.matchmaker.lobby.done.size, 1);
});

test('repeated aborts, games too short to rate, cool down whoever lost them', async () => {
  const h = await harness({ extra: { rules: { max_repeats: 10, abort_limit: 3 } } });
  for (let i = 0; i < 3; i++) {
    const id = BigInt(10 + i);
    await h.play('a', 'b', id);
    h.chain.state.short.add(id);
    h.settle(id, 2); // a, black, resigned early
    assert.deepEqual((await h.matchmaker.tick()).voided, [id]);
    await h.matchmaker.tick(); // reads GameVoided
    assert.equal(h.matchmaker.games.has(id), false);
    if (i < 2) h.advance(1000);
  }
  await assert.rejects(h.queue('a'), /Cooling down after a missed or aborted game/);
  assert.equal((await h.queue('b')).status, 'waiting');
  assert.ok(h.logs.some(m => m.includes(`${address('a')} cools down after repeated aborted games`)));
});

test('a restart restores tickets, open games, cooldowns and the replay guard from the store', async () => {
  const store = memoryStore();
  const h = await harness({ store });
  // Nothing stored: a fresh matchmaker pairs no one until a ticket life has passed.
  assert.equal((await h.queue('x')).status, 'waiting');
  assert.equal((await h.queue('y')).status, 'waiting');
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.status(address('x')).status, 'waiting');
  h.advance(EXPIRED);
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.status(address('x')).status, 'paired');
  // x never creates the game.
  h.advance(EXPIRED);
  await h.matchmaker.tick();
  // Another pairing, then a crash and a restart from the store.
  const request = h.request('a', 'queue', { size: 19, clock: 'turn', band: 2 });
  await h.matchmaker.enqueue(request);
  const digest = BigInt((await h.queue('b')).digest);
  h.create(digest, 9n);
  await h.matchmaker.tick();
  const restarted = await h.open(store);
  assert.equal(restarted.status(address('a')).digest, p.hex(digest));
  await assert.rejects(restarted.enqueue(request), /Replayed request/);
  await assert.rejects(h.queue('a', {}, restarted), /Finish your rated game/);
  await assert.rejects(h.queue('x', {}, restarted), /Cooling down/);
  h.join(9n);
  h.settle(9n);
  assert.deepEqual((await restarted.tick()).rated, [9n]);
  assert.equal((await h.queue('a', {}, restarted)).status, 'waiting');
});

test('a restart without the store rebuilds open games from TicketUsed and pauses pairing for a ticket life', async () => {
  const h = await harness();
  await h.play('a', 'b', 1n);
  await h.play('c', 'd', 2n);
  h.settle(2n);
  await h.matchmaker.tick();
  // A ticket the store loses before its game is created.
  const unused = await h.pair('e', 'f');
  const fresh = await h.open(memoryStore());
  // Before its first round it knows no games: a may queue, but no one is paired.
  assert.equal((await h.queue('a', {}, fresh)).status, 'waiting');
  await fresh.tick();
  await assert.rejects(h.queue('a', {}, fresh), /Finish your rated game/);
  assert.equal((await h.queue('c', {}, fresh)).status, 'waiting');
  // e and f may still use their ticket, so no one is paired during its life.
  h.create(unused, 3n);
  h.join(3n);
  assert.equal((await h.queue('g', {}, fresh)).status, 'waiting');
  h.advance(EXPIRED);
  await fresh.tick();
  await assert.rejects(h.queue('e', {}, fresh), /Finish your rated game/);
  // Pairing resumed: a, still playing, left the queue; c and g were paired.
  assert.deepEqual(['a', 'c', 'g'].map(n => fresh.status(address(n)).status), ['none', 'paired', 'paired']);
  h.settle(1n);
  await fresh.tick();
  assert.equal((await h.queue('a', {}, fresh)).status, 'waiting');
});

test('checks the keeper has room before issuing a ticket', async () => {
  let free = 1, up = true;
  const fetch = async url => {
    assert.equal(url, 'http://keeper.test/info');
    if (!up) throw Error('connection refused');
    return { ok: true, json: async () => ({ referee: '0x1', capacity: { open: 9, max_open_games: 10, reserved_games: 0, free, free_unreserved: free } }) };
  };
  const h = await harness({ extra: { keeper_url: 'http://keeper.test/', rules: { max_repeats: 10 } }, fetch });
  for (const name of ['a', 'b', 'c', 'd']) await h.queue(name);
  // Room for one game, which the first ticket takes until its game joins.
  assert.deepEqual(['a', 'b', 'c', 'd'].map(n => h.matchmaker.status(address(n)).status), ['paired', 'paired', 'waiting', 'waiting']);
  const digest = BigInt(h.matchmaker.status(address('a')).digest);
  h.create(digest, 5n);
  h.join(5n);
  free = 0;
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.status(address('c')).status, 'waiting');
  free = 1;
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.status(address('c')).status, 'paired');
  // Tables too; and a keeper that doesn't answer has no room.
  for (const name of ['e', 'f']) h.chain.state.records.set(address(name), 5);
  const { table } = await h.matchmaker.host(h.request('e', 'table', { size: 9, clock: 'turn', band: 2 }));
  free = 5;
  up = false;
  await assert.rejects(h.matchmaker.join(table, h.request('f', 'join', { table, band: 2 })), /The referee is full/);
  up = true;
  assert.equal((await h.matchmaker.join(table, h.request('f', 'join', { table, band: 2 }))).status, 'paired');
});
