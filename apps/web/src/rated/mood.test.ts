import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAPTURE_MOOD, holdOf, moodOf, moodWait } from "./mood.ts";
import type { Emotion } from "../lobby/characterArt";

const timing = { thinkingMs: 1500, holdMs: 3000, thinkingHoldMs: [15_000, 25_000] as const };

describe("the AI portrait's mood", () => {
  it("waits before showing thinking, so a quick reply never shows it", () => {
    assert.equal(moodWait({ shown: "normal", until: 0, wanted: "thinking", urgent: false, now: 10_000 }, timing), 1500);
  });
  it("holds a face it just showed until its hold is over", () => {
    assert.equal(moodWait({ shown: "thinking", until: 13_000, wanted: "normal", urgent: false, now: 11_000 }, timing), 2000);
    assert.equal(moodWait({ shown: "normal", until: 13_000, wanted: "thinking", urgent: false, now: 10_500 }, timing), 2500);
  });
  it("holds thinking a while, 15 to 25 seconds, and any other face a few", () => {
    assert.equal(holdOf("thinking", () => 0, timing), 15_000);
    assert.equal(holdOf("thinking", () => 0.999999, timing) > 24_999, true);
    assert.equal(holdOf("thinking", () => 0.5, timing), 20_000);
    assert.equal(holdOf("normal", () => 0.5, timing), 3000);
    assert.equal(holdOf("frustrated", () => 0.5, timing), 3000);
  });
  it("changes at once once the hold is over, for any face but thinking", () => {
    assert.equal(moodWait({ shown: "thinking", until: 0, wanted: "normal", urgent: false, now: 10_000 }, timing), 0);
  });
  it("shows a game's end or event at once, even mid-hold", () => {
    assert.equal(moodWait({ shown: "thinking", until: 30_000, wanted: "defeated", urgent: true, now: 10_100 }, timing), 0);
  });
  it("leaves a face already shown alone", () => {
    assert.equal(moodWait({ shown: "normal", until: 0, wanted: "normal", urgent: false, now: 10_000 }, timing), null);
  });
});

describe("the AI's face from how the game goes", () => {
  // The AI plays white; `n` quiet moves, then any given.
  const quiet = (n: number) => Array.from({ length: n }, (_, i) => ({ color: (i % 2 ? 2 : 1) as 1 | 2, point: i, captures: 0 }));
  const of = (moves = quiet(10), reported: Parameters<typeof moodOf>[0]["reported"] = null, base: Emotion = "normal", final = false) =>
    moodOf({ base, final, moves, ai: 2, size: 19, reported });

  it("follows whose turn it is, at its own pace, when nothing happened", () => {
    assert.deepEqual(of(), { emotion: "normal", urgent: false });
  });
  it("is frustrated at once when the player takes a big group, excited when it does, for two moves", () => {
    const big = CAPTURE_MOOD[19];
    const theirs = [...quiet(10), { color: 1 as const, point: 50, captures: big }];
    assert.deepEqual(of(theirs), { emotion: "frustrated", urgent: true });
    assert.deepEqual(of([...theirs, { color: 2 as const, point: 51, captures: 0 }]).emotion, "frustrated");
    assert.deepEqual(of([...theirs, { color: 2 as const, point: 51, captures: 0 }, { color: 1 as const, point: 52, captures: 0 }]).urgent, false);
    assert.deepEqual(of([...quiet(11), { color: 2 as const, point: 50, captures: big }]), { emotion: "excited", urgent: true });
    // A small capture is no event.
    assert.equal(of([...quiet(10), { color: 1 as const, point: 50, captures: big - 1 }]).urgent, false);
  });
  it("shows the AI's own mood from the move it answers until the player's next, over a capture", () => {
    const theirs = [...quiet(10), { color: 1 as const, point: 50, captures: CAPTURE_MOOD[19] }];
    assert.deepEqual(of(theirs, { moves: 11, mood: "excited" }), { emotion: "excited", urgent: true });
    assert.equal(of(quiet(12), { moves: 11, mood: "frustrated" }).emotion, "frustrated");
    assert.deepEqual(of(quiet(13), { moves: 11, mood: "frustrated" }), { emotion: "normal", urgent: false });
    assert.deepEqual(of(quiet(12), { moves: null, mood: null }), { emotion: "normal", urgent: false });
  });
  it("shows a game's end over everything", () => {
    const theirs = [...quiet(10), { color: 1 as const, point: 50, captures: 30 }];
    assert.deepEqual(of(theirs, { moves: 11, mood: "frustrated" }, "excited", true), { emotion: "excited", urgent: true });
  });
});
