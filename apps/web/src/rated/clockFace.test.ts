import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clockEvent, clockLabel, clockNote, clockSpeech, clockText, seatClock } from "./clockFace.ts";

const BYO = { turn_ms: 0, bank_ms: 300_000, byoyomi: { periods: 3, period_ms: 30_000 } };
const TURN = { turn_ms: 60_000, bank_ms: 0, byoyomi: null };
const view = (bank: number, periods: number, period = 30_000) => ({ turn: 0, bank, periods, period });

describe("the match page's clock", () => {
  it("counts main time down first, with its periods waiting", () => {
    assert.deepEqual(seatClock(view(200_000, 3), BYO),
      { ms: 200_000, periods: 3, byoyomi: false, span: 0, low: false, warn: false, soon: false });
    // Main time running out is neither low nor a warning, byo-yomi follows; it is a heads-up.
    assert.deepEqual(seatClock(view(5_000, 3), BYO),
      { ms: 5_000, periods: 3, byoyomi: false, span: 0, low: false, warn: false, soon: true });
  });
  it("then the period running and how many are left, warning in its last 10 seconds", () => {
    assert.deepEqual(seatClock(view(0, 3, 21_000), BYO),
      { ms: 21_000, periods: 3, byoyomi: true, span: 30_000, low: false, warn: false, soon: false });
    assert.equal(seatClock(view(0, 3, 10_000), BYO).warn, true);
  });
  it("is red for the whole of the last period", () => {
    assert.deepEqual(seatClock(view(0, 1, 25_000), BYO),
      { ms: 25_000, periods: 1, byoyomi: true, span: 30_000, low: true, warn: false, soon: false });
  });
  it("reads 0:00 (0) once the periods are gone", () => {
    const out = seatClock(view(0, 0, 0), BYO);
    assert.equal(clockText(out.ms), "0:00");
    assert.equal(out.periods, 0);
  });
  it("shows a clock without byo-yomi as it was: its time, low in the last 10 seconds", () => {
    assert.deepEqual(seatClock({ turn: 9_000, bank: 0, periods: 0, period: 0 }, TURN),
      { ms: 9_000, periods: null, byoyomi: false, span: 60_000, low: true, warn: true, soon: false });
  });
  it("marks byo-yomi beginning and each period used, and nothing else", () => {
    const main = seatClock(view(1_000, 3), BYO);
    const first = seatClock(view(0, 3, 29_000), BYO);
    const second = seatClock(view(0, 2, 29_000), BYO);
    assert.equal(clockEvent(main, first), "byoyomi");
    assert.equal(clockEvent(first, second), "period");
    assert.equal(clockEvent(first, seatClock(view(0, 3, 12_000), BYO)), null);
    assert.equal(clockEvent(undefined, second), null);
    // The last period running out loses on time; it is not a period used.
    assert.equal(clockEvent(seatClock(view(0, 1, 2_000), BYO), seatClock(view(0, 0, 0), BYO)), null);
    // A page opened mid-game, or a move that resets the period, is not an event.
    assert.equal(clockEvent(seatClock(view(0, 2, 3_000), BYO), second), null);
  });
  it("says the clock to a screen reader, and names the time control", () => {
    assert.equal(clockSpeech(seatClock(view(0, 3, 24_000), BYO)), "0:24 left in this period, 3 periods left");
    assert.equal(clockSpeech(seatClock(view(0, 1, 24_000), BYO)), "0:24 left in this period, 1 period left");
    assert.equal(clockSpeech(seatClock(view(200_000, 3), BYO)), "3:20 of main time, then 3 periods");
    assert.equal(clockSpeech(seatClock({ turn: 9_000, bank: 0, periods: 0, period: 0 }, TURN)), "0:09 left");
    assert.equal(clockLabel(BYO), "5 min + 3 × 30 s");
    assert.equal(clockLabel({ ...BYO, bank_ms: 45_000 }), "45 s + 3 × 30 s");
    assert.equal(clockLabel(TURN), "60 s a move");
    assert.equal(clockLabel(null), "");
  });
  it("says what the clock is", () => {
    assert.equal(clockNote(BYO), "5 minutes each, then 3 periods of 30 seconds, timed by the referee.");
    assert.equal(clockNote(TURN), "60 seconds a move, timed by the referee.");
    assert.equal(clockNote(null), "");
  });
});
