import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import * as hooks from '../keeper-hooks.mjs';
import { bandRank, keepersOf } from '../matchmaker.mjs';
import { serve } from '../server.mjs';
import { memoryStore } from '../store.mjs';
import { CHAIN, CHANNEL, MATCHMAKER_KEY, TURN, address, fakeKeeper, harness, reviveTerms, walletSign } from './fake.mjs';

async function http(matchmaker, fn) {
  const server = await serve(matchmaker, { poll_ms: 0 });
  const call = async (method, path, body) => {
    const r = await fetch(`${server.url}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  try { await fn(call); } finally { await server.close(); }
}

const MINUTE = 60_000;
/** Past the time to sign (60 s). */
const SIGN_LATE = 61_000;
/** Past a ticket's life (240 s) and the slack the matchmaker gives its keeper. */
const EXPIRED = 301_000;

test('quick match pairs two players, signs their ticket and builds the terms both wallets sign', async () => {
  const h = await harness();
  h.chain.state.ranks.set(address('b'), { rank_tenths: 110, provisional: false, rated: true });
  await http(h.matchmaker, async call => {
    const aKey = h.newKey(), bKey = h.newKey();
    assert.equal((await call('POST', '/queue', h.request('a', 'queue', { size: 19, clock: 'turn', band: 2, key: aKey }))).body.status, 'waiting');
    // A rated player needs no band.
    const paired = (await call('POST', '/queue', h.request('b', 'queue', { size: 19, clock: 'turn', key: bKey }))).body;
    assert.equal(paired.status, 'paired');
    // b is rated 19k, a starts at 17k: the weaker, b, takes black.
    assert.equal(paired.color, 'black');
    const other = (await call('GET', `/queue/${address('a')}`)).body;
    assert.equal(other.color, 'white');
    assert.equal(other.digest, paired.digest);
    const ticket = c.reviveTicket(paired.ticket), digest = c.ticketDigest(ticket);
    assert.equal(p.hex(digest), paired.digest);
    assert.ok(p.verify(digest, { r: BigInt(paired.signature.r), s: BigInt(paired.signature.s) }, p.publicKey(MATCHMAKER_KEY)));
    assert.deepEqual([p.hex(ticket.black), p.hex(ticket.white), ticket.size, ticket.komi_half, ticket.source, ticket.black_band, ticket.white_band],
      [address('b'), address('a'), 19, 15, c.QUEUE, 1, 2]);
    // The clock names the keeper's referee; the matchmaker's config gives only its settings.
    assert.deepEqual([ticket.chain_id, ticket.channel, ticket.prover, ticket.response_seconds, ticket.clock],
      [CHAIN, CHANNEL, 0x555n, 3600, { referee: h.keeper.referee, settings: TURN, rng_tip: 0n }]);
    assert.equal(ticket.expires_at - ticket.issued_at, 300n);
    // The terms: the ticket's, its digest, both session keys in seat order, and the seats' game id.
    const terms = reviveTerms(paired.terms);
    assert.equal(terms.game_id, p.gameIdOf(terms.players, terms.keys));
    assert.equal(paired.game_id, p.hex(terms.game_id));
    assert.equal(terms.config.ticket, digest);
    assert.deepEqual(terms.keys, [BigInt(bKey), BigInt(aKey)]);
    assert.deepEqual(terms.players, [ticket.black, ticket.white]);
    assert.deepEqual(terms, c.ratedTerms(ticket, [bKey, aKey]));
    assert.deepEqual([paired.keeper, paired.signed, paired.ready, paired.sign_by], [h.keeper.url, { black: false, white: false }, false, h.clock.ms + MINUTE]);
    assert.deepEqual(other.terms, paired.terms);
    const info = (await call('GET', '/info')).body;
    assert.deepEqual(info.bands, { 1: '23k', 2: '17k', 3: '6k' });
    assert.deepEqual([info.min_table_games, info.sign_seconds, info.clocks], [5, 60, { turn: TURN }]);
    assert.deepEqual(info.keepers, [{ url: h.keeper.url, referee: p.hex(h.keeper.referee) }]);
    assert.deepEqual((await call('GET', '/health')).body, { ok: true, pairing: true, stuck: [] });
    assert.equal((await call('GET', '/queue/nobody')).status, 400);
  });
});

test('requests must be signed, fresh, carry a nonce never used before, and a session key', async () => {
  const h = await harness();
  await http(h.matchmaker, async call => {
    const good = h.request('a', 'queue', { size: 19, clock: 'turn', band: 2 });
    assert.equal((await call('POST', '/queue', { ...good, band: 1 })).status, 401);                   // not what was signed
    assert.equal((await call('POST', '/queue', { ...good, nonce: '0x99999' })).status, 401);          // another nonce
    assert.equal((await call('POST', '/queue', { ...good, player: address('b') })).status, 401);      // someone else's
    assert.equal((await call('POST', '/queue', { ...good, key: h.newKey() })).status, 401);           // another session key
    assert.equal((await call('POST', '/queue', { ...good, nonce: undefined })).body.error, 'Invalid nonce');
    assert.equal((await call('POST', '/queue', { ...good, key: 'nope' })).body.error, 'Invalid session key');
    assert.equal((await call('POST', '/queue', { ...h.request('a', 'queue', { size: 19, clock: 'turn', band: 2 }), at: h.at() - 1000 })).status, 401);
    // A request for a game must name the session key: signed without one, it is refused.
    const keyless = await call('POST', '/queue', h.request('a', 'queue', { size: 19, clock: 'turn', band: 2, key: undefined }));
    assert.deepEqual([keyless.status, keyless.body.error], [400, 'Invalid session key']);
    assert.equal((await call('POST', '/queue', h.request('a', 'queue', { size: 19, clock: 'turn', band: 2, key: '0x0' }))).status, 400);
    assert.equal((await call('POST', '/queue', good)).status, 200);
    assert.equal((await call('POST', '/queue', good)).body.error, 'Replayed request');
    // Two requests in the same second differ by their nonces; leaving needs no key.
    assert.equal((await call('POST', '/queue/leave', h.request('a', 'leave'))).body.left, true);
    assert.equal((await call('POST', '/queue', h.request('a', 'queue', { size: 19, clock: 'turn', band: 2 }))).status, 200);
    assert.equal((await call('POST', '/queue', h.request('b', 'queue', { size: 11, clock: 'turn', band: 2 }))).body.error, 'Board not rated');
    assert.equal((await call('GET', '/nope')).status, 404);
  });
});

test('a session key another waiting, hosting or paired player uses is refused', async () => {
  const h = await harness();
  for (const name of ['c', 'd']) h.chain.state.records.set(address(name), 5);
  const key = h.newKey();
  assert.equal((await h.queue('a', { key })).status, 'waiting');
  await assert.rejects(h.queue('b', { key, size: 9 }), err => err.status === 409 && err.message === 'Session key in use');
  // Queueing again with one's own key is fine.
  assert.equal((await h.queue('a', { key })).status, 'waiting');
  const hostKey = h.newKey();
  const { table } = await h.matchmaker.host(h.request('c', 'table', { size: 9, clock: 'turn', band: 2, key: hostKey }));
  await assert.rejects(h.matchmaker.join(table, h.request('d', 'join', { table, band: 2, key: hostKey })), /Session key in use/);
  await assert.rejects(h.queue('b', { key: hostKey }), /Session key in use/);
  // Paired with a's key in play: still refused.
  const digest = BigInt((await h.queue('e')).digest);
  assert.equal(h.matchmaker.status(address('a')).digest, p.hex(digest));
  await assert.rejects(h.queue('b', { key }), /Session key in use/);
  assert.equal((await h.matchmaker.join(table, h.request('d', 'join', { table, band: 2 }))).status, 'paired');
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
    const hostKey = h.newKey();
    const { table } = (await call('POST', '/tables', h.request('a', 'table', { size: 9, clock: 'turn', band: 2, key: hostKey }))).body;
    assert.match(table, /^[0-9a-f]{16}$/);
    assert.deepEqual((await call('GET', '/tables')).body, [{ id: table, host: address('a'), size: 9, clock: 'turn', rank_tenths: bandRank(2) }]);
    const refused = await call('POST', `/tables/${table}/join`, h.request('d', 'join', { table, band: 2 }));
    assert.deepEqual([refused.status, refused.body.error], [403, 'Open tables need 5 rated games; play in the queue first']);
    const joinKey = h.newKey();
    const joined = (await call('POST', `/tables/${table}/join`, h.request('b', 'join', { table, band: 2, key: joinKey }))).body;
    assert.equal(joined.color, 'white');
    const ticket = c.reviveTicket(joined.ticket);
    assert.deepEqual([p.hex(ticket.black), ticket.size, ticket.komi_half, ticket.source], [address('a'), 9, 14, c.TABLE]);
    assert.deepEqual(reviveTerms(joined.terms).keys, [BigInt(hostKey), BigInt(joinKey)]);
    assert.deepEqual((await call('GET', '/tables')).body, []);
    const other = (await call('POST', '/tables', h.request('c', 'table', { size: 9, clock: 'turn', band: 2 }))).body.table;
    assert.notEqual(other, table);
    assert.equal((await call('POST', `/tables/${other}/close`, h.request('a', 'close', { table: other }))).status, 403);
    assert.equal((await call('POST', `/tables/${other}/close`, h.request('c', 'close', { table: other }))).status, 200);
  });
});

test('each seat signs the terms with its wallet; both signatures register the game with its keeper once', async () => {
  const h = await harness();
  const digest = await h.pair('a', 'b');
  const { terms, ticket } = h.game(digest);
  const path = `/games/${p.hex(digest)}/sign`;
  await http(h.matchmaker, async call => {
    const aSig = h.termsSignature('a'), bSig = h.termsSignature('b');
    // A stranger, a signature over other terms, and a wallet that isn't the seat's are refused.
    const stranger = await call('POST', path, { player: address('z'), signature: walletSign('z', c.goTermsTypedData(terms)) });
    assert.deepEqual([stranger.status, stranger.body.error], [401, 'Not a player of this game']);
    const otherTerms = { ...terms, keys: [terms.keys[1], terms.keys[0]], rng_tips: [terms.keys[1], terms.keys[0]] };
    assert.equal((await call('POST', path, { player: address('a'), signature: walletSign('a', c.goTermsTypedData(otherTerms)) })).status, 401);
    assert.equal((await call('POST', path, { player: address('a'), signature: bSig })).body.error, 'Bad signature');
    assert.equal((await call('POST', path, { player: address('a'), signature: 'nope' })).status, 400);
    assert.equal((await call('POST', `/games/0x1234/sign`, { player: address('a'), signature: aSig })).status, 404);
    const first = (await call('POST', path, { player: address('a'), signature: aSig })).body;
    assert.deepEqual([first.color, first.signed, first.ready], ['black', { black: true, white: false }, false]);
    assert.equal(h.keeper.registrations.length, 0);
    const second = (await call('POST', path, { player: address('b'), signature: bSig })).body;
    assert.deepEqual([second.signed, second.ready], [{ black: true, white: true }, true]);
    // Signing again changes nothing.
    assert.equal((await call('POST', path, { player: address('a'), signature: aSig })).body.ready, true);
    await h.matchmaker.tick();
    assert.equal(h.keeper.registrations.length, 1);
    // The keeper got the game at its opening, both wallets' signatures in seat
    // order, and what its `openCall` hook opens the rated game with.
    const [body] = h.keeper.registrations;
    assert.equal(p.contextHash(p.go, body.record.terms), p.contextHash(p.go, terms));
    assert.equal(body.record.steps.length, 0);
    assert.deepEqual(body.authorizations, [aSig, bSig]);
    const signature = h.matchmaker.tickets.get(digest).signature;
    assert.deepEqual(body.extras, { ticket: c.ticketJson(ticket), signature: { r: p.hex(signature.r), s: p.hex(signature.s) } });
    const open = await hooks.openCall({ channel: CHANNEL, game_id: terms.game_id }, body.record.terms,
      { signatures: body.authorizations, extras: body.extras });
    assert.deepEqual(open, c.openRatedGameCall(terms, [aSig, bSig], ticket, signature));
  });
});

test('a registration still in flight is not sent again', async () => {
  const h = await harness();
  await h.pair('a', 'b');
  await h.sign('a');
  let answer;
  h.keeper.slow = new Promise(resolve => { answer = resolve; });
  // The second signature registers the game while a round would too.
  const signed = h.sign('b');
  await new Promise(resolve => setTimeout(resolve, 10));
  const round = h.matchmaker.tick();
  await new Promise(resolve => setTimeout(resolve, 10));
  answer();
  assert.equal((await signed).ready, true);
  await round;
  assert.equal(h.keeper.registrations.length, 1);
});

test('picks the first keeper with room: a full, silent or misconfigured keeper is skipped', async () => {
  const near = fakeKeeper({ url: 'http://near.test', free: 1 }), far = fakeKeeper({ url: 'http://far.test', free: 5, refereeKey: 0x7e7e7fn });
  const h = await harness({ keepers: [near, far], extra: { rules: { max_repeats: 10 } } });
  const referee = name => c.reviveTicket(h.matchmaker.status(address(name)).ticket).clock.referee;
  await h.pair('a', 'b');
  assert.equal(h.matchmaker.status(address('a')).keeper, near.url);
  assert.equal(referee('a'), near.referee);
  // near's one free game is ours until it holds it: the next goes far.
  await h.pair('c', 'd');
  assert.deepEqual([h.matchmaker.status(address('c')).keeper, referee('c')], [far.url, far.referee]);
  // Registered, near counts the game itself.
  await h.sign('a');
  await h.sign('b');
  assert.equal(h.matchmaker.status(address('a')).ready, true);
  assert.equal(near.registrations.length, 1);
  assert.equal(far.registrations.length, 0);
  near.free = 0;
  await h.pair('e', 'f');
  assert.equal(h.matchmaker.status(address('e')).keeper, far.url);
  // A keeper that doesn't answer has no room, nor one refereeing with another key than configured.
  near.free = 3;
  near.up = false;
  await h.pair('g', 'i');
  assert.equal(h.matchmaker.status(address('g')).keeper, far.url);
  near.up = true;
  near.referee = far.referee;
  far.free = 0;
  await h.queue('j');
  await h.queue('k');
  assert.equal(h.matchmaker.status(address('j')).status, 'waiting');
  assert.ok(h.logs.some(m => m.includes(`keeper ${near.url} has no room (it referees with`)));
  near.referee = p.publicKey(near.refereeKey);
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.status(address('j')).keeper, near.url);
  // Tables too: with no room anywhere, nobody joins.
  for (const name of ['l', 'm']) h.chain.state.records.set(address(name), 5);
  const { table } = await h.matchmaker.host(h.request('l', 'table', { size: 9, clock: 'turn', band: 2 }));
  near.free = 0;
  await assert.rejects(h.matchmaker.join(table, h.request('m', 'join', { table, band: 2 })), /Every keeper is full/);
  far.free = 10;
  assert.equal((await h.matchmaker.join(table, h.request('m', 'join', { table, band: 2 }))).keeper, far.url);
});

test('a seat that does not sign in time cools down; the pairing ends and the other seat is free', async () => {
  const h = await harness();
  const digest = await h.pair('a', 'b');
  await h.sign('a');
  h.advance(SIGN_LATE);
  // Too late to sign: the round blames whoever hadn't.
  await assert.rejects(h.sign('b'), err => err.status === 409);
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.status(address('a')).status, 'none');
  assert.equal(h.matchmaker.tickets.size, 0);
  assert.ok(h.matchmaker.lobby.done.has(p.hex(digest)));
  await assert.rejects(h.queue('b'), /Cooling down/);
  assert.equal((await h.queue('a')).status, 'waiting');
  assert.equal(h.keeper.registrations.length, 0);
  // Neither signs: both cool down.
  await h.matchmaker.leave(h.request('a', 'leave'));
  await h.pair('c', 'd');
  h.advance(SIGN_LATE);
  await h.matchmaker.tick();
  await assert.rejects(h.queue('c'), /Cooling down/);
  await assert.rejects(h.queue('d'), /Cooling down/);
});

test('a registration that fails is retried each round, and ends the pairing, nobody at fault, once its ticket expires', async () => {
  const h = await harness({ extra: { rules: { max_repeats: 10 } } });
  h.keeper.failRegister = true;
  const digest = await h.pair('a', 'b');
  await h.sign('a');
  assert.equal((await h.sign('b')).ready, false);
  await h.matchmaker.tick();
  assert.equal(h.keeper.registrations.length, 2);
  // Past the time to sign, but both did: still retried.
  h.advance(SIGN_LATE);
  h.keeper.failRegister = false;
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.status(address('a')).ready, true);
  assert.equal(h.keeper.registrations.length, 3);
  await h.matchmaker.tick();
  assert.equal(h.keeper.registrations.length, 3);
  h.resign(h.game(digest));
  await h.matchmaker.tick();
  // A keeper that never takes the game: the ticket expires, and nobody cools down.
  h.keeper.failRegister = true;
  await h.pair('a', 'b');
  await h.sign('a');
  await h.sign('b');
  h.advance(EXPIRED);
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.status(address('a')).status, 'none');
  assert.equal((await h.queue('a')).status, 'waiting');
  assert.equal((await h.queue('b')).status, 'paired');
});

test('a game its keeper shows finished frees its players at once; the chain rates it once it settles', async () => {
  const h = await harness();
  const game = await h.play('a', 'b');
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.status(address('a')).ready, true);
  await assert.rejects(h.queue('a'), /Finish your rated game/);
  // A move: still playing.
  game.keeper.play(game.terms, 60, h.sessionKeys.get(p.hex(game.terms.keys[0])), h.clock.ms);
  await h.matchmaker.tick();
  await assert.rejects(h.queue('b'), /Finish your rated game/);
  h.advance(1000);
  h.resign(game, 1);
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.status(address('a')).status, 'none');
  assert.equal((await h.queue('a')).status, 'waiting');
  // The keeper opens and settles it later, and the matchmaker rates it.
  h.settle(game, 1);
  const round = await h.matchmaker.tick();
  assert.deepEqual([round.rated, round.txs], [[game.game_id], ['0x7a1']]);
  assert.equal(h.chain.state.tickets.get(game.digest), 2);
  // The pairing ended once: b is free, a is waiting, nobody holds two games.
  assert.equal(h.matchmaker.lobby.open.size, 0);
});

test('rates a game once the chain shows it settled; its players are free then', async () => {
  const h = await harness();
  const game = await h.play('a', 'b');
  assert.equal(h.matchmaker.status(address('a')).status, 'paired');
  // Opened in a dispute, say: not over yet.
  h.settle(game, null);
  await h.matchmaker.tick();
  await assert.rejects(h.queue('a'), /Finish your rated game/);
  // Rating fails (say the RPC can't estimate): the players are free anyway.
  h.chain.state.games.set(game.game_id, { status: 4, winner: 2 });
  h.chain.state.failEstimate = true;
  assert.deepEqual((await h.matchmaker.tick()).rated, []);
  assert.equal(h.matchmaker.status(address('a')).status, 'none');
  assert.equal((await h.queue('a')).status, 'waiting');
  h.chain.state.failEstimate = false;
  const round = await h.matchmaker.tick();
  assert.deepEqual([round.rated, round.txs], [[game.game_id], ['0x7a1']]);
  assert.deepEqual(h.chain.state.rateCalls, [[game.game_id]]);
  assert.deepEqual((await h.matchmaker.tick()).rated, []);
  assert.equal(h.chain.state.rateCalls.length, 1);
});

test('a game the keeper rated as it settled needs no rate from the matchmaker', async () => {
  const h = await harness();
  const game = await h.play('a', 'b');
  h.resign(game);
  h.settle(game, 2);
  // The keeper's `afterSettle` sent `rate` with the resolve.
  h.chain.state.tickets.set(game.digest, 2);
  assert.deepEqual(await h.matchmaker.tick(), { rated: [], voided: [], txs: [], tx: null });
  assert.deepEqual(h.chain.state.rateCalls, []);
  assert.equal(h.matchmaker.games.size, 0);
  assert.equal((await h.queue('b')).status, 'waiting');
});

test('rates in batches whose fee fits max_fee_fri, halving down to one game per transaction', async () => {
  const h = await harness({ extra: { max_fee_fri: 25n, rules: { max_repeats: 10 } } });
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const games = [];
  for (let i = 0; i < 5; i++) games.push(await h.play(names[2 * i], names[2 * i + 1]));
  for (const game of games) h.settle(game);
  const ids = games.map(g => g.game_id);
  const round = await h.matchmaker.tick();
  // 10 per game against a cap of 25: 5 → 3 + 2 → (2 + 1) + 2.
  assert.deepEqual(h.chain.state.rateCalls, [ids.slice(0, 2), ids.slice(2, 3), ids.slice(3)]);
  assert.deepEqual(round.rated, ids);
  assert.equal(round.txs.length, 3);
  // One game whose fee alone is over the cap counts as a failed attempt.
  h.chain.state.fee = 30n;
  const expensive = await h.play('a', 'b');
  h.settle(expensive);
  assert.deepEqual((await h.matchmaker.tick()).rated, []);
  assert.equal(h.matchmaker.games.get(expensive.game_id).attempts, 1);
});

test('stops rating after a few attempts that change nothing, and alerts', async () => {
  const h = await harness();
  const game = await h.play('a', 'b');
  h.settle(game);
  h.chain.state.noop.add(game.game_id);
  for (let i = 0; i < 3; i++) await h.matchmaker.tick();
  assert.equal(h.chain.state.rateCalls.length, 3);
  assert.match(h.logs.find(m => m.startsWith('ALERT')), new RegExp(`game ${p.hex(game.game_id)} \\(ticket ${p.hex(game.digest)}\\) still unrated after 3 attempts`));
  for (let i = 0; i < 3; i++) await h.matchmaker.tick();
  assert.equal(h.chain.state.rateCalls.length, 3);
  assert.deepEqual(h.matchmaker.health().stuck, [p.hex(game.game_id)]);
  // The players were freed when the game settled.
  assert.equal((await h.queue('a')).status, 'waiting');
});

test('repeated aborts, games too short to rate, cool down whoever lost them', async () => {
  const h = await harness({ extra: { rules: { max_repeats: 10, abort_limit: 3 } } });
  for (let i = 0; i < 3; i++) {
    const game = await h.play('a', 'b');
    // a, black, resigns early; the keeper's copy frees both before the chain sees the game.
    h.resign(game, 0);
    await h.matchmaker.tick();
    assert.equal(h.matchmaker.tickets.size, 0);
    h.chain.state.short.add(game.game_id);
    h.settle(game, 2);
    assert.deepEqual((await h.matchmaker.tick()).voided, [game.game_id]);
    await h.matchmaker.tick(); // reads GameVoided
    assert.equal(h.matchmaker.games.has(game.game_id), false);
    if (i < 2) h.advance(1000);
  }
  await assert.rejects(h.queue('a'), /Cooling down after a missed or aborted game/);
  assert.equal((await h.queue('b')).status, 'waiting');
  assert.ok(h.logs.some(m => m.includes(`${address('a')} cools down after repeated aborted games`)));
});

test('a registered game its keeper does not hold is over once its ticket expired, nobody at fault', async () => {
  const h = await harness();
  const game = await h.play('a', 'b');
  game.keeper.forget(game.terms);
  await h.matchmaker.tick();
  await assert.rejects(h.queue('a'), /Finish your rated game/);
  h.advance(EXPIRED);
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.status(address('a')).status, 'none');
  assert.equal((await h.queue('a')).status, 'waiting');
  assert.equal((await h.queue('b')).status, 'paired');
});

test('a restart restores pairings, signatures, registrations, cooldowns and the replay guard from the store', async () => {
  const store = memoryStore();
  const h = await harness({ store, extra: { rules: { max_repeats: 10 } } });
  // Nothing stored: a fresh matchmaker pairs no one until a ticket life has passed.
  assert.equal((await h.queue('x')).status, 'waiting');
  assert.equal((await h.queue('y')).status, 'waiting');
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.status(address('x')).status, 'waiting');
  h.advance(EXPIRED);
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.status(address('x')).status, 'paired');
  // x never signs.
  await h.sign('y');
  h.advance(SIGN_LATE);
  await h.matchmaker.tick();
  // A game in play, a pairing half signed, then a crash and a restart from the store.
  const playing = await h.play('a', 'b');
  const request = h.request('c', 'queue', { size: 19, clock: 'turn', band: 2 });
  await h.matchmaker.enqueue(request);
  const signing = BigInt((await h.queue('d')).digest);
  await h.sign('c');
  const restarted = await h.open(store);
  const status = restarted.status(address('c'));
  assert.deepEqual([status.digest, status.signed, status.ready], [p.hex(signing), { black: true, white: false }, false]);
  assert.deepEqual(status.terms, h.matchmaker.status(address('c')).terms);
  assert.equal(restarted.status(address('a')).ready, true);
  await assert.rejects(restarted.enqueue(request), /Replayed request/);
  await assert.rejects(h.queue('a', {}, restarted), /Finish your rated game/);
  await assert.rejects(h.queue('x', {}, restarted), /Cooling down/);
  // d signs after the restart: the game registers with c's signature from before.
  assert.equal((await h.sign('d', restarted)).ready, true);
  assert.deepEqual(h.keeper.registrations.at(-1).authorizations[0], h.matchmaker.tickets.get(signing).signatures.black);
  // The keeper finishes the game in play, then it settles.
  h.resign(h.game(playing.digest, restarted));
  await restarted.tick();
  assert.equal((await h.queue('a', {}, restarted)).status, 'waiting');
  h.settle(playing);
  assert.deepEqual((await restarted.tick()).rated, [playing.game_id]);
});

test('a restart without the store rebuilds games from TicketUsed and pauses pairing for a ticket life', async () => {
  const h = await harness();
  const second = await h.play('c', 'd');
  // A ticket the store loses before its game reaches the chain.
  const unused = await h.pair('e', 'f');
  const fresh = await h.open(memoryStore());
  // Before its first round it knows no games, and pairs no one.
  assert.equal((await h.queue('c', {}, fresh)).status, 'waiting');
  assert.equal((await h.queue('g', {}, fresh)).status, 'waiting');
  // A game reaches the chain as it settles: it is rated, and its players are free.
  h.settle(second);
  assert.deepEqual((await fresh.tick()).rated, [second.game_id]);
  // e and f may still play their ticket, so no one is paired during its life.
  h.settle(h.game(unused), null);
  await fresh.tick();
  await assert.rejects(h.queue('e', {}, fresh), /Finish your rated game/);
  assert.deepEqual(['c', 'g'].map(n => fresh.status(address(n)).status), ['waiting', 'waiting']);
  h.advance(EXPIRED);
  await fresh.tick();
  assert.deepEqual(['c', 'g'].map(n => fresh.status(address(n)).status), ['paired', 'paired']);
  h.chain.state.games.set(h.game(unused).game_id, { status: 4, winner: 1 });
  await fresh.tick();
  assert.equal((await h.queue('e', {}, fresh)).status, 'waiting');
});

test('a store from another version is refused; keepers come from the config', async () => {
  await assert.rejects(harness({ store: memoryStore({ version: 1, tickets: [] }) }), /state version 1, not 2/);
  assert.deepEqual(keepersOf({ keeper_url: 'http://k.test/', referee: '0x7' }), [{ url: 'http://k.test', referee: 7n }]);
  assert.deepEqual(keepersOf({ keepers: [{ url: 'http://a.test', referee: 1n }, { url: 'http://b.test', referee: '0x2' }] }),
    [{ url: 'http://a.test', referee: 1n }, { url: 'http://b.test', referee: 2n }]);
  assert.throws(() => keepersOf({}), /Configure the keepers/);
  // `join_seconds` is `sign_seconds`' old name.
  assert.equal((await harness({ extra: { join_seconds: 90 } })).matchmaker.config.sign_seconds, 90);
});
