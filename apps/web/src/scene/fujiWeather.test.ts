import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPineMotes,
  FUJI_BIRD_COUNT,
  fujiBirdPosition,
  fujiCloudBankDrift,
  fujiCloudDrift,
  lakeGlint,
  lakeOffset,
  LAKE_BOTTOM,
  LAKE_TOP,
  pineBend,
  pineMotePosition,
} from "./fujiWeather.ts";

describe("Fuji morning", () => {
  it("anchors the pine roots and gives the tips a bounded, smooth breeze", () => {
    let range = 0;
    for (const phase of [0.3, 2.1, 3.2, 1.4]) {
      for (let t = 0; t < 150; t += 0.37) {
        assert.equal(Math.abs(pineBend(0, t, phase, 5.2)), 0);
        for (const distance of [0.1, 0.4, 0.75, 1]) {
          const p = pineBend(distance, t, phase, 5.2);
          assert.ok(Math.abs(p) <= distance * distance * 5.2);
          assert.ok(
            Math.abs(pineBend(distance, t + 1 / 24, phase, 5.2) - p) < 0.18,
          );
          range = Math.max(range, Math.abs(p));
        }
      }
    }
    assert.ok(range > 4);
    assert.notEqual(pineBend(1, 12, 0.3, 5.2), pineBend(1, 12, 2.1, 5.2));
  });

  it("drifts the high clouds continuously without a visible loop reset", () => {
    for (let index = 0; index < 3; index++) {
      for (const t of [0, 1, 60, 180, 3600, 86400, 1e8]) {
        const p = fujiCloudDrift(index, t);
        const next = fujiCloudDrift(index, t + 1 / 24);
        assert.ok(Math.abs(p.x) <= 18 + index * 4);
        assert.ok(Math.abs(p.y) <= 1.4);
        assert.ok(Math.hypot(next.x - p.x, next.y - p.y) < 0.04);
      }
    }
  });

  it("confines ripples to the lake and fades them out at both fixed edges", () => {
    for (const t of [0, 1, 20, 1000, 1e8]) {
      for (const y of [0, LAKE_TOP, LAKE_BOTTOM, 730, 941])
        assert.equal(Math.abs(lakeOffset(y, t)), 0);
      for (let y = LAKE_TOP; y <= LAKE_BOTTOM; y++) {
        const shift = lakeOffset(y, t);
        assert.ok(Math.abs(shift) <= 2.25);
        assert.ok(Math.abs(lakeOffset(y, t + 1 / 24) - shift) < 0.09);
        const glow = lakeGlint(y - LAKE_TOP, t);
        assert.ok(glow >= 0.035 && glow <= 0.2751);
        assert.ok(Math.abs(lakeGlint(y - LAKE_TOP, t + 1 / 24) - glow) < 0.013);
      }
    }
  });

  it("gives the two cloud banks different continuous, bounded drift", () => {
    for (const layer of ["far", "near"] as const) {
      for (const t of [0, 10, 100, 3600, 86400, 1e8]) {
        const p = fujiCloudBankDrift(layer, t);
        const next = fujiCloudBankDrift(layer, t + 1 / 24);
        assert.ok(Math.abs(p.x) <= (layer === "far" ? 36 : 52));
        assert.ok(Math.abs(p.y) <= (layer === "far" ? 1.1 : 1.8));
        assert.ok(Math.hypot(next.x - p.x, next.y - p.y) < 0.065);
      }
    }
    assert.notDeepEqual(fujiCloudBankDrift("far", 30), fujiCloudBankDrift("near", 30));
    assert.ok(fujiCloudBankDrift("near", 10).x > 14);
  });

  it("sends individual birds across different paths with independent wingbeats", () => {
    assert.equal(FUJI_BIRD_COUNT, 2);
    for (let index = 0; index < FUJI_BIRD_COUNT; index++) {
      const start = index === 0 ? -18 : 27;
      const end = index === 0 ? 46 : 83;
      const entry = fujiBirdPosition(index, start);
      const exit = fujiBirdPosition(index, end - 0.001);
      assert.ok(index === 0 ? entry.x < 0 : entry.x > 1672);
      assert.ok(index === 0 ? exit.x > 1672 : exit.x < 0);
      const wings = new Set<number>();
      for (let t = start + 3; t < end - 3; t += 0.17) {
        const bird = fujiBirdPosition(index, t);
        const next = fujiBirdPosition(index, t + 1 / 24);
        assert.ok(index === 0 ? next.x > bird.x : next.x < bird.x);
        assert.ok(Math.abs(next.x - bird.x) < 1.4);
        assert.ok(bird.y > 175 && bird.y < 280);
        assert.ok(bird.span <= 5 && bird.span >= 4);
        assert.ok(bird.opacity > 0 && bird.opacity <= 0.9);
        assert.ok(Number.isInteger(bird.wing) && Math.abs(bird.wing) <= 2);
        wings.add(bird.wing);
      }
      assert.equal(wings.size, 5);
    }
    assert.ok(Math.abs(fujiBirdPosition(0, 35).y - fujiBirdPosition(1, 35).y) > 40);
  });

  it("usually shows one bird, occasionally two, with quiet gaps and invisible resets", () => {
    const visibleCount = (t: number) => Array.from(
      { length: FUJI_BIRD_COUNT }, (_, index) => fujiBirdPosition(index, t),
    ).filter((bird) => bird.opacity > 0 && bird.x >= 0 && bird.x <= 1672).length;
    assert.equal(visibleCount(0), 1);
    assert.equal(visibleCount(35), 2);
    assert.equal(visibleCount(65), 1);
    assert.equal(visibleCount(100), 0);
    const counts = [0, 0, 0];
    for (let t = 0; t < 1420; t += 0.25) {
      const count = visibleCount(t);
      assert.ok(count <= 2);
      counts[count]++;
    }
    assert.ok(counts[1] > counts[2] * 3);
    assert.ok(counts[0] > 0 && counts[2] > 0);
    for (let index = 0; index < FUJI_BIRD_COUNT; index++) {
      for (let t = 83; t <= 124; t++)
        assert.equal(fujiBirdPosition(index, t).opacity, 0);
      const end = index === 0 ? 46 : 83;
      const reset = index === 0 ? 124 : 169;
      for (const t of [end - 0.001, reset - 0.001, reset + 0.001]) {
        for (const repeat of [0, 142, 14200])
          assert.ok(fujiBirdPosition(index, t + repeat).opacity < 1 / 255);
      }
      assert.deepEqual(fujiBirdPosition(index, 15), fujiBirdPosition(index, 15));
    }
  });

  it("keeps a sparse deterministic mix of crisp motes near the pines", () => {
    const motes = createPineMotes();
    assert.equal(motes.length, 32);
    assert.deepEqual(motes, createPineMotes());
    for (const mote of motes) {
      assert.ok(mote.size === 2 || mote.size === 3);
      for (const t of [0, 1, 60, 3600, 86400, 1e8]) {
        const p = pineMotePosition(mote, t);
        assert.ok(p.x > 0 && p.x < 1672 && p.y > 200 && p.y < 755);
        assert.ok(p.opacity >= 0 && p.opacity <= 0.54);
      }
      const loop = (1 - mote.phase) * mote.duration;
      assert.ok(pineMotePosition(mote, loop).opacity < 1e-10);
      assert.ok(pineMotePosition(mote, loop - 0.001).opacity < 1 / 255);
    }
  });

  it("freezes all motion at the shared scene time", () => {
    const snapshot = (t: number) => ({
      pines: [0.3, 2.1, 3.2, 1.4].map((phase) => pineBend(1, t, phase, 5.2)),
      clouds: [0, 1, 2].map((index) => fujiCloudDrift(index, t)),
      cloudBanks: ["far", "near"].map((layer) => fujiCloudBankDrift(layer as "far" | "near", t)),
      birds: Array.from({ length: FUJI_BIRD_COUNT }, (_, index) => fujiBirdPosition(index, t)),
      lake: lakeOffset(575, t),
      glints: lakeGlint(99, t),
      motes: createPineMotes().map((mote) => pineMotePosition(mote, t)),
    });
    assert.deepEqual(snapshot(12), snapshot(12));
    assert.notDeepEqual(snapshot(12), snapshot(16));
  });
});
