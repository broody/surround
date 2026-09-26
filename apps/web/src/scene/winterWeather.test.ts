import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSnowflakes,
  snowPosition,
  winterLightLevel,
} from "./winterWeather.ts";

describe("winter weather", () => {
  it("has deterministic snow at three distinct depths", () => {
    const snow = createSnowflakes();
    assert.deepEqual(snow, createSnowflakes());
    assert.equal(snow.length, 174);
    assert.deepEqual([...new Set(snow.map((flake) => flake.depth))], [0, 1, 2]);
    assert.ok(
      Math.min(...snow.filter((f) => f.depth === 2).map((f) => f.speed)) >
        Math.max(...snow.filter((f) => f.depth === 0).map((f) => f.speed)),
    );
  });
  it("falls downward and wraps safely, even after long sessions", () => {
    const flake = { ...createSnowflakes()[0], y: 100 };
    assert.ok(snowPosition(flake, 1).y > snowPosition(flake, 0).y);
    for (const time of [0, 1, 60, 10000, 1000000]) {
      for (const snow of createSnowflakes()) {
        const position = snowPosition(snow, time);
        assert.ok(position.x >= 0 && position.x <= 1672);
        assert.ok(position.y >= -15 && position.y <= 745);
        assert.ok(position.opacity >= 0 && position.opacity <= 1);
      }
    }
  });
  it("keeps the same frozen state when scene time is paused", () => {
    for (const snow of createSnowflakes())
      assert.deepEqual(snowPosition(snow, 42.25), snowPosition(snow, 42.25));
    assert.equal(winterLightLevel(42.25, 0.5), winterLightLevel(42.25, 0.5));
  });
  it("breathes slowly without extinguishing or flashing the lights", () => {
    for (let time = 0; time < 40; time += 1 / 24) {
      const current = winterLightLevel(time, 1.8);
      assert.ok(current >= 0.03 && current <= 0.97);
      assert.ok(
        Math.abs(current - winterLightLevel(time + 1 / 24, 1.8)) < 0.02,
      );
    }
  });
});
