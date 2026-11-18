// How long an AI takes over a move (pace.ts): its clock's budget, weighed by
// how hard the move is for a human of its rank.
import test from "node:test";
import assert from "node:assert/strict";
import { PACE, budgetOf, moodFor, paceFor, weightOf, type PaceInput } from "./pace.ts";

/** An ordinary middle-game move on a fresh 9×9 byo-yomi clock (5 min + 3 × 30 s). */
const base: PaceInput = {
  size: 9, moves: 20, lead: 0, leadBefore: 0, top: 0.2, choices: PACE.choices, unsettled: 0.4, stakes: 0,
  passing: false, sinceLong: 10, tempo: 1, clock: { mainMs: 300_000, periods: 3, periodMs: 30_000 }, seed: 1,
};
const pace = (input: Partial<PaceInput>) => paceFor({ ...base, ...input });
const ms = (input: Partial<PaceInput>) => pace(input).ms;
const ROUNDS = Number(process.env.PACE_ROUNDS ?? 2000);

test("a move's budget is its main time over the moves it expects to play, or a quarter of a period", () => {
  // 60% of 5 minutes over its 20 moves left: 9 s; late, never fewer than 8 moves planned for.
  assert.equal(budgetOf(base).budget, 9_000);
  assert.equal(budgetOf({ ...base, moves: 58, clock: { mainMs: 40_000, periods: 3, periodMs: 30_000 } }).budget, 3_000);
  // In byo-yomi: a quarter of the period, and never more than half of it.
  assert.deepEqual(budgetOf({ ...base, clock: { mainMs: 0, periods: 2, periodMs: 30_000 } }), { budget: 7_500, cap: 15_000 });
  // Untimed: as if on the board's byo-yomi, fresh.
  assert.equal(budgetOf({ ...base, clock: null }).budget, 6_000);
  assert.ok(Math.abs(budgetOf({ size: 19, moves: 0, clock: null }).budget - 6_545) < 1);
});

test("an ordinary move takes its budget; an easy one less, a hard fight more", () => {
  assert.ok(Math.abs(weightOf({ ...base, unsettled: 0.4 }) - 1) < 1e-9);
  const easy = weightOf({ ...base, choices: 2, unsettled: 0.1 });
  const hard = weightOf({ ...base, choices: 30, unsettled: 0.7, stakes: 10 });
  assert.ok(easy < 0.4 && hard > 1.7, `${easy} ${hard}`);
  // The opening is played from knowledge; behind, it thinks a little longer.
  assert.ok(weightOf({ ...base, moves: 2 }) < weightOf(base));
  assert.ok(weightOf({ ...base, lead: -10 }) > weightOf(base));
  // Without the human policy (after a resumption): near the budget.
  assert.ok(Math.abs(weightOf({ ...base, choices: null }) - 0.87) < 0.01);
});

test("the same position gets the same think, within a tenth of its formula", () => {
  assert.equal(ms({ seed: 42 }), ms({ seed: 42 }));
  const all = Array.from({ length: ROUNDS }, (_, seed) => ms({ seed }));
  const budget = budgetOf(base).budget;
  assert.ok(all.every((x) => x >= budget * 0.9 && x <= budget * 1.1));
  assert.ok(new Set(all).size > 100);
});

test("a forced reply or an answer to a pass comes in about a second, whatever the clock", () => {
  for (const input of [{ top: 0.9 }, { choices: 1.3 }, { passing: true }, { passing: true, lead: -30, leadBefore: 10 }]) {
    const { ms: x, long } = pace(input);
    assert.ok(!long && x >= 900 && x <= 1_100, `${x}`);
  }
  assert.ok(ms({ top: 0.9, clock: { mainMs: 0, periods: 1, periodMs: 30_000 } }) <= 1_100);
});

test("a move that cost the AI points brings a long think, once rested", () => {
  // A fairly sure move (0.7) is not forced: it gets its share of the budget.
  assert.ok(ms({ top: 0.7, choices: 3 }) > 3_000);
  const shocked = pace({ lead: -4, leadBefore: 4 });
  assert.ok(shocked.long && shocked.ms >= Math.min(PACE.cap[9], budgetOf(base).budget * PACE.long * 0.9), `${shocked.ms}`);
  assert.ok(shocked.ms <= PACE.cap[9]);
  assert.equal(pace({ lead: -4, leadBefore: 4, sinceLong: PACE.rest - 1 }).long, false);
  // Behind all along, without a fresh loss: a little longer, no long think.
  assert.equal(pace({ lead: -10, leadBefore: -10 }).long, false);
});

test("a think never passes its board's cap, half a byo-yomi period, or what its main time can run into", () => {
  const hard = { choices: 60, unsettled: 1, stakes: 20, lead: -20, leadBefore: 10, tempo: 1.25 };
  for (const size of [9, 13, 19])
    for (let seed = 0; seed < ROUNDS / 10; seed++) {
      const { ms: x } = pace({ ...hard, size, seed, moves: 0, clock: { mainMs: 1_200_000, periods: 5, periodMs: 30_000 } });
      assert.ok(x <= PACE.cap[size], `${x} on ${size}`);
      assert.ok(ms({ ...hard, size, seed, clock: { mainMs: 0, periods: 1, periodMs: 30_000 } }) <= 15_000);
      assert.ok(ms({ ...hard, size, seed, clock: { mainMs: 2_000, periods: 0, periodMs: 0 } }) <= 2_000);
    }
});

test("on a fresh clock an ordinary move takes several seconds on every board, not one or two", () => {
  for (const [size, mainMs] of [[9, 300_000], [13, 600_000], [19, 1_200_000]]) {
    const x = ms({ size, moves: Math.round(size * size * 0.25), clock: { mainMs, periods: 3, periodMs: 30_000 } });
    assert.ok(x >= 4_000 && x <= 12_000, `${x} on ${size}`);
  }
});

test("the AI is frustrated when its lead fell by a long think's margin since its last turn, excited when it rose as much", () => {
  const margin = PACE.shock[19];
  assert.equal(moodFor({ size: 19, lead: -1, leadBefore: margin - 1 }), "frustrated");
  assert.equal(moodFor({ size: 19, lead: margin, leadBefore: 0 }), "excited");
  assert.equal(moodFor({ size: 19, lead: 0, leadBefore: margin - 1 }), null);
  assert.equal(moodFor({ size: 9, lead: 0, leadBefore: PACE.shock[9] }), "frustrated");
  assert.equal(moodFor({ size: 19, lead: null, leadBefore: 10 }), null);
  assert.equal(moodFor({ size: 19, lead: -20, leadBefore: null }), null);
});
