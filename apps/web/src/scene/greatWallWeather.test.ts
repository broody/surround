import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  autumnLeafPosition, createAutumnLeaves, wallBreeze,
  wallCloudDrift, wallTreeBend,
} from "./greatWallWeather.ts";

describe("Great Wall autumn", () => {
  it("anchors tree roots while letting crowns rustle smoothly", () => {
    let maximum = 0;
    for (let t = 0; t < 200; t += 0.19) {
      assert.ok(Math.abs(wallBreeze(t)) <= 1);
      for (const phase of [0.4, 1.3, 3.2]) {
        assert.equal(Math.abs(wallTreeBend(0, t, phase, 3.8)), 0);
        for (const reach of [0.2, 0.5, 1]) {
          const bend = wallTreeBend(reach, t, phase, 3.8);
          assert.ok(Math.abs(bend) <= reach * reach * 3.8);
          assert.ok(Math.abs(wallTreeBend(reach, t + 1 / 24, phase, 3.8) - bend) < 0.17);
          maximum = Math.max(maximum, Math.abs(bend));
        }
      }
    }
    assert.ok(maximum > 3);
    assert.notEqual(wallTreeBend(1, 2, 0.4, 3.8), wallTreeBend(1, 2, 3.2, 3.8));
  });

  it("moves clouds at different depths without exposing an edge or snapping", () => {
    for (let layer = 0; layer < 2; layer++) {
      for (const t of [0, 10, 60, 150, 3600, 86400, 1e8]) {
        const p = wallCloudDrift(layer, t), q = wallCloudDrift(layer, t + 1 / 24);
        assert.ok(Math.abs(p.x) <= (layer === 0 ? 48 : 62));
        assert.ok(Math.abs(p.y) <= 1.3);
        assert.ok(Math.hypot(q.x - p.x, q.y - p.y) < 0.1);
        assert.ok(-70 + p.x < 0 && 1672 + 70 + p.x > 1672);
      }
      assert.ok(wallCloudDrift(layer, 10).x > 12);
    }
    assert.notDeepEqual(wallCloudDrift(0, 20), wallCloudDrift(1, 20));
  });

  it("creates reproducible autumn leaves at two depths, not glowing dust", () => {
    const leaves = createAutumnLeaves();
    assert.deepEqual(leaves, createAutumnLeaves());
    assert.equal(leaves.length, 44);
    assert.equal(leaves.filter((leaf) => leaf.near).length, 26);
    for (const leaf of leaves) {
      assert.ok(leaf.size >= 2 && leaf.size <= 5);
      assert.ok(leaf.color >= 0 && leaf.color < 4);
      assert.ok(leaf.duration >= 22);
      for (const t of [0, 12, 240, 86400, 1e8]) {
        const p = autumnLeafPosition(leaf, t);
        assert.ok(Object.values(p).every(Number.isFinite));
        assert.ok(p.opacity >= 0 && p.opacity <= (leaf.near ? 0.86 : 0.48));
        assert.ok(p.width >= 0.25 && p.width <= 1);
      }
    }
  });

  it("falls and drifts with invisible loop resets", () => {
    for (const leaf of createAutumnLeaves()) {
      const start = (1 - leaf.phase) * leaf.duration;
      for (const fraction of [0.2, 0.5, 0.8]) {
        const t = start + fraction * leaf.duration;
        const p = autumnLeafPosition(leaf, t), q = autumnLeafPosition(leaf, t + 1 / 24);
        assert.ok(q.y > p.y);
        assert.ok(Math.hypot(q.x - p.x, q.y - p.y) < 1.8);
      }
      for (const t of [start - 0.001, start, start + 0.001, start + leaf.duration])
        assert.ok(autumnLeafPosition(leaf, t).opacity < 0.001);
      assert.deepEqual(autumnLeafPosition(leaf, 27), autumnLeafPosition(leaf, 27));
    }
  });

  it("freezes all effects when shared scene time is paused", () => {
    const frame = (time: number) => ({
      clouds: [wallCloudDrift(0, time), wallCloudDrift(1, time)],
      trees: [0.4, 1.3, 3.2].map((p) => wallTreeBend(1, time, p, 3.8)),
      leaves: createAutumnLeaves().map((leaf) => autumnLeafPosition(leaf, time)),
    });
    assert.deepEqual(frame(35), frame(35));
    assert.notDeepEqual(frame(35), frame(36));
  });
});
