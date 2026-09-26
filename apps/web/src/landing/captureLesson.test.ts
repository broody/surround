import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupAt, play } from "../game/rules.ts";
import {
  createCaptureLesson,
  LESSON_STONE,
  LESSON_TARGET,
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
});
