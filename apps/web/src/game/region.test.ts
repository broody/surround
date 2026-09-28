import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SIZE } from "./rules.ts";
import {
  boardEdge,
  focusRegion,
  fullBoard,
  placement,
  regionContains,
  viewport,
} from "./region.ts";

const at = (col: number, row: number) => row * SIZE + col;

describe("problem focus region", () => {
  it("centers a minimum-size window on a small central shape", () => {
    assert.deepEqual(focusRegion([at(8, 8), at(10, 10)]), {
      left: 5,
      top: 5,
      right: 13,
      bottom: 13,
    });
  });

  it("keeps the corner in view for corner problems", () => {
    assert.deepEqual(focusRegion([at(0, 0), at(3, 2)]), {
      left: 0,
      top: 0,
      right: 8,
      bottom: 8,
    });
    assert.deepEqual(focusRegion([at(18, 18)]), {
      left: 10,
      top: 10,
      right: 18,
      bottom: 18,
    });
  });

  it("includes an edge rather than stopping one line short of it", () => {
    const region = focusRegion([at(5, 9), at(6, 9)]);
    assert.equal(region.left, 0);
    assert.equal(region.right, 9);
  });

  it("grows past the minimum for spread-out shapes", () => {
    const region = focusRegion([at(4, 9), at(14, 9)]);
    assert.equal(region.left, 2);
    assert.equal(region.right, 16);
  });

  it("falls back to the whole board without points", () => {
    assert.deepEqual(focusRegion([]), fullBoard());
  });

  it("tests membership by column and row", () => {
    const region = focusRegion([at(9, 9)]);
    assert.ok(regionContains(region, at(9, 9)));
    assert.ok(!regionContains(region, at(4, 9)));
    assert.ok(!regionContains(region, at(9, 14)));
  });

  it("places intersections for overlays on full and cropped boards", () => {
    assert.deepEqual(placement(fullBoard(), 0), {
      x: 0.08,
      y: 0.08,
      step: 28 / 600,
    });
    const crop = { left: 7, top: 7, right: 11, bottom: 11 };
    const center = placement(crop, at(9, 9));
    assert.equal(center.x, 0.5);
    assert.equal(center.y, 0.5);
    const right = placement(crop, at(10, 9)).x - center.x;
    assert.ok(Math.abs(right - center.step) < 1e-9);
  });

  it("frames smaller boards edge to edge", () => {
    const view = viewport(fullBoard(9), 9);
    assert.deepEqual(view, { x: 0, y: 0, width: 320, height: 320 });
    assert.equal(boardEdge(19), 600);
    assert.deepEqual(placement(fullBoard(9), 40, 9), {
      x: 0.5,
      y: 0.5,
      step: 28 / 320,
    });
    // A 9×9 focus never grows past the board it's on.
    assert.deepEqual(focusRegion([40], 9), fullBoard(9));
  });
});
