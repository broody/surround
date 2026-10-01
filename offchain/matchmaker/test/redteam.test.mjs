// The red team's proofs of concept against the matchmaker (review of
// 2026-09-28), kept as regression tests: each now shows the fix. Games open
// onchain only to settle since arbiter v6, so RT-L1's creator who cancels is
// now a seat that never signs the terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../sdk/src/index.mjs';
import { address, harness } from './fake.mjs';

test('RT-L1: a seat that never signs cools down, not the seat that signed', async () => {
  const h = await harness();
  await h.pair('p1', 'p2'); // p1 black (waited longer), p2 white
  // White signs; black never does, so the game can't start.
  await h.sign('p2');
  h.advance(61_000);
  await h.matchmaker.tick();
  await assert.rejects(h.queue('p1'), /Cooling down/);
  assert.equal((await h.queue('p2')).status, 'waiting');
  h.advance(301_000);
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.lobby.cooldowns.has(address('p2')), false);
});

test('RT-L1: a pairing that ended finishes once, even if its ticket is played later', async () => {
  // No cooldown, so black may play again at once, as in the proof of concept.
  const h = await harness({ extra: { rules: { cooldown_ms: 0 } } });
  const digest = await h.pair('p1', 'p2');
  const abandoned = h.game(digest);
  await h.sign('p1');
  h.advance(61_000);
  await h.matchmaker.tick();
  const live = await h.play('p1', 'p3');
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.lobby.open.get(address('p1')), 1);
  // p2 signs the old terms anyway, and the two play and settle the ended pairing's game on their own.
  h.settle(abandoned);
  await h.matchmaker.tick();
  assert.equal(h.matchmaker.lobby.open.get(address('p1')), 1);
  await assert.rejects(h.queue('p1'), /Finish your rated game first/);
  assert.equal(h.matchmaker.status(address('p1')).digest, p.hex(live.digest));
});

test('RT-M1: more games due than one rate transaction can pay for are rated in batches', async () => {
  // 10 per `rate` against a cap of 210: at most 21 games a transaction, like
  // ~0.23 STRK per `rate` against the 5 STRK cap in config.example.json.
  const h = await harness({ extra: { max_fee_fri: 210n } });
  const games = [];
  // 22 pairs (sybils, or a busy hour while the matchmaker was down) settle before a round.
  for (let i = 0; i < 22; i++) games.push(await h.play(`p${2 * i + 1}`, `p${2 * i + 2}`));
  await h.matchmaker.tick();
  for (const game of games) h.settle(game);
  const round = await h.matchmaker.tick();
  assert.deepEqual(h.chain.state.rateCalls.map(batch => batch.length), [11, 11]);
  assert.deepEqual(round.rated, games.map(g => g.game_id));
  // Every one of those 44 players is free again.
  assert.equal((await h.queue('p1')).status, 'waiting');
  assert.equal((await h.queue('p44')).status, 'paired');
});
