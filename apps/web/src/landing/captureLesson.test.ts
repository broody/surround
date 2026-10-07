import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupAt, play, SIZE } from "../game/rules.ts";
import {
  createCaptureLesson,
  LESSON_STONE,
  LESSON_TARGET,
  tryCapture,
} from "./captureLesson.ts";

describe("first capture lesson", () => {
  it("sets up a legal White-to-play position with exactly one liberty", () => {
    const position = createCaptureLesson();
    assert.equal(position.turn, 2);
    assert.equal(position.board[LESSON_STONE], 1);
    assert.equal(position.board[LESSON_TARGET], 0);
    assert.deepEqual(
      [...groupAt(position.board, LESSON_STONE).liberties],
      [LESSON_TARGET],
    );
  });
  it("uses the actual Go rules to capture exactly one stone", () => {
    const result = play(createCaptureLesson(), LESSON_TARGET);
    assert.equal(result.board[LESSON_STONE], 0);
    assert.equal(result.board[LESSON_TARGET], 2);
    assert.deepEqual(result.captures, [0, 1]);
  });
  it("restarts without retaining the captured position or touching other boards", () => {
    const initial = createCaptureLesson();
    play(initial, LESSON_TARGET);
    assert.deepEqual(initial, createCaptureLesson());
  });
  it("counts only the last liberty as the capture", () => {
    const hit = tryCapture(LESSON_TARGET);
    assert.equal(hit.captured, true);
    assert.equal(hit.position.board[LESSON_STONE], 0);
    const miss = tryCapture(LESSON_TARGET + SIZE);
    assert.equal(miss.captured, false);
    assert.equal(miss.position.board[LESSON_TARGET + SIZE], 2);
    assert.equal(miss.position.board[LESSON_STONE], 1);
    assert.equal(miss.position.turn, 2);
  });
  it("refuses a stone on an occupied point", () => {
    assert.throws(() => tryCapture(LESSON_STONE), /occupied/);
  });
});
