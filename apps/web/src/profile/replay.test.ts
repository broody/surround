import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { replayOf, resultText, type ReplayStep } from "./replay.ts";

const move = (point: number | null): ReplayStep => ({
  kind: 0,
  action: point === null ? { kind: 1 } : { kind: 0, point },
});
const propose = (...dead: number[]): ReplayStep => ({
  kind: 0,
  action: { kind: 2, dead: `0x${dead.reduce((m, p) => m | (1n << BigInt(p)), 0n).toString(16)}` },
});
const accept: ReplayStep = { kind: 0, action: { kind: 3 } };
const resume: ReplayStep = { kind: 0, action: { kind: 4 } };

describe("game replays", () => {
  it("has a position for the empty board and after each play or pass", () => {
    const { positions, end } = replayOf([move(40), move(null), move(30), { kind: 4, seat: 1 }], 9, 6.5);
    assert.equal(positions.length, 4);
    assert.equal(positions[0].board.filter(Boolean).length, 0);
    assert.equal(positions[1].board[40], 1);
    assert.equal(positions[2].moves[1].point, null);
    assert.equal(positions[3].board[30], 1);
    assert.deepEqual(end, { kind: "resign", color: 2 });
    assert.equal(resultText(end, 1), "B+R");
  });

  it("flags the side whose turn it was", () => {
    const { end } = replayOf([move(40), { kind: 5 }], 9, 6.5);
    assert.deepEqual(end, { kind: "time", color: 2 });
    assert.equal(resultText(end, 1), "B+T");
    // At scoring the side due isn't the board's turn: the result says who lost.
    assert.deepEqual(replayOf([move(40), { kind: 5 }], 9, 6.5, 2).end, { kind: "time", color: 1 });
  });

  it("counts an accepted proposal, its dead stones off the board, komi to White", () => {
    // Black walls off the left column; White's lone stone at the far side is dead.
    const steps = [move(4), move(80), move(13), move(null), move(22), move(null), move(31), move(null), move(40)];
    const wall = [...steps, move(null), move(49), move(null), move(58), move(null), move(67), move(null), move(76)];
    const { positions, end } = replayOf([...wall, move(null), move(null), propose(80), accept], 9, 6.5);
    assert.equal(positions.length, wall.length + 3);
    assert.ok(end?.kind === "count");
    assert.deepEqual([...end.dead], [80]);
    assert.deepEqual([end.black, end.white], [81, 6.5]);
    assert.equal(resultText(end, 1), "B+74.5");
  });

  it("a resumption drops the proposal and lets play go on; two passes then count every stone alive", () => {
    const resumed = [move(null), move(null), propose(), resume, move(40)];
    const { positions, end } = replayOf(resumed, 9, 6.5);
    assert.equal(positions.length, 4);
    assert.equal(positions[3].board[40], 1);
    assert.equal(end, null);
    assert.equal(resultText(end, 2), "W+");
    const over = replayOf([...resumed, move(null), move(null)], 9, 6.5);
    assert.equal(over.positions.length, 6);
    assert.deepEqual(over.end, { kind: "count", dead: new Set(), black: 81, white: 6.5 });
    assert.equal(resultText(over.end, 1), "B+74.5");
  });

  it("stops at a step the board can't take", () => {
    const { positions } = replayOf([move(40), move(40), move(30)], 9, 6.5);
    assert.equal(positions.length, 2);
  });
});
