// The red team's proofs of concept against the matchmaker (review of
// 2026-09-28), kept as regression tests: each now shows the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { address, harness } from './fake.mjs';

test('RT-L1: black creates then cancels; black cools down, not white', async () => {
  const h = await harness();
  const digest = await h.pair('p1', 'p2'); // p1 black (waited longer), p2 white
  // Black creates the rated game and cancels it at once, so white can never join.
  h.create(digest, 7n);
  h.cancel(7n);
  await h.matchmaker.tick();
  await assert.rejects(h.queue('p1'), /Cooling down/);
  assert.equal((await h.queue('p2')).status, 'waiting');
  h.advance(301_000);
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.lobby.cooldowns.has(address('p2')), false);
});

test('RT-L1: a cancelled pairing finishes once, so black keeps max_open for its next game', async () => {
  // No cooldown, so black may play again at once, as in the proof of concept.
  const h = await harness({ extra: { rules: { cooldown_ms: 0 } } });
  const digest = await h.pair('p1', 'p2');
  h.create(digest, 7n);
  h.cancel(7n);
  await h.matchmaker.tick();
  h.advance(1000);
  const second = await h.pair('p1', 'p3');
  h.create(second, 8n);
  h.join(8n);
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.lobby.open.get(address('p1')), 1);
  // The cancelled game's ticket expires: nobody is blamed, and nothing is finished twice.
  h.advance(300_000);
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.lobby.open.get(address('p1')), 1);
  await assert.rejects(h.queue('p1'), /Finish your rated game first/);
  assert.equal((await h.queue('p2')).status, 'waiting');
});

test('RT-M1: more games due than one rate transaction can pay for are rated in batches', async () => {
  // 10 per `rate` against a cap of 210: at most 21 games a transaction, like
  // ~0.23 STRK per `rate` against the 5 STRK cap in config.example.json.
  const h = await harness({ extra: { max_fee_fri: 210n } });
  const ids = [];
  // 22 pairs (sybils, or a busy hour while the matchmaker was down) settle before a round.
  for (let i = 0; i < 22; i++) {
    const id = BigInt(100 + i);
    const digest = await h.pair(`p${2 * i + 1}`, `p${2 * i + 2}`);
    h.create(digest, id);
    h.join(id);
    ids.push(id);
  }
  await h.matchmaker.tick();
  for (const id of ids) h.settle(id);
  const round = await h.matchmaker.tick();
  assert.deepEqual(h.chain.state.rateCalls.map(batch => batch.length), [11, 11]);
  assert.deepEqual(round.rated, ids);
  // Every one of those 44 players is free again.
  assert.equal((await h.queue('p1')).status, 'waiting');
  assert.equal((await h.queue('p44')).status, 'paired');
});
