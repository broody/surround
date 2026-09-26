import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyPosition, play, SIZE, studyHistory } from "./rules.ts";

describe("local Go preview", () => {
  it("places stones at intersections and alternates turns", () => {
    const p = play(emptyPosition(), 180);
    assert.equal(p.board[180], 1);
    assert.equal(p.turn, 2);
    assert.throws(() => play(p, 180), /occupied/);
    assert.throws(() => play(p, 361), /intersection/);
  });
  it("captures a surrounded group before checking suicide", () => {
    const p = emptyPosition();
    p.board[1] = 2;
    p.board[2] = 1;
    p.board[SIZE + 1] = 1;
    const next = play(p, 0);
    assert.equal(next.board[1], 0);
    assert.deepEqual(next.captures, [1, 0]);
    assert.equal(p.board[1], 2);
  });
  it("rejects suicide and repeated board positions", () => {
    const p = emptyPosition();
    p.board[1] = p.board[SIZE] = 2;
    assert.throws(() => play(p, 0), /liberties/);
    const fresh = emptyPosition();
    const result = play(fresh, 180);
    fresh.hashes.push(result.board.join(""));
    assert.throws(() => play(fresh, 180), /Superko/);
  });
  it("pauses after two passes without incorrectly applying superko", () => {
    const next = play(play(emptyPosition(), null), null);
    assert.equal(next.paused, true);
    assert.throws(() => play(next, 180), /passed/);
  });
  it("creates a legal 19×19 study game with undoable history", () => {
    const history = studyHistory();
    assert.equal(history.length, 33);
    assert.equal(history.at(-1)!.board.length, 361);
    assert.equal(history.at(-1)!.moves.length, 32);
  });
});
