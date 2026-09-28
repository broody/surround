import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EARTH,
  METEOR_CYCLE,
  METEOR_DURATION,
  antennaBeacon,
  createLunarDust,
  dishPose,
  earthAtmosphere,
  lunarDustPosition,
  outsideEarth,
  shootingStar,
  starPulse,
  stationLight,
} from "./lunarWeather.ts";

describe("lunar quiet motion", () => {
  it("softly pulses the fixed antenna beacon without hard flashes", () => {
    assert.equal(antennaBeacon(0), 1);
    assert.equal(antennaBeacon(2.4), 0.18);
    assert.equal(antennaBeacon(4.8), 1);
    for (const offset of [0, 3600, 86400, 1e8]) {
      for (let t = offset; t < offset + 10; t += 1 / 24) {
        const light = antennaBeacon(t);
        assert.ok(light >= 0.18 && light <= 1);
        assert.ok(Math.abs(antennaBeacon(t + 1 / 24) - light) < 0.03);
      }
    }
  });
  it("gently glimmers without synchronised or sudden star flashes", () => {
    for (let index = 0; index < 92; index++) {
      for (const t of [0, 1, 12, 50, 300, 3600, 86400, 1e8]) {
        assert.ok(Math.abs(starPulse(t, index)) <= 0.72);
        assert.ok(
          Math.abs(starPulse(t + 1 / 24, index) - starPulse(t, index)) < 0.04,
        );
      }
    }
    assert.notEqual(starPulse(10, 0), starPulse(10, 1));
    assert.equal(outsideEarth(EARTH.x, EARTH.y, 24), false);
    assert.equal(outsideEarth(700, 100, 24), true);
    const changed = Array.from({ length: 92 }, (_, i) =>
      Math.abs(starPulse(2, i) - starPulse(0, i)),
    ).filter((delta) => delta > 0.25);
    assert.ok(
      changed.length > 45,
      "twinkles should be visible within a few seconds",
    );
  });

  it("keeps the dish scan and independent station lights slow and bounded", () => {
    for (let t = 0; t < 600; t += 0.21) {
      const pose = dishPose(t);
      assert.ok(Math.abs(pose.angle) <= 0.14);
      assert.ok(pose.scaleX >= 0.9199 && pose.scaleX <= 1);
      assert.ok(Math.abs(dishPose(t + 1 / 24).angle - pose.angle) < 0.001);
      for (let i = 0; i < 4; i++) {
        assert.ok(stationLight(t, i) >= 0.1999 && stationLight(t, i) <= 0.8001);
        assert.ok(
          Math.abs(stationLight(t + 1 / 24, i) - stationLight(t, i)) < 0.015,
        );
      }
    }
    assert.ok(Math.abs(dishPose(54).angle) < 1e-12);
  });

  it("keeps Earth anchored with restrained but visible cloud drift and rim shimmer", () => {
    for (let t = 0; t < 1000; t += 0.37) {
      const atmosphere = earthAtmosphere(t);
      assert.ok(atmosphere.rim >= 0.0499 && atmosphere.rim <= 0.3101);
      assert.ok(atmosphere.clouds >= 0.2599 && atmosphere.clouds <= 0.3801);
      assert.ok(Math.abs(atmosphere.cloudX) <= 6);
      assert.ok(Math.abs(atmosphere.cloudY) <= 1.4);
    }
    assert.ok(earthAtmosphere(8).cloudX - earthAtmosphere(0).cloudX > 3);
  });

  it("keeps rare shooting stars entirely in the sky, away from Earth", () => {
    let visibleSamples = 0;
    for (let t = 0; t < 600; t += 0.05) {
      const meteor = shootingStar(t);
      if (!meteor) continue;
      visibleSamples++;
      assert.ok(outsideEarth(meteor.x - meteor.tail, meteor.y, 30));
      assert.ok(meteor.x >= 650 && meteor.x <= 1410);
      assert.ok(meteor.y >= 64 && meteor.y <= 231);
      assert.ok(meteor.opacity >= 0 && meteor.opacity <= 0.62);
    }
    assert.ok(visibleSamples > 300 && visibleSamples < 500);
    assert.equal(shootingStar(0), null);
    assert.equal(shootingStar(10.99), null);
    assert.ok(shootingStar(11.7));
    assert.equal(shootingStar(11 + METEOR_DURATION), null);
    assert.equal(shootingStar(METEOR_CYCLE), null);
  });

  it("distributes deterministic, sparse lunar dust and fades before wrapping", () => {
    const motes = createLunarDust();
    assert.equal(motes.length, 96);
    assert.deepEqual(motes, createLunarDust());
    for (const mote of motes) {
      assert.ok(mote.size >= 2 && mote.size <= 4);
      for (const time of [0, 1, 50, 300, 3600, 86400, 1e8]) {
        const p = lunarDustPosition(mote, time);
        assert.ok(p.x > 50 && p.x < 1610 && p.y > 440 && p.y < 941);
        assert.ok(p.opacity >= 0 && p.opacity <= mote.opacity);
      }
      const loop = (1 - mote.phase) * mote.duration;
      assert.ok(lunarDustPosition(mote, loop).opacity < 1e-10);
      // Below one alpha level before wrap, even for the brighter/faster dust.
      assert.ok(lunarDustPosition(mote, loop - 0.001).opacity < 1 / 255);
    }
    for (const t of [0, 1, 10, 50, 300]) {
      assert.ok(
        motes.filter((mote) => lunarDustPosition(mote, t).opacity > 0.45)
          .length > 40,
      );
    }
  });

  it("freezes all effects at a fixed scene time", () => {
    const snapshot = (t: number) => ({
      dish: dishPose(t),
      beacon: antennaBeacon(t),
      earth: earthAtmosphere(t),
      stars: [0, 12, 48].map((i) => starPulse(t, i)),
      lights: [0, 1, 2, 3].map((i) => stationLight(t, i)),
      dust: createLunarDust().map((mote) => lunarDustPosition(mote, t)),
      meteor: shootingStar(t),
    });
    assert.deepEqual(snapshot(11.7), snapshot(11.7));
    assert.notDeepEqual(snapshot(11.7), snapshot(12));
  });
});
