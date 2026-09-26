import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cloudDrift, createPetals, pavilionLightLevel, petalPosition } from "./pavilionWeather.ts";

describe("pavilion weather", () => {
  it("makes a repeatable mix of near and distant petals", () => {
    const petals = createPetals();
    assert.deepEqual(petals, createPetals());
    assert.equal(petals.length, 48);
    assert.deepEqual([...new Set(petals.map(p => p.depth))], [0, 1]);
    assert.ok(petals.every(p => p.speed > 0));
  });

  it("falls, flutters and fades before wrapping, even on long-running scenes", () => {
    const petal = { ...createPetals()[0], y: 100 };
    assert.ok(petalPosition(petal, 1).y > petalPosition(petal, 0).y);
    assert.equal(petalPosition({ ...petal, y: 0 }, 0).opacity, 0);
    for (const time of [0, 1, 60, 10000, 1000000]) {
      for (const p of createPetals()) {
        const position = petalPosition(p, time);
        assert.ok(position.x >= -34 && position.x <= 1706);
        assert.ok(position.y >= 40 && position.y <= 730);
        assert.ok(position.width >= 1 && position.width <= p.size);
        assert.ok(position.opacity >= 0 && position.opacity <= 0.7);
      }
    }
  });

  it("keeps cloud travel bounded and continuous with different depth speeds", () => {
    for (const time of [0, 29, 800, 1000000]) {
      for (const depth of [0, 1, 2]) {
        const a = cloudDrift(time, depth), b = cloudDrift(time + 1 / 24, depth);
        assert.ok(Math.abs(a.x) <= 26 + depth * 10);
        assert.ok(Math.abs(a.y) <= 1 + depth);
        assert.ok(Math.abs(b.x - a.x) < 0.1);
      }
    }
    assert.notDeepEqual(cloudDrift(12, 0), cloudDrift(12, 2));
  });

  it("freezes all weather at the same scene time and keeps light gentle", () => {
    for (const petal of createPetals())
      assert.deepEqual(petalPosition(petal, 21.5), petalPosition(petal, 21.5));
    assert.deepEqual(cloudDrift(21.5, 1), cloudDrift(21.5, 1));
    for (let time = 0; time < 100; time += 0.1) {
      const level = pavilionLightLevel(time, 2.6);
      assert.ok(level >= 0.04 && level <= 0.96);
      assert.ok(Math.abs(pavilionLightLevel(time + 1 / 24, 2.6) - level) < 0.012);
    }
  });
});
