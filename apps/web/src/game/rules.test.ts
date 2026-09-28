import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  areaScore,
  boardSize,
  coordinate,
  emptyPosition,
  play,
  pointFromCoordinate,
  SIZE,
  studyHistory,
} from "./rules.ts";

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
  it("plays on smaller boards with their own edges", () => {
    const p = emptyPosition(9);
    assert.equal(boardSize(p.board), 9);
    assert.equal(coordinate(0, 9), "A9");
    assert.equal(coordinate(80, 9), "J1");
    // A corner stone on 9×9 has two liberties; White fills both.
    let q = play(p, 0);
    q = play(q, 1);
    q = play(q, null);
    q = play(q, 9);
    assert.equal(q.board[0], 0);
    assert.equal(q.captures[1], 1);
    assert.throws(() => play(q, 81), /intersection/);
  });
  it("reads coordinates back into points", () => {
    for (const size of [9, 19])
      for (let point = 0; point < size * size; point++)
        assert.equal(pointFromCoordinate(coordinate(point, size), size), point);
    assert.equal(pointFromCoordinate("q4"), pointFromCoordinate("Q4"));
    for (const vertex of ["I5", "A20", "A0", "Z1", "A", "", "pass"])
      assert.throws(() => pointFromCoordinate(vertex), /intersection/);
    assert.throws(() => pointFromCoordinate("K5", 9), /intersection/);
  });
  it("scores area: live stones plus empty regions touching one color", () => {
    const p = emptyPosition(9);
    // A black wall on column C and a white wall on column E, each full height.
    for (let row = 0; row < 9; row++) {
      p.board[row * 9 + 2] = 1;
      p.board[row * 9 + 4] = 2;
    }
    p.board[4 * 9 + 7] = 1; // a black stone deep in White's area
    const alive = areaScore(p.board);
    // Columns A–C are Black's (27); D touches both colors so is neutral.
    assert.equal(alive.black, 27 + 1);
    assert.equal(alive.owner[3], 0);
    // The stray stone splits nothing but makes F–J mixed, so White has only E.
    assert.equal(alive.white, 9);
    const dead = areaScore(p.board, new Set([4 * 9 + 7]));
    assert.equal(dead.black, 27);
    assert.equal(dead.white, 9 + 36);
  });
});
