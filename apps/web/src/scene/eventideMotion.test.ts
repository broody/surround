import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accretionPhase,
  BLACK_HOLE,
  celestialMotePosition,
  createCelestialMotes,
  eventideStarPulse,
  filamentPoint,
  floorShimmer,
  flowShade,
  islandPose,
  terraceLight,
} from "./eventideMotion.ts";
import {
  createHorizonWarp,
  horizonDestinationPoint,
  horizonSourcePoint,
  LENS_RADIUS,
} from "./eventideLensing.ts";

describe("Eventide celestial platform", () => {
  it("suspends islands independently without camera-scale movement", () => {
    for (let index = 0; index < 4; index++) {
      let moved = false;
      for (let t = 0; t < 600; t += 0.3) {
        const p = islandPose(index, t);
        assert.ok(Math.abs(p.x) <= 2.4);
        assert.ok(Math.abs(p.y) <= 5.3);
        assert.ok(Math.abs(p.angle) <= 0.004);
        assert.ok(Math.abs(islandPose(index, t + 1 / 24).y - p.y) < 0.05);
        if (Math.abs(p.y) > 3) moved = true;
      }
      assert.ok(moved);
    }
    assert.notDeepEqual(islandPose(0, 10), islandPose(1, 10));
  });

  it("flows light gently along the disk, without a global brightness flash", () => {
    for (const [x, y] of [
      [850, 285],
      [692, 215],
      [1060, 200],
      [890, 32],
      [350, 210],
    ]) {
      const phase = accretionPhase(x, y);
      for (const t of [0, 1, 15, 90, 3600, 86400, 1e8]) {
        const shade = flowShade(phase, t);
        assert.ok(shade >= 0.05 && shade <= 0.205);
        assert.ok(Math.abs(flowShade(phase, t + 1 / 24) - shade) < 0.004);
        // The renderer shares trigonometry across pixels; keep it equivalent.
        const fast =
          0.05 +
          (0.5 +
            (Math.sin(phase) * Math.cos(t * 0.72) -
              Math.cos(phase) * Math.sin(t * 0.72)) *
              0.5) *
            0.12 +
          (0.5 +
            (Math.sin(phase * 2.7) * Math.cos(t * 1.05) -
              Math.cos(phase * 2.7) * Math.sin(t * 1.05)) *
              0.5) *
            0.035;
        assert.ok(Math.abs(shade - fast) < 1e-8);
      }
    }
    assert.notEqual(
      flowShade(accretionPhase(800, 300), 0),
      flowShade(accretionPhase(950, 300), 0),
    );
  });

  it("keeps orbital light filaments in the sky with slow continuous motion", () => {
    for (let index = 0; index < 22; index++) {
      for (const t of [0, 1, 10, 100, 500, 3600, 86400]) {
        for (const tail of [0, 6, 11]) {
          const p = filamentPoint(index, t, tail);
          assert.ok(p.x > 65 && p.x < 1610 && p.y >= 0 && p.y < 530);
          const next = filamentPoint(index, t + 1 / 24, tail);
          assert.ok(Math.hypot(next.x - p.x, next.y - p.y) < 1.3);
        }
      }
    }
  });

  it("gently varies the stars, cyan lamps and warm floor reflections", () => {
    for (let t = 0; t < 200; t += 0.43) {
      for (let index = 0; index < 95; index++) {
        assert.ok(Math.abs(eventideStarPulse(index, t)) <= 0.5);
      }
      for (let index = 0; index < 5; index++) {
        assert.ok(
          terraceLight(index, t) >= 0.2999 && terraceLight(index, t) <= 0.8401,
        );
      }
      for (const x of [0, 300, 832, 1300, 1671]) {
        assert.ok(floorShimmer(x, t) >= 0.025 && floorShimmer(x, t) <= 0.1751);
      }
    }
  });

  it("leaves the dark core, distant sky and platform completely unwarped", () => {
    for (const radius of [0, 50, 92, LENS_RADIUS, 400, 800]) {
      for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
        const x = BLACK_HOLE.x + Math.cos(angle) * radius;
        const y = BLACK_HOLE.y + Math.sin(angle) * radius;
        for (const t of [0, 4, 30, 3600, 1e8]) {
          const p = horizonSourcePoint(x, y, t);
          assert.ok(Math.hypot(p.x - x, p.y - y) < 1e-10);
        }
      }
    }
  });

  it("bends the rim visibly but slowly, without texture folds or boundary seams", () => {
    let greatestMovement = 0;
    for (let radius = 92; radius <= LENS_RADIUS; radius += 8) {
      for (let angle = 0; angle < Math.PI * 2; angle += 0.18) {
        const x = BLACK_HOLE.x + Math.cos(angle) * radius;
        const y = BLACK_HOLE.y + Math.sin(angle) * radius;
        for (const t of [0, 3, 19, 70, 3600, 1e8]) {
          const p = horizonSourcePoint(x, y, t);
          assert.ok(Math.hypot(p.x - x, p.y - y) < 8.5);
          const next = horizonSourcePoint(x, y, t + 1 / 24);
          assert.ok(Math.hypot(p.x - next.x, p.y - next.y) < 0.15);
          const later = horizonSourcePoint(x, y, t + 3);
          greatestMovement = Math.max(
            greatestMovement,
            Math.hypot(p.x - later.x, p.y - later.y),
          );
          const right = horizonSourcePoint(x + 0.1, y, t);
          const down = horizonSourcePoint(x, y + 0.1, t);
          const jacobian =
            ((right.x - p.x) * (down.y - p.y) -
              (right.y - p.y) * (down.x - p.x)) /
            0.01;
          assert.ok(jacobian > 0.6 && jacobian < 1.5);
        }
      }
    }
    assert.ok(greatestMovement > 4);
  });

  it("registers moving light filaments to the distorted artwork", () => {
    for (const t of [0, 3, 30, 200, 86400]) {
      for (let i = 0; i < 22; i++) {
        const original = filamentPoint(i, t);
        const displayed = horizonDestinationPoint(original.x, original.y, t);
        const sampled = horizonSourcePoint(displayed.x, displayed.y, t);
        assert.ok(
          Math.hypot(sampled.x - original.x, sampled.y - original.y) < 0.02,
        );
      }
    }
  });

  it("resamples real pixels and their illumination without filling the fixed core", () => {
    const width = 1672,
      height = 941;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        source.set([x % 256, y % 256, (x + y) % 256, 255], i);
      }
    }
    const shade = new Uint8ClampedArray((width / 2) * 300 * 4);
    for (let i = 3; i < shade.length; i += 4) shade[i] = 51;
    const warp = createHorizonWarp(source, width, height);
    assert.ok(warp.width < 600 && warp.height < 600);
    const output = new Uint8ClampedArray(warp.width * warp.height * 4);
    warp.paint(output, shade, width / 2, 3);
    for (const [x, y] of [
      [892, 85],
      [1056, 249],
      [730, 240],
      [892, 413],
      [970, 48],
    ]) {
      const p = horizonSourcePoint(x, y, 3);
      const sx = Math.round(p.x),
        sy = Math.round(p.y);
      const from = (sy * width + sx) * 4;
      const to = ((y - warp.y) * warp.width + x - warp.x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        assert.ok(
          Math.abs(output[to + channel] - source[from + channel] * 0.8) <= 0.5,
        );
      }
      assert.equal(output[to + 3], 255);
    }
    const core =
      ((BLACK_HOLE.y - warp.y) * warp.width + BLACK_HOLE.x - warp.x) * 4;
    assert.equal(output[core + 3], 0);
    assert.equal(output[3], 0);
    const frozen = output.slice();
    warp.paint(output, shade, width / 2, 3);
    assert.deepEqual(output, frozen);
    warp.paint(output, shade, width / 2, 6);
    assert.notDeepEqual(output, frozen);
  });

  it("creates bounded, repeatable pixel motes that fade invisibly at each loop", () => {
    const motes = createCelestialMotes();
    assert.equal(motes.length, 48);
    assert.deepEqual(motes, createCelestialMotes());
    for (const mote of motes) {
      for (const t of [0, 1, 30, 300, 3600, 86400, 1e8]) {
        const p = celestialMotePosition(mote, t);
        assert.ok(p.x > 150 && p.x < 1520 && p.y > 550 && p.y < 941);
        assert.ok(p.opacity >= 0 && p.opacity <= 0.66);
      }
      const loop = (1 - mote.phase) * mote.duration;
      assert.ok(celestialMotePosition(mote, loop).opacity < 1e-10);
      assert.ok(celestialMotePosition(mote, loop - 0.001).opacity < 1 / 255);
    }
  });

  it("freezes every effect when shared scene time stops", () => {
    const snapshot = (t: number) => ({
      islands: [0, 1, 2, 3].map((i) => islandPose(i, t)),
      filaments: [0, 7, 15].map((i) => filamentPoint(i, t)),
      stars: eventideStarPulse(5, t),
      lamps: terraceLight(2, t),
      floor: floorShimmer(800, t),
      disk: flowShade(accretionPhase(750, 280), t),
      horizon: horizonSourcePoint(892, 85, t),
      motes: createCelestialMotes().map((mote) =>
        celestialMotePosition(mote, t),
      ),
    });
    assert.deepEqual(snapshot(27), snapshot(27));
    assert.notDeepEqual(snapshot(27), snapshot(28));
  });
});
