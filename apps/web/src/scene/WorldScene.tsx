import { memo } from "react";
import SceneCanvas, { type SceneImages, type ScenePainter } from "./SceneCanvas";
import { createCanvas, SCENE_WIDTH as WIDTH, SCENE_HEIGHT as HEIGHT } from "./layers";
import { WORLD_SCENES, type Plant, type Point, type Rect } from "./worldSceneConfig";
import { splitWorldClouds } from "./worldCloudLayers";
import {
  createWorldParticles, sailboatPose, worldBranchBend, worldCloudCopies, WORLD_CLOUD_WIDTH,
  worldGlint, worldLight, worldParticlePosition, worldRipple, worldStar,
  WORLD_IDS, type WorldId,
} from "./worldMotion";
import "./world-scenes.css";

function crop(image: CanvasImageSource, rect: Rect, width = rect[2], height = rect[3]) {
  const canvas = createCanvas(width, height);
  const c = canvas.getContext("2d")!;
  c.imageSmoothingEnabled = false;
  c.drawImage(image, ...rect, 0, 0, width, height);
  return canvas;
}

function polygon(points: readonly Point[]) {
  const path = new Path2D();
  points.forEach(([x, y], i) => i ? path.lineTo(x, y) : path.moveTo(x, y));
  path.closePath();
  return path;
}

function highlights(texture: HTMLCanvasElement, warm: boolean) {
  const result = crop(texture, [0, 0, texture.width, texture.height]);
  const c = result.getContext("2d")!;
  const pixels = c.getImageData(0, 0, result.width, result.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const [r, g, b] = pixels.data.subarray(i, i + 3);
    const visible = warm ? r > 145 && r > g * 1.12 && g > b * 1.12 : r + g + b > 490 && g > 125;
    pixels.data[i + 3] = visible ? Math.min(255, (Math.max(r, g) - 120) * 2) : 0;
  }
  c.putImageData(pixels, 0, 0);
  return result;
}

function drawPlant(context: CanvasRenderingContext2D, texture: HTMLCanvasElement, spec: Plant, time: number) {
  const [x, y] = spec.target ?? spec.source;
  const horizontal = spec.axis === "x";
  const length = horizontal ? texture.width : texture.height;
  const bend = (p: number) => worldBranchBend(
    spec.anchor === "start" ? p / length : 1 - p / length, time, spec.phase, spec.amplitude,
  );
  for (let p = 0; p < length; p += 8) {
    const span = Math.min(8, length - p), sample = Math.min(span + 1, length - p);
    const a = bend(p), b = bend(p + span);
    context.save();
    if (horizontal) {
      context.transform(1, (b - a) / span, 0, 1, x + p, y + a);
      context.drawImage(texture, p, 0, sample, texture.height, 0, 0, sample, texture.height);
    } else {
      context.transform(1, 0, (b - a) / span, 1, x + a, y + p);
      context.drawImage(texture, 0, p, texture.width, sample, 0, 0, texture.width, sample);
    }
    context.restore();
  }
}

function prepareWorld(id: WorldId, images: SceneImages): ScenePainter {
  const spec = WORLD_SCENES[id];
  // Normalize the rare 1671px imagegen result without modifying saved PNGs.
  const normalized = Object.fromEntries(Object.entries(images).map(([key, image]) => {
    const canvas = createCanvas(WIDTH, HEIGHT);
    canvas.getContext("2d")!.drawImage(image, 0, 0, WIDTH, HEIGHT);
    return [key, canvas];
  }));
  const original = normalized.original, plate = normalized.plate;
  const base = crop(original, [0, 0, WIDTH, HEIGHT]);
  const bc = base.getContext("2d")!;
  const sky = polygon(spec.sky);
  bc.save();
  bc.clip(sky);
  bc.drawImage(plate, 0, 0);
  bc.restore();
  for (const [x, y, w, h] of spec.patches) {
    const patch = crop(plate, [x, y, w, h]);
    const pc = patch.getContext("2d")!;
    const pixels = pc.getImageData(0, 0, w, h);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const edge = Math.min(x === 0 ? 20 : px, x + w === WIDTH ? 20 : w - 1 - px,
          y === 0 ? 20 : py, y + h === HEIGHT ? 20 : h - 1 - py);
        pixels.data[(py * w + px) * 4 + 3] = Math.min(1, edge / 14) * 255;
      }
    }
    pc.putImageData(pixels, 0, 0);
    bc.drawImage(patch, x, y);
  }
  const plants = spec.plants.map((plant) => ({
    spec: plant,
    texture: crop(normalized.foliage, plant.source,
      plant.target?.[2] ?? plant.source[2], plant.target?.[3] ?? plant.source[3]),
  }));
  const foreground = createCanvas(WIDTH, HEIGHT);
  const fc = foreground.getContext("2d")!;
  for (const rect of spec.frontRects) fc.drawImage(original, ...rect, ...rect);
  for (const points of spec.frontPolygons ?? []) {
    fc.save();
    fc.clip(polygon(points));
    fc.drawImage(original, 0, 0);
    fc.restore();
  }
  const water = spec.water ? {
    texture: crop(base, spec.water.bounds), path: polygon(spec.water.polygon),
    glints: highlights(crop(base, spec.water.bounds), spec.water.warm), spec: spec.water,
  } : undefined;
  const lights = spec.lights.map((rect) => ({ rect, texture: highlights(crop(original, rect), true) }));
  const particles = createWorldParticles(id, spec.particles.areas, spec.particles.count);
  const boat = spec.boat ? crop(normalized.foliage, spec.boat) : undefined;
  const cloudPixels = normalized.clouds.getContext("2d")!.getImageData(0, 0, WIDTH, HEIGHT);
  const clouds = splitWorldClouds(id, WIDTH, HEIGHT, cloudPixels.data).map(({ depth, pixels }) => {
    const source = createCanvas(WIDTH, HEIGHT);
    source.getContext("2d")!.putImageData(new ImageData(pixels, WIDTH, HEIGHT), 0, 0);
    const texture = crop(source, [0, 0, WIDTH, HEIGHT], WORLD_CLOUD_WIDTH, HEIGHT);
    const cc = texture.getContext("2d")!;
    // Feather only the outside of the repeating tile, never through a cloud.
    const edge = cc.createLinearGradient(0, 0, WORLD_CLOUD_WIDTH, 0);
    edge.addColorStop(0, "transparent");
    edge.addColorStop(24 / WORLD_CLOUD_WIDTH, "#fff");
    edge.addColorStop(1 - 24 / WORLD_CLOUD_WIDTH, "#fff");
    edge.addColorStop(1, "transparent");
    cc.globalCompositeOperation = "destination-in";
    cc.fillStyle = edge;
    cc.fillRect(0, 0, WORLD_CLOUD_WIDTH, HEIGHT);
    return { depth, texture };
  });

  return (context, time) => {
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.drawImage(base, 0, 0);
    context.save();
    context.clip(sky);
    context.globalAlpha = id === "venice" || id === "petra" ? 0.78 : 0.86;
    for (const layer of clouds) for (const cloud of worldCloudCopies(id, time, layer.depth)) {
      context.drawImage(layer.texture, cloud.x, cloud.y);
    }
    context.restore();

    if (water) {
      const [x, y, w, h] = water.spec.bounds;
      context.save();
      context.clip(water.path);
      for (let row = 0; row < h; row += 2) {
        const height = Math.min(2, h - row);
        const shift = worldRipple(row / h, row, time, water.spec.amplitude);
        context.drawImage(water.texture, 0, row, w, height, x + shift, y + row, w, height);
        context.globalCompositeOperation = "screen";
        context.globalAlpha = worldGlint(row, time, water.spec.glint);
        context.drawImage(water.glints, 0, row, w, height, x + shift, y + row, w, height);
        context.globalAlpha = 1;
        context.globalCompositeOperation = "source-over";
      }
      context.restore();
    }
    if (boat && spec.boat) {
      const pose = sailboatPose(time);
      context.drawImage(boat, spec.boat[0] + pose.x, spec.boat[1] + pose.y);
    }
    for (const plant of plants) drawPlant(context, plant.texture, plant.spec, time);
    context.drawImage(foreground, 0, 0);
    context.globalCompositeOperation = "screen";
    lights.forEach(({ rect, texture }, i) => {
      context.globalAlpha = worldLight(time, i * 1.73);
      context.drawImage(texture, rect[0], rect[1]);
    });
    context.fillStyle = "#dce6ff";
    (spec.stars ?? []).forEach(([x, y], i) => {
      context.globalAlpha = worldStar(time, i * 2.1);
      context.fillRect(x, y, 2, 2);
    });
    context.globalCompositeOperation = "source-over";
    context.fillStyle = spec.particles.color;
    for (const particle of particles) {
      const p = worldParticlePosition(particle, time);
      context.globalAlpha = p.opacity;
      const width = spec.particles.leaves ? Math.max(1, Math.round(Math.abs(p.turn) * particle.size * 2)) : particle.size;
      context.fillRect(Math.round(p.x), Math.round(p.y), width, particle.size);
    }
    context.globalAlpha = 1;
  };
}

function makeWorldScene(id: WorldId) {
  const root = `/assets/world/${id}`;
  const assets = { original: `${root}/original.png`, plate: `${root}/clean-plate.png`,
    foliage: `${root}/foliage.png`, clouds: `${root}/clouds.png` };
  const prepare = (images: SceneImages) => prepareWorld(id, images);
  return memo(function WorldScene({ moving }: { moving: boolean }) {
    return <SceneCanvas name={id} moving={moving} assets={assets} prepare={prepare} fallback={assets.original} />;
  });
}

export const WORLD_SCENE_CHOICES = Object.fromEntries(WORLD_IDS.map((id) => {
  const { label, title, heading, caption, description } = WORLD_SCENES[id];
  return [id, { label, title, heading, caption, description, component: makeWorldScene(id) }];
})) as Record<WorldId, Pick<(typeof WORLD_SCENES)[WorldId], "label" | "title" | "heading" | "caption" | "description"> & {
  component: ReturnType<typeof makeWorldScene>;
}>;
