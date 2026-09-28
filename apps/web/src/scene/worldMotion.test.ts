import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { describe, it } from "node:test";
import { WORLD_SCENES } from "./worldSceneConfig.ts";
import { CLOUD_DEPTHS, splitWorldClouds } from "./worldCloudLayers.ts";
import { WORLD_IDS, createWorldParticles, sailboatPose, worldBranchBend,
  worldCloudCopies, worldCloudDrift, WORLD_CLOUD_WIDTH,
  worldGlint, worldLight, worldParticlePosition, worldRipple, worldStar,
} from "./worldMotion.ts";

// Check the decoded alpha, not just the file extension/header. No image library
// is needed in production or for these non-interlaced 8-bit RGBA source assets.
function decodeCutout(png: Buffer) {
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  assert.equal(png[24], 8); assert.equal(png[25], 6); assert.equal(png[28], 0);
  const chunks: Buffer[] = [];
  for (let p = 8; p < png.length;) {
    const n = png.readUInt32BE(p);
    if (png.toString("ascii", p + 4, p + 8) === "IDAT") chunks.push(png.subarray(p + 8, p + 8 + n));
    p += n + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = w * 4;
  const rgba = new Uint8ClampedArray(w * h * 4);
  let previous = new Uint8Array(stride), count = 0, visible = 0;
  for (let y = 0; y < h; y++) {
    const offset = y * (stride + 1), filter = raw[offset], row = new Uint8Array(stride);
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? row[x - 4] : 0, b = previous[x], c = x >= 4 ? previous[x - 4] : 0;
      let prediction = 0;
      if (filter === 1) prediction = a;
      if (filter === 2) prediction = b;
      if (filter === 3) prediction = Math.floor((a + b) / 2);
      if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        prediction = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = raw[offset + 1 + x] + prediction;
      if (x % 4 === 3) { if (row[x] > 0) count++; if (row[x] >= 128) visible++; }
    }
    previous = row;
    rgba.set(row, y * stride);
  }
  return { fraction: count / (w * h), visible, rgba, width: w, height: h };
}

describe("five world environments", () => {
  it("ships 20 distinct full-size assets, including ten genuinely transparent cutouts", () => {
    assert.equal(WORLD_IDS.length, 5);
    const hashes = new Set<string>();
    for (const id of WORLD_IDS) for (const file of ["original", "clean-plate", "foliage", "clouds"]) {
      const png = readFileSync(new URL(`../../public/assets/world/${id}/${file}.png`, import.meta.url));
      assert.equal(png.toString("hex", 0, 8), "89504e470d0a1a0a");
      assert.ok(png.readUInt32BE(16) >= 1671 && png.readUInt32BE(16) <= 1672);
      assert.equal(png.readUInt32BE(20), 941);
      hashes.add(createHash("sha256").update(png).digest("hex"));
      if (file === "foliage" || file === "clouds") {
        const alpha = decodeCutout(png);
        assert.ok(alpha.fraction > 0.001 && alpha.fraction < 0.6, `${id}/${file}: sparse alpha`);
        // Dawn wisps are intentionally translucent; require substantial visible
        // artwork, not fully opaque pixels that would rule out delicate clouds.
        assert.ok(alpha.visible > 20, `${id}/${file}: visible artwork exists`);
      }
    }
    assert.equal(hashes.size, 20);
  });

  it("registers all moving layers inside their source and provides five unique choices", () => {
    assert.equal(new Set(WORLD_IDS.map(id => WORLD_SCENES[id].label)).size, 5);
    for (const id of WORLD_IDS) {
      const s = WORLD_SCENES[id];
      assert.ok(s.sky.length > 20 && s.plants.length >= 2);
      for (const [x,y] of s.sky) assert.ok(x >= 0 && x <= 1672 && y >= 0 && y < 500);
      const rects = [...s.patches,...s.frontRects,...s.lights,
        ...s.plants.flatMap(p => p.target ? [p.source,p.target] : [p.source])];
      if (s.water) rects.push(s.water.bounds);
      if (s.boat) rects.push(s.boat);
      for (const [x,y,w,h] of rects) assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x+w <= 1672 && y+h <= 941, `${id}: source bounds`);
      assert.ok(s.particles.count >= 20 && s.particles.count <= 65);
    }
  });

  it("keeps all five cloud layers drifting without a turnaround or uncovered edge", () => {
    for (const id of WORLD_IDS) for (const depth of CLOUD_DEPTHS) {
      const speed = worldCloudDrift(id, 1, depth).x;
      const period = WORLD_CLOUD_WIDTH / speed;
      for (const time of [0,10,50,150,3600,86400,1e8,period-1/48,period,period+1/48]) {
        const p = worldCloudDrift(id,time,depth), q = worldCloudDrift(id,time+1/24,depth);
        assert.ok(p.x >= 0 && p.x < WORLD_CLOUD_WIDTH && Math.abs(p.y) <= 1.5);
        const advance = (q.x-p.x+WORLD_CLOUD_WIDTH) % WORLD_CLOUD_WIDTH;
        assert.ok(Math.abs(advance-speed/24) < 1e-6, `${id}: steady wind, including wrap`);
        const copies = worldCloudCopies(id,time,depth);
        assert.ok(copies.length >= 1 && copies.length <= 2);
        assert.ok(copies[0].x <= 0 && copies.at(-1)!.x+WORLD_CLOUD_WIDTH >= 1672);
        for (let i=1;i<copies.length;i++) assert.equal(copies[i-1].x+WORLD_CLOUD_WIDTH,copies[i].x);
        assert.ok(Math.abs(q.y-p.y) < 0.003);
      }
      assert.ok(worldCloudDrift(id,10,depth).x >= 2.3);
      assert.deepEqual(worldCloudCopies(id,42,depth),worldCloudCopies(id,42,depth));
    }
  });

  it("moves the distant clouds slower than the nearer clouds in every scene", () => {
    for (const id of WORLD_IDS) {
      const [far, middle, near] = CLOUD_DEPTHS.map(depth => worldCloudDrift(id, 30, depth).x);
      assert.ok(far > 0 && far < middle && middle < near);
      assert.ok(Math.abs(far / near - 0.32) < 1e-10);
      assert.ok(Math.abs(middle / near - 0.65) < 1e-10);
      assert.ok(near - far >= 15, `${id}: visible relative travel over 30 seconds`);
    }
  });

  it("preserves entire connected silhouettes across a depth boundary, including faint edges", () => {
    const width = 8, height = 300, pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 90; y < 221; y++) {
      pixels.set([210, 220, 230, 255], (y * width + 3) * 4);
      pixels.set([210, 220, 230, 8], (y * width + 4) * 4);
    }
    const layers = splitWorldClouds("venice", width, height, pixels);
    assert.deepEqual(layers.find(layer => layer.depth === "middle")!.pixels, pixels);
    for (const layer of layers.filter(layer => layer.depth !== "middle")) assert.ok(layer.pixels.every(v => v === 0));
  });

  it("gives each real scene three populated planes without dropping or duplicating cloud pixels", t => {
    for (const id of WORLD_IDS) {
      const png = readFileSync(new URL(`../../public/assets/world/${id}/clouds.png`, import.meta.url));
      const { rgba, width, height } = decodeCutout(png);
      const planes = splitWorldClouds(id, width, height, rgba);
      const coverage = [0, 0, 0];
      for (let p = 0; p < rgba.length; p += 4) {
        let alpha = 0;
        for (let i = 0; i < planes.length; i++) {
          const pixels = planes[i].pixels;
          alpha += pixels[p + 3];
          if (pixels[p + 3]) {
            for (let channel = 0; channel < 4; channel++) assert.equal(pixels[p + channel], rgba[p + channel]);
            if (pixels[p + 3] >= 128) coverage[i]++;
          }
        }
        assert.equal(alpha, rgba[p + 3]);
      }
      t.diagnostic(`${id}: far/middle/near visible pixels ${coverage.join("/")}`);
      assert.ok(coverage.every(count => count >= 100), `${id}: every parallax plane has real artwork`);
    }
  });

  it("anchors every plant while its outer leaves rustle smoothly", () => {
    for (const id of WORLD_IDS) for (const p of WORLD_SCENES[id].plants) {
      let maximum = 0;
      for (let t=0;t<80;t+=0.23) {
        assert.equal(Math.abs(worldBranchBend(0,t,p.phase,p.amplitude)),0);
        const a = worldBranchBend(1,t,p.phase,p.amplitude);
        maximum = Math.max(maximum,Math.abs(a));
        assert.ok(Math.abs(a) <= p.amplitude);
        assert.ok(Math.abs(worldBranchBend(1,t+1/24,p.phase,p.amplitude)-a) < 0.18);
      }
      assert.ok(maximum > p.amplitude*0.7);
    }
  });

  it("keeps water edges still and the Taj pool calmer than open water", () => {
    assert.ok(WORLD_SCENES.taj.water!.amplitude < WORLD_SCENES.patagonia.water!.amplitude);
    assert.equal(WORLD_SCENES.petra.water,undefined);
    for (const id of WORLD_IDS) {
      const water = WORLD_SCENES[id].water;
      if (!water) continue;
      for (let t=0;t<50;t+=0.83) {
        for (const edge of [-1,0,1,2]) assert.equal(Math.abs(worldRipple(edge,50,t,water.amplitude)),0);
        for (const depth of [0.1,0.3,0.7,0.9]) assert.ok(Math.abs(worldRipple(depth,80,t,water.amplitude)) <= water.amplitude);
        const light = worldGlint(80,t,water.glint);
        assert.ok(light >= 0 && light <= water.glint);
      }
    }
  });

  it("restrains lamplight, star twinkles and the small sailboat", () => {
    let min = Infinity, max = -Infinity;
    for (let t=0;t<1000;t+=0.31) {
      const lamp=worldLight(t,1.7),star=worldStar(t,2.1),boat=sailboatPose(t);
      assert.ok(lamp >= 0.08 && lamp <= 0.2051 && star >= 0.12 && star <= 0.641);
      assert.ok(Math.abs(boat.x) <= 95 && Math.abs(boat.y) <= 0.65);
      assert.ok(Math.abs(sailboatPose(t+1/24).x-boat.x) < 0.05);
      min=Math.min(min,boat.x); max=Math.max(max,boat.x);
    }
    assert.ok(max-min > 180);
    assert.equal(WORLD_SCENES.petra.stars?.length,5);
  });

  it("uses seeded particles, invisible resets and frozen shared time in all five scenes", () => {
    for (const id of WORLD_IDS) {
      const s=WORLD_SCENES[id].particles, particles=createWorldParticles(id,s.areas,s.count);
      assert.deepEqual(particles,createWorldParticles(id,s.areas,s.count));
      for (const particle of particles) {
        const reset=(1-particle.phase)*particle.duration;
        for (const t of [reset-0.001,reset,reset+0.001]) assert.ok(worldParticlePosition(particle,t).opacity < 0.001);
        const p=worldParticlePosition(particle,27);
        assert.deepEqual(p,worldParticlePosition(particle,27));
        assert.ok(p.opacity >= 0 && p.opacity <= 0.58);
      }
      assert.deepEqual(worldCloudDrift(id,42),worldCloudDrift(id,42));
      assert.notDeepEqual(worldCloudDrift(id,42),worldCloudDrift(id,43));
    }
  });
});
