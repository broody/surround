import { memo } from "react";
import SceneCanvas, {
  type SceneImages,
  type ScenePainter,
} from "./SceneCanvas";
import {
  createCanvas,
  SCENE_WIDTH as WIDTH,
  SCENE_HEIGHT as HEIGHT,
} from "./layers";
import {
  accretionPhase,
  celestialMotePosition,
  createCelestialMotes,
  eventideStarPulse,
  filamentPoint,
  floorShimmer,
  islandPose,
  terraceLight,
} from "./eventideMotion";
import "./eventide.css";
import { createHorizonWarp, horizonDestinationPoint } from "./eventideLensing";

const ASSETS = {
  original: "/assets/eventide/original.png",
  plate: "/assets/eventide/clean-plate.png",
  islands: "/assets/eventide/islands.png",
};

// AI cutouts have their own bounds; explicitly restore the approved scene scale.
const ISLANDS = [
  { source: [198, 412, 189, 168], target: [215, 453, 142, 126] },
  { source: [86, 500, 125, 130], target: [130, 507, 83, 88] },
  { source: [1335, 335, 260, 251], target: [1405, 384, 188, 184] },
  { source: [1321, 539, 59, 78], target: [1375, 531, 47, 65] },
] as const;

function prepare(images: SceneImages): ScenePainter {
  const base = createCanvas(WIDTH, HEIGHT);
  const baseContext = base.getContext("2d")!;
  baseContext.drawImage(images.original, 0, 0, WIDTH, HEIGHT);
  const islands = ISLANDS.map(({ source, target }) => {
    const [x, y, w, h] = target;
    // Feather the backing patch well outside the old silhouette. The foreground
    // is restored last, including the parapet and columns in front of the islands.
    const pad = 9;
    const patch = createCanvas(w + pad * 2, h + pad * 2);
    const ctx = patch.getContext("2d")!;
    ctx.drawImage(
      images.plate,
      x - pad,
      y - pad,
      patch.width,
      patch.height,
      0,
      0,
      patch.width,
      patch.height,
    );
    const pixels = ctx.getImageData(0, 0, patch.width, patch.height);
    for (let py = 0; py < patch.height; py++) {
      for (let px = 0; px < patch.width; px++) {
        const edge = Math.min(
          px,
          py,
          patch.width - 1 - px,
          patch.height - 1 - py,
        );
        pixels.data[(py * patch.width + px) * 4 + 3] =
          Math.min(1, edge / 5) * 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    baseContext.drawImage(patch, x - pad, y - pad);
    const sprite = createCanvas(w, h);
    const spriteContext = sprite.getContext("2d")!;
    spriteContext.imageSmoothingEnabled = false;
    const [sx, sy, sw, sh] = source;
    spriteContext.drawImage(images.islands, sx, sy, sw, sh, 0, 0, w, h);
    return { sprite, x, y, w, h };
  });

  const source = baseContext.getImageData(0, 0, WIDTH, HEIGHT).data;
  const warmAt = (x: number, y: number) => {
    if (x < 65 || x >= 1605 || y < 0 || y >= 545 || (x < 230 && y > 260))
      return 0;
    const i = (Math.floor(y) * WIDTH + Math.floor(x)) * 4;
    const r = source[i],
      g = source[i + 1],
      b = source[i + 2];
    return r > 90 && g > 48 && r > b * 1.16
      ? Math.max(0, Math.min(1, (r - b - 12) / 80))
      : 0;
  };

  // Registered illumination field follows the existing warm pixel filaments.
  // A localized lensing pass below bends this light together with the rim.
  const shade = createCanvas(WIDTH / 2, 300);
  const shadeContext = shade.getContext("2d")!;
  const shadePixels = shadeContext.createImageData(shade.width, shade.height);
  const flow: {
    offset: number;
    weight: number;
    a: number;
    b: number;
    c: number;
    d: number;
  }[] = [];
  for (let y = 0; y < shade.height; y++) {
    for (let x = 0; x < shade.width; x++) {
      const weight = warmAt(x * 2, y * 2);
      if (!weight) continue;
      const phase = accretionPhase(x * 2, y * 2);
      flow.push({
        offset: (y * shade.width + x) * 4 + 3,
        weight,
        a: Math.sin(phase),
        b: Math.cos(phase),
        c: Math.sin(phase * 2.7),
        d: Math.cos(phase * 2.7),
      });
    }
  }

  const warp = createHorizonWarp(source, WIDTH, HEIGHT);
  const lens = createCanvas(warp.width, warp.height);
  const lensContext = lens.getContext("2d")!;
  const lensPixels = lensContext.createImageData(warp.width, warp.height);

  const candidates: { x: number; y: number; light: number }[] = [];
  for (let y = 12; y < 587; y++) {
    for (let x = 70; x < 1600; x++) {
      if (
        (x < 230 && y > 260) ||
        warmAt(x, y) > 0 ||
        Math.hypot(x - 892, y - 249) < 285 ||
        Math.abs(y - (250 + (x - 835) * 0.085)) < 90
      )
        continue;
      const i = (y * WIDTH + x) * 4;
      const light = Math.min(source[i], source[i + 1], source[i + 2]);
      if (light > 158) candidates.push({ x, y, light });
    }
  }
  candidates.sort((a, b) => b.light - a.light);
  const stars: {
    x: number;
    y: number;
    light: HTMLCanvasElement;
    dark: HTMLCanvasElement;
  }[] = [];
  for (const candidate of candidates) {
    if (
      stars.some(
        (s) => Math.hypot(s.x + 5 - candidate.x, s.y + 5 - candidate.y) < 26,
      )
    )
      continue;
    const light = createCanvas(11, 11);
    const ctx = light.getContext("2d")!;
    ctx.drawImage(base, candidate.x - 5, candidate.y - 5, 11, 11, 0, 0, 11, 11);
    const pixels = ctx.getImageData(0, 0, 11, 11);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i + 3] = Math.max(
        0,
        Math.min(
          255,
          (Math.min(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) -
            55) *
            2,
        ),
      );
    }
    ctx.putImageData(pixels, 0, 0);
    const dark = createCanvas(11, 11);
    const darkContext = dark.getContext("2d")!;
    darkContext.drawImage(light, 0, 0);
    darkContext.globalCompositeOperation = "source-in";
    darkContext.fillStyle = "#060714";
    darkContext.fillRect(0, 0, 11, 11);
    stars.push({ x: candidate.x - 5, y: candidate.y - 5, light, dark });
    if (stars.length >= 95) break;
  }

  // Foreground matte: drifting scenery passes behind the stationary parapet.
  const foreground = createCanvas(WIDTH, HEIGHT);
  const frontContext = foreground.getContext("2d")!;
  frontContext.drawImage(
    images.original,
    0,
    598,
    WIDTH,
    HEIGHT - 598,
    0,
    598,
    WIDTH,
    HEIGHT - 598,
  );
  for (const [x, y, w, h] of [
    [378, 570, 54, 30],
    [648, 570, 44, 30],
    [978, 570, 50, 30],
    [1241, 570, 57, 30],
    [0, 0, 64, 600],
    [1608, 0, 64, 600],
  ]) {
    frontContext.drawImage(images.original, x, y, w, h, x, y, w, h);
  }

  const floor = createCanvas(WIDTH, 309);
  const floorContext = floor.getContext("2d")!;
  floorContext.drawImage(images.original, 0, 632, WIDTH, 309, 0, 0, WIDTH, 309);
  const floorPixels = floorContext.getImageData(0, 0, WIDTH, 309);
  for (let i = 0; i < floorPixels.data.length; i += 4) {
    const r = floorPixels.data[i],
      g = floorPixels.data[i + 1],
      b = floorPixels.data[i + 2];
    floorPixels.data[i + 3] =
      r > 70 && r > g * 1.08 && r > b * 1.4 ? Math.min(255, (r - b) * 2.8) : 0;
  }
  floorContext.putImageData(floorPixels, 0, 0);

  const lamp = createCanvas(44, 30);
  const lampContext = lamp.getContext("2d")!;
  const glow = lampContext.createRadialGradient(22, 15, 0, 22, 15, 22);
  glow.addColorStop(0, "rgba(116, 220, 235, 0.45)");
  glow.addColorStop(1, "rgba(80, 194, 220, 0)");
  lampContext.fillStyle = glow;
  lampContext.fillRect(0, 0, 44, 30);
  const motes = createCelestialMotes();

  return (context, time) => {
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.drawImage(base, 0, 0);
    const cos = Math.cos(time * 0.72),
      sin = Math.sin(time * 0.72);
    const detailCos = Math.cos(time * 1.05),
      detailSin = Math.sin(time * 1.05);
    for (const cell of flow) {
      // Algebraically identical to flowShade; trig is shared across all pixels.
      const amount =
        0.05 +
        (0.5 + (cell.a * cos - cell.b * sin) * 0.5) * 0.12 +
        (0.5 + (cell.c * detailCos - cell.d * detailSin) * 0.5) * 0.035;
      shadePixels.data[cell.offset] = amount * cell.weight * 255;
    }
    shadeContext.putImageData(shadePixels, 0, 0);
    context.drawImage(shade, 0, 0, WIDTH, 600);
    warp.paint(lensPixels.data, shadePixels.data, shade.width, time);
    lensContext.putImageData(lensPixels, 0, 0);
    context.drawImage(lens, warp.x, warp.y);

    // Short amber filaments follow the lensed ring and oblique disk, clipped to
    // actual illuminated pixels so none can drift across the black silhouette.
    context.globalCompositeOperation = "screen";
    for (let filament = 0; filament < 22; filament++) {
      for (let tail = 11; tail >= 0; tail--) {
        const p = filamentPoint(filament, time, tail);
        const weight = warmAt(p.x, p.y);
        if (!weight) continue;
        const bent = horizonDestinationPoint(p.x, p.y, time);
        context.globalAlpha = (1 - tail / 12) * 0.56 * weight;
        context.fillStyle = "#edb677";
        context.fillRect(
          Math.round(bent.x),
          Math.round(bent.y),
          tail === 0 ? 3 : 2,
          1,
        );
      }
    }
    stars.forEach((star, index) => {
      const pulse = eventideStarPulse(index, time);
      context.globalCompositeOperation = pulse > 0 ? "screen" : "source-over";
      context.globalAlpha = Math.abs(pulse);
      context.drawImage(pulse > 0 ? star.light : star.dark, star.x, star.y);
    });

    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    islands.forEach((island, index) => {
      const pose = islandPose(index, time);
      context.save();
      context.translate(
        island.x + island.w / 2 + pose.x,
        island.y + island.h / 2 + pose.y,
      );
      context.rotate(pose.angle);
      context.drawImage(island.sprite, -island.w / 2, -island.h / 2);
      context.restore();
    });
    context.drawImage(foreground, 0, 0);

    context.globalCompositeOperation = "screen";
    for (let x = 0; x < WIDTH; x += 48) {
      const w = Math.min(48, WIDTH - x);
      context.globalAlpha = floorShimmer(x, time);
      context.drawImage(floor, x, 0, w, 309, x, 632, w, 309);
    }
    [267, 538, 836, 1137, 1406].forEach((x, i) => {
      const level = terraceLight(i, time);
      context.globalAlpha = level * 0.6;
      context.drawImage(lamp, x - 22, 622 - 15);
      context.fillStyle = "#99e3ea";
      context.fillRect(x - 7, 621, 14, 3);
      // Broken pixel reflections remain attached to each recessed lamp.
      for (let row = 0; row < 7; row++) {
        context.globalAlpha = level * (0.13 - row * 0.015);
        context.fillRect(x - 6 - row, 645 + row * 4, 12 + row * 2, 2);
      }
    });

    context.globalCompositeOperation = "source-over";
    for (const mote of motes) {
      const p = celestialMotePosition(mote, time);
      context.globalAlpha = p.opacity;
      context.fillStyle = mote.amber ? "#e6bf81" : "#a6d9e3";
      context.fillRect(Math.round(p.x), Math.round(p.y), mote.size, mote.size);
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  };
}

export default memo(function EventideScene({ moving }: { moving: boolean }) {
  return (
    <SceneCanvas
      name="eventide"
      moving={moving}
      assets={ASSETS}
      fallback={ASSETS.original}
      prepare={prepare}
    />
  );
});
