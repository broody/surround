import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDustMotes,
  dojoBreeze,
  dustPosition,
  foliageOffset,
  sunbeamStrength,
  sunlightLevel,
} from "./sunlitWeather.ts";

describe("sunlit dojo weather", () => {
  it("keeps tree roots stationary while the canopy rustles within bounds", () => {
    let moved = false;
    for (let t = 0; t < 300; t += 0.31) {
      assert.equal(foliageOffset(491, 491, t, 0.3, 4.6), 0);
      for (const row of [0, 100, 250, 490]) {
        const offset = foliageOffset(row, 491, t, 0.3, 4.6);
        assert.ok(Math.abs(offset) <= 4.6);
        if (Math.abs(offset) > 1) moved = true;
      }
    }
    assert.ok(moved);
  });
  it("has gentle, continuous daylight and bounded wind over long sessions", () => {
    for (const t of [0, 1, 10, 42, 300, 3600, 86400, 1e8]) {
      assert.ok(Math.abs(dojoBreeze(t)) <= 1);
      assert.ok(sunlightLevel(t) >= 0.65 && sunlightLevel(t) <= 0.99);
      assert.ok(Math.abs(sunlightLevel(t + 1 / 24) - sunlightLevel(t)) < 0.003);
    }
  });
  it("creates repeatable, small dust particles that fade out before wrapping", () => {
    const motes = createDustMotes();
    assert.equal(motes.length, 112);
    assert.deepEqual(motes, createDustMotes());
    for (const mote of motes) {
      assert.ok(mote.size >= 2 && mote.size <= 4);
      for (const t of [0, 0.5, 30, 300, 3600, 86400, 1e8]) {
        const p = dustPosition(mote, t);
        assert.ok(p.x > 0 && p.x < 1672 && p.y > 0 && p.y < 941);
        assert.ok(p.opacity >= 0 && p.opacity <= mote.opacity);
      }
      const loop = (1 - mote.phase) / mote.speed;
      assert.ok(dustPosition(mote, loop).opacity < 1e-10);
      assert.ok(dustPosition(mote, loop - 0.001).opacity < 2e-7);
    }
  });
  it("keeps enough visible dust near the window instead of hiding it all behind the board", () => {
    const motes = createDustMotes();
    for (const time of [0, 1, 4, 12, 60, 300]) {
      const visible = motes
        .map((mote) => dustPosition(mote, time))
        .filter((p) => p.opacity > 0.25 && p.x >= 326 && p.y >= 220);
      assert.ok(
        visible.length >= 32,
        `Only ${visible.length} visible motes at ${time}s`,
      );
      assert.ok(visible.filter((p) => p.x < 600).length >= 10);
    }
  });
  it("only illuminates motes in the shaft and freezes at a fixed scene time", () => {
    assert.equal(sunbeamStrength(100, 500), 0);
    assert.equal(sunbeamStrength(360 + 320 * 0.98, 500), 1);
    const sample = createDustMotes()[12];
    assert.deepEqual(dustPosition(sample, 45), dustPosition(sample, 45));
    assert.notDeepEqual(dustPosition(sample, 45), dustPosition(sample, 48));
  });
});
