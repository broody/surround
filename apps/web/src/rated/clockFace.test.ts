import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clockFace, clockNote } from "./clockFace.ts";

const BYO = { turn_ms: 0, bank_ms: 300_000, byoyomi: { periods: 3, period_ms: 30_000 } };
const TURN = { turn_ms: 60_000, bank_ms: 0, byoyomi: null };

describe("the match page's clock", () => {
  it("counts main time down first, saying what follows", () => {
    assert.deepEqual(clockFace({ turn: 0, bank: 200_000, periods: 3, period: 30_000 }, BYO),
      { ms: 200_000, span: 300_000, low: false, caption: "then 3 × 30 s" });
    // Main time running out is not low: byo-yomi follows.
    assert.equal(clockFace({ turn: 0, bank: 5_000, periods: 3, period: 30_000 }, BYO).low, false);
  });
  it("then the period running, how many are left, low in its last 10 seconds", () => {
    assert.deepEqual(clockFace({ turn: 0, bank: 0, periods: 3, period: 21_000 }, BYO),
      { ms: 21_000, span: 30_000, low: false, caption: "Byo-yomi · 3 periods" });
    assert.deepEqual(clockFace({ turn: 0, bank: 0, periods: 1, period: 8_000 }, BYO),
      { ms: 8_000, span: 30_000, low: true, caption: "Byo-yomi · last period" });
  });
  it("shows a clock without byo-yomi as it was: its time, low in the last 10 seconds", () => {
    assert.deepEqual(clockFace({ turn: 9_000, bank: 0, periods: 0, period: 0 }, TURN), { ms: 9_000, span: 60_000, low: true, caption: null });
  });
  it("says what the clock is", () => {
    assert.equal(clockNote(BYO), "5 minutes each, then 3 periods of 30 seconds, timed by the referee.");
    assert.equal(clockNote(TURN), "60 seconds a move, timed by the referee.");
    assert.equal(clockNote(null), "");
  });
});
