import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, stringify } from '@referee/sdk/store';
import * as p from '../src/index.mjs';
import * as c from '../src/client.mjs';

// Deterministic PUBLIC test identities: seats 0x1 and 0x2, the keeper's referee 0x3.
const keys = [0x1n, 0x2n], refereeKey = 0x3n;
const base = { chain_id: 1n, channel: 2n, game_id: 3n, prover: 6n, players: [4n, 5n], keys: keys.map(p.publicKey), size: 9, komi_half: 13 };
const ranked = p.goTerms({ ...base, clock: p.rankedClock(p.publicKey(refereeKey)) });
// Byo-yomi in these tests: 60 s of main time, then 3 periods of 10 s.
const byoyomi = p.goTerms({ ...base, clock: p.byoyomiClock(p.publicKey(refereeKey), { main_ms: 60_000, periods: 3, period_ms: 10_000 }) });
const step = (kind, point, dead) => p.goStep(kind, point, dead);

/**
 * A stand-in for the HTTP API of the keeper that referees a game (referee's
 * keeper/server.mjs): it stamps each step as it arrives with the SDK's
 * `Referee`, as the keeper's archive does, refuses and flags a late one, and
 * serves the stamped records, by long poll or as one server-sent event.
 * `clock.now` is its wall clock.
 */
function fakeKeeper(terms, clock) {
  const session = p.goSession(terms);
  const referee = new p.Referee(session, refereeKey, { now: clock.now });
  const reply = (status, body) => ({ ok: status < 400, status, text: async () => stringify(body) });
  const stepsFrom = from => session.steps.slice(from - session.start.seq);
  const fetch = async (url, { method = 'GET', body } = {}) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === '/info') return reply(200, { referee: p.hex(p.publicKey(refereeKey)) });
    const from = Number(searchParams.get('from'));
    if (pathname.endsWith('/events')) {
      const event = `event: steps\ndata: ${stringify({ steps: stepsFrom(from) })}\n\n`;
      const stream = new ReadableStream({ start(out) { out.enqueue(new TextEncoder().encode(`: heartbeat\n\n${event}`)); out.close(); } });
      return { ok: true, status: 200, body: stream };
    }
    assert(pathname.endsWith('/steps'));
    if (method === 'POST') {
      const request = parse(body);
      try {
        // Steps the keeper already holds come back when a seat resends.
        for (const [i, signed] of request.steps.entries()) if (request.from + i >= session.env.seq) referee.stamp(signed, clock.now);
      } catch (e) {
        referee.flag(clock.now);
        return reply(409, { error: { message: e.message } });
      }
      return reply(200, { seq: session.env.seq, accepted: request.steps.length });
    }
    return reply(200, { start: session.start.seq, seq: session.env.seq, transcript: session.env.transcript, steps: stepsFrom(from) });
  };
  return { session, referee, fetch, client: new c.KeeperClient('http://keeper.test', { fetch }) };
}

/** Both seats' stores and sessions, and `play(seat, step, after)`: sign, send to the keeper, pull back stamped. */
async function timedGame(terms, clock) {
  const keeper = fakeKeeper(terms, clock);
  const stores = [0, 1].map(() => new c.SessionStore(c.memoryBackend()));
  const seats = await Promise.all(stores.map(store => store.open(p.go, terms)));
  const play = async (seat, move, after) => {
    clock.now += after;
    await stores[seat].move(seats[seat], move, keys[seat]);
    try { await keeper.client.submit(seats[seat], { store: stores[seat] }); }
    finally {
      for (const s of [0, 1]) await keeper.client.pull(seats[s], { store: stores[s] });
    }
  };
  return { keeper, stores, seats, play };
}

test('ranked games carry a standard clock; casual games none', () => {
  assert.deepEqual(ranked.clock, { referee: p.publicKey(refereeKey),
    settings: { turn_ms: 60000, bank_ms: 0, increment_ms: 0, byoyomi: null } });
  assert.deepEqual(byoyomi.clock.settings, { turn_ms: 0, bank_ms: 60000, increment_ms: 0, byoyomi: { periods: 3, period_ms: 10000 } });
  const casual = p.goTerms(base);
  assert.equal(casual.clock, null);
  assert.notEqual(p.contextHash(p.go, ranked), p.contextHash(p.go, casual));
  assert.notEqual(p.contextHash(p.go, ranked), p.contextHash(p.go, byoyomi));
  assert.deepEqual(p.open(p.go, ranked).clock, { seats: { banks: [0, 0], periods: [] }, used: 0, stamp: 0 });
  assert.deepEqual(p.open(p.go, byoyomi).clock, { seats: { banks: [60000, 60000], periods: [3, 3] }, used: 0, stamp: 0 });
  const settings = ranked.clock.settings;
  assert.throws(() => p.goTerms({ ...base, clock: { ...ranked.clock, settings: { ...settings, turn_ms: 0 } } }), /Invalid time control/);
  assert.throws(() => p.goTerms({ ...base, clock: p.byoyomiClock(1n, { main_ms: 0, periods: 0, period_ms: 1000 }) }), /Invalid byo-yomi/);
});

test('clients sign, the keeper stamps, and clients pull', async () => {
  const clock = { now: 1_000_000 };
  const { keeper, stores, seats, play } = await timedGame(ranked, clock);
  // A timed step applies only once the referee stamps it.
  assert.throws(() => seats[0].move(step(p.PLAY, 40), keys[0]), /Timed games/);
  await stores[0].move(seats[0], step(p.PLAY, 40), keys[0]);
  assert.equal(seats[0].env.seq, 0, 'signed and marked, not applied');
  assert.equal(seats[0].pending.length, 1);
  assert.equal(seats[0].tip.seq, 1);
  await keeper.client.submit(seats[0], { store: stores[0] });
  assert.equal(seats[0].pending.length, 0);
  assert.equal(seats[0].steps[0].stamp, 1_000_000);
  await keeper.client.pull(seats[1], { store: stores[1] });
  await play(1, step(p.PLAY, 41), 30_000);
  await play(0, step(p.PASS), 59_000);
  await play(1, step(p.PASS), 60_000); // the last millisecond counts
  for (const s of seats) assert.equal(s.stateHash(), keeper.session.stateHash());
  assert.deepEqual(seats[0].env.clock, { seats: { banks: [0, 0], periods: [] }, used: 0, stamp: 1_149_000 });
  // A reload re-verifies every stamp's attestation.
  const reloaded = await stores[1].load(p.go, ranked);
  assert.equal(reloaded.stateHash(), seats[1].stateHash());
});

test('a signed step survives a restart before the keeper stamps it', async () => {
  const clock = { now: 1_000_000 };
  const { keeper, stores, seats } = await timedGame(ranked, clock);
  await stores[0].move(seats[0], step(p.PLAY, 40), keys[0]);
  // The client restarts: the store restores the pending step, to resend.
  const restored = await stores[0].load(p.go, ranked);
  assert.deepEqual(restored.pending.map(r => r.message), seats[0].pending.map(r => r.message));
  await keeper.client.submit(restored, { store: stores[0] });
  assert.equal(restored.env.seq, 1);
  assert.equal(restored.pending.length, 0);
  assert.equal(restored.stateHash(), keeper.session.stateHash());
});

test('a seat whose turn runs out is flagged, in the scoring phase too', async () => {
  const clock = { now: 1_000_000 };
  const { keeper, seats, play } = await timedGame(ranked, clock);
  await play(0, step(p.PLAY, 40), 0);
  await play(1, step(p.PASS), 1_000);
  await play(0, step(p.PASS), 1_000);
  await play(1, step(p.PROPOSE), 59_000); // white is due to propose after black's pass
  // Black answers a millisecond late: the keeper refuses it and flags black.
  assert.equal(keeper.referee.deadline(), clock.now + 60_001);
  await assert.rejects(play(0, step(p.ACCEPT), 60_001), /Flag fell/);
  for (const s of seats) {
    assert.deepEqual(s.env.outcome, { finished: true, winner: p.WHITE, reason: p.REASON_TIMEOUT });
    assert.equal(s.steps.at(-1).seat, p.REFEREE);
    assert.equal(s.stateHash(), keeper.session.stateHash());
    assert.equal(s.pending.length, 0, 'the flag drops the refused step');
  }
  // Settlement calldata carries every stamp and the referee's last attestation.
  const batch = c.batchOf(seats[0].steps);
  assert.deepEqual(batch.stamps, seats[0].steps.map(r => r.stamp));
  assert.deepEqual(batch.attestation, seats[0].steps.at(-1).attestation);
  const call = c.directHistoryCall(2n, 3n, 0, seats[0].start, seats[0].startWitness, seats[0].steps);
  const encoded = p.encodeBatch(p.go, batch).map(p.hex);
  assert.deepEqual(call.calldata.slice(-encoded.length - 5, -5), encoded);
});

test('byo-yomi: a period that runs out is lost, and the last one flags', async () => {
  const clock = { now: 1_000_000 };
  const { keeper, seats, play } = await timedGame(byoyomi, clock);
  await play(0, step(p.PLAY, 40), 0);
  await play(1, step(p.PLAY, 41), 65_000); // main time and 5 s: inside the first period, free
  assert.deepEqual(seats[0].env.clock.seats, { banks: [60_000, 0], periods: [3, 3] });
  await play(0, step(p.PLAY, 42), 1_000);
  await play(1, step(p.PLAY, 43), 15_000); // 15 s of overtime: one period lost
  assert.deepEqual(seats[0].env.clock.seats, { banks: [59_000, 0], periods: [3, 2] });
  await play(0, step(p.PLAY, 44), 1_000);
  // White's display: no main time, two periods of 10 s, 4 s into its first.
  const [, white] = p.timeLeft(p.go, byoyomi, seats[0].env, clock.now + 4_000);
  assert.deepEqual(white, { turn: 0, bank: 0, periods: 2, period: 6_000 });
  // White outlasts both periods: the keeper flags it.
  assert.equal(keeper.referee.deadline(), clock.now + 20_001);
  await assert.rejects(play(1, step(p.PLAY, 45), 20_001), /Flag fell/);
  for (const s of seats) {
    assert.deepEqual(s.env.outcome, { finished: true, winner: p.BLACK, reason: p.REASON_TIMEOUT });
    assert.equal(s.stateHash(), keeper.session.stateHash());
  }
});

test('a client can follow the keeper\'s stream instead of polling', async () => {
  const clock = { now: 1_000_000 };
  const { keeper, stores, seats } = await timedGame(ranked, clock);
  await stores[0].move(seats[0], step(p.PLAY, 40), keys[0]);
  await keeper.client.submit(seats[0], { store: stores[0] });
  const streamed = [];
  await keeper.client.follow(seats[1], { store: stores[1], onSteps: records => streamed.push(...records) });
  assert.equal(streamed.length, 1);
  assert.equal(seats[1].stateHash(), seats[0].stateHash());
});

test('ranked transcripts round-trip through JSON, and a changed stamp fails its attestation', async () => {
  const clock = { now: 1_000_000 };
  const { seats, play } = await timedGame(byoyomi, clock);
  await play(0, step(p.PLAY, 40), 0);
  await play(1, step(p.PLAY, 41), 75_000);
  const exported = JSON.parse(p.json(seats[0].export()));
  assert.equal(exported.version, 3);
  assert.equal(p.importSession(exported).stateHash(), seats[0].stateHash());
  assert.deepEqual(p.reviveEnvelope(JSON.parse(p.json(seats[0].env))), seats[0].env);
  exported.steps[1].stamp += 1;
  assert.throws(() => p.importSession(exported), /attestation/);
});

test('ranked games are created with the keeper\'s referee key', async () => {
  const { fetch } = fakeKeeper(ranked, { now: 1 });
  const referee = await c.keeperReferee('http://keeper.test/', { fetch });
  assert.equal(referee, p.publicKey(refereeKey));
  const create = clock => c.createChannelCall({ channel: 2n, size: 19, komi_half: 13, session_key: ranked.keys[0], prover: 6n, clock })
    .calldata.slice(6).map(BigInt);
  // Option::Some, the referee, then the serialized Standard settings.
  assert.deepEqual(create(p.rankedClock(referee)), [0n, referee, 4n, 60000n, 0n, 0n, 1n]);
  assert.deepEqual(create(p.byoyomiClock(referee, { main_ms: 600_000, periods: 5, period_ms: 30_000 })),
    [0n, referee, 6n, 0n, 600000n, 0n, 0n, 5n, 30000n]);
});
