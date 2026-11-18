// How long an AI takes over a move (pace.ts), over many seeded draws.
import test from "node:test";
import assert from "node:assert/strict";
import { PACE, moodFor, paceFor, type PaceInput } from "./pace.ts";

/** A seeded random number generator (mulberry32), so a run is repeatable. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ROUNDS = Number(process.env.PACE_ROUNDS ?? 2000);
const base: PaceInput = {
  size: 19, moves: 120, lead: 0, leadBefore: 0, top: 0.3, passing: false, sinceLong: 10, tempo: 1, leftMs: null,
};
const draws = (input: Partial<PaceInput>, seed = 1) => {
  const random = seeded(seed);
  return Array.from({ length: ROUNDS }, () => paceFor({ ...base, ...input }, random));
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (input: Partial<PaceInput>, seed?: number) => draws(input, seed).map((x) => x.ms);

test("a think never leaves its board's cap, the floor, or a share of a timed game's clock", () => {
  for (const size of [9, 13, 19])
    for (const input of [{}, { lead: -20, leadBefore: 10 }, { top: 0.01 }, { tempo: 3 }, { passing: true }]) {
      for (const x of ms({ ...input, size }, size)) {
        assert.ok(x >= PACE.floor && x <= PACE.cap[size], `${x} ms on ${size}×${size}`);
      }
    }
  // In byo-yomi, with a 30-second period: a fifth of it. With main time left: the board's cap.
  for (const x of ms({ lead: -20, leadBefore: 10, leftMs: 30_000 })) assert.ok(x <= 6_000);
  assert.ok(ms({ lead: -20, leadBefore: 10, leftMs: 600_000 }).some((x) => x > 10_000));
  for (const x of ms({ leftMs: 0 })) assert.equal(x, PACE.floor);
});

test("a forced move and an answer to a pass come quickly, and are never long thinks", () => {
  for (const input of [{ top: 0.9 }, { passing: true }, { passing: true, lead: -30, leadBefore: 10 }]) {
    const all = draws(input);
    assert.ok(all.every((x) => !x.long && x.ms <= PACE.quick[1]));
  }
});

test("a move that cost the AI points brings a long think, once rested", () => {
  const shocked = draws({ lead: -4, leadBefore: 4 });
  assert.ok(shocked.every((x) => x.long && x.ms >= PACE.cap[19] * 0.55));
  assert.ok(draws({ lead: -4, leadBefore: 4, sinceLong: PACE.rest - 1 }).every((x) => !x.long));
  // Behind all along, without a fresh loss: a little longer, not a long think.
  const behind = draws({ lead: -10, leadBefore: -10 });
  assert.ok(behind.every((x) => !x.long));
  assert.ok(median(behind.map((x) => x.ms)) > median(ms({})));
});

test("most moves take a second or three, a long think only now and then", () => {
  for (const size of [9, 13, 19]) {
    const all = draws({ size, moves: Math.round(size * size * 0.25) }, size);
    const typical = median(all.map((x) => x.ms));
    assert.ok(typical >= 1_000 && typical <= 3_000, `median ${typical} ms on ${size}×${size}`);
    // A hard position alone thinks long at most a fifth of the time.
    const hard = draws({ size, top: 0.05 }, size + 1).filter((x) => x.long).length / ROUNDS;
    assert.ok(hard > 0 && hard <= PACE.hard.chance * 1.2, `${hard} long on ${size}×${size}`);
  }
});

test("the middle game thinks longer than the opening, a hard choice longer than an easy one, a patient player longer", () => {
  assert.ok(median(ms({ moves: 100 })) > median(ms({ moves: 10 })));
  assert.ok(median(ms({ top: 0.12, sinceLong: 0 })) > median(ms({ top: 0.55, sinceLong: 0 })));
  assert.ok(median(ms({ tempo: 1.25 })) > median(ms({ tempo: 0.8 })));
});

test("a think varies from move to move", () => {
  const all = ms({});
  const typical = median(all);
  // A wide spread: over an eighth of moves half again as long as the typical one, over an eighth two-thirds as long or less.
  assert.ok(all.filter((x) => x >= typical * 1.5).length > ROUNDS / 8);
  assert.ok(all.filter((x) => x <= typical / 1.5).length > ROUNDS / 8);
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
