import { memo } from "react";
import SceneCanvas, {
  type SceneImages,
  type ScenePainter,
} from "./SceneCanvas";
import {
  createCanvas,
  SCENE_HEIGHT as HEIGHT,
  SCENE_WIDTH as WIDTH,
} from "./layers";
import {
  EARTH,
  antennaBeacon,
  createLunarDust,
  dishPose,
  earthAtmosphere,
  lunarDustPosition,
  outsideEarth,
  shootingStar,
  starPulse,
  stationLight,
} from "./lunarWeather";
import "./lunar.css";

const ASSETS = {
  original: "/assets/lunar/original.png",
  plate: "/assets/lunar/clean-plate.png",
  dish: "/assets/lunar/dish-v2.png",
};

function prepare(images: SceneImages): ScenePainter {
  const base = createCanvas(WIDTH, HEIGHT);
  const baseContext = base.getContext("2d")!;
  baseContext.drawImage(images.original, 0, 0, WIDTH, HEIGHT);

  // Only inpaint the tiny dish footprint; retain all other approved pixels.
  const patch = createCanvas(56, 55);
  const patchContext = patch.getContext("2d")!;
  patchContext.drawImage(images.plate, 1380, 449, 56, 55, 0, 0, 56, 55);
  const patchPixels = patchContext.getImageData(0, 0, 56, 55);
  for (let y = 0; y < 55; y++) {
    for (let x = 0; x < 56; x++) {
      const edge = Math.min(x, y, 55 - x, 54 - y);
      patchPixels.data[(y * 56 + x) * 4 + 3] = Math.min(1, edge / 3) * 255;
    }
  }
  patchContext.putImageData(patchPixels, 0, 0);
  baseContext.drawImage(patch, 1380, 449);

  // A clean, enlarged alpha sprite is registered back to the original tiny mount.
  // The mounting stem is 45% across the sprite, not at its bounding-box center.
  const dish = createCanvas(38, 44);
  const dishContext = dish.getContext("2d")!;
  dishContext.imageSmoothingEnabled = false;
  dishContext.drawImage(images.dish, 206, 146, 850, 984, 0, 0, 38, 44);

  const skyPixels = baseContext.getImageData(0, 0, WIDTH, 376);
  const candidates: { x: number; y: number; light: number }[] = [];
  // Pick existing stars, not random bright points over the planet or landscape.
  for (let y = 8; y < 366; y++) {
    for (let x = 8; x < WIDTH - 8; x++) {
      if (!outsideEarth(x, y, 24)) continue;
      const i = (y * WIDTH + x) * 4;
      const light = Math.min(
        skyPixels.data[i],
        skyPixels.data[i + 1],
        skyPixels.data[i + 2],
      );
      if (light > 115) candidates.push({ x, y, light });
    }
  }
  candidates.sort((a, b) => b.light - a.light);
  const stars: {
    x: number;
    y: number;
    texture: HTMLCanvasElement;
    dark: HTMLCanvasElement;
  }[] = [];
  for (const candidate of candidates) {
    if (
      stars.some(
        (star) =>
          Math.hypot(star.x + 6 - candidate.x, star.y + 6 - candidate.y) < 20,
      )
    )
      continue;
    const texture = createCanvas(13, 13);
    const ctx = texture.getContext("2d")!;
    ctx.drawImage(
      images.original,
      candidate.x - 6,
      candidate.y - 6,
      13,
      13,
      0,
      0,
      13,
      13,
    );
    const pixels = ctx.getImageData(0, 0, 13, 13);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const light = Math.min(
        pixels.data[i],
        pixels.data[i + 1],
        pixels.data[i + 2],
      );
      pixels.data[i + 3] = Math.max(0, Math.min(255, (light - 28) * 2.4));
    }
    ctx.putImageData(pixels, 0, 0);
    const dark = createCanvas(13, 13);
    const darkContext = dark.getContext("2d")!;
    darkContext.drawImage(texture, 0, 0);
    darkContext.globalCompositeOperation = "source-in";
    darkContext.fillStyle = "#00030a";
    darkContext.fillRect(0, 0, 13, 13);
    stars.push({ x: candidate.x - 6, y: candidate.y - 6, texture, dark });
    if (stars.length === 92) break;
  }

  // Source-derived cloud and blue-rim masks: no moving continents or globe wobble.
  const earthX = 96;
  const earthY = 16;
  const earthWidth = 414;
  const earthHeight = 381;
  const rim = createCanvas(earthWidth, earthHeight);
  const clouds = createCanvas(earthWidth, earthHeight);
  for (const [texture, kind] of [
    [rim, "rim"],
    [clouds, "clouds"],
  ] as const) {
    const ctx = texture.getContext("2d")!;
    ctx.drawImage(
      images.original,
      earthX,
      earthY,
      earthWidth,
      earthHeight,
      0,
      0,
      earthWidth,
      earthHeight,
    );
    const pixels = ctx.getImageData(0, 0, earthWidth, earthHeight);
    for (let y = 0; y < earthHeight; y++) {
      for (let x = 0; x < earthWidth; x++) {
        const i = (y * earthWidth + x) * 4;
        const [r, g, b] = pixels.data.subarray(i, i + 3);
        const radius = Math.hypot(
          (x + earthX - EARTH.x) / EARTH.rx,
          (y + earthY - EARTH.y) / EARTH.ry,
        );
        const mask =
          kind === "rim"
            ? radius > 0.88 && radius < 1.075 && b > r * 1.25
              ? Math.max(0, b - 95) / 160
              : 0
            : radius < 0.91 && r > 110 && g > 130 && b > 145
              ? (Math.min(r, g, b) - 110) / 145
              : 0;
        pixels.data[i + 3] = Math.min(1, mask) * 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
  }

  const motes = createLunarDust();
  const lights = [
    // Fixed pole tip, separate from the moving dish and its transform.
    { x: 1360, y: 469, color: "255, 48, 60", size: 3, beacon: true },
    { x: 1161, y: 540, color: "155, 224, 221", size: 2 },
    { x: 1431, y: 561, color: "255, 206, 138", size: 3 },
    { x: 1244, y: 541, color: "153, 209, 225", size: 2 },
  ].map((light) => {
    const glow = createCanvas(24, 24);
    const ctx = glow.getContext("2d")!;
    const gradient = ctx.createRadialGradient(12, 12, 0, 12, 12, 12);
    gradient.addColorStop(0, `rgba(${light.color}, 0.45)`);
    gradient.addColorStop(0.28, `rgba(${light.color}, 0.15)`);
    gradient.addColorStop(1, `rgba(${light.color}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 24, 24);
    return { ...light, glow };
  });

  return (context, time) => {
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.drawImage(base, 0, 0);

    stars.forEach((star, index) => {
      const pulse = starPulse(time, index);
      context.globalCompositeOperation = pulse > 0 ? "screen" : "source-over";
      context.globalAlpha = Math.abs(pulse);
      context.drawImage(pulse > 0 ? star.texture : star.dark, star.x, star.y);
      // Screen blending alone cannot brighten already-white star cores. A small
      // pixel cross grows at the peak, then the original star dims on the trough.
      if (pulse > 0.22 && index % 3 === 0) {
        context.globalAlpha = (pulse - 0.22) * 0.7;
        context.fillStyle = "#d8eaff";
        context.fillRect(star.x + 3, star.y + 6, 7, 1);
        context.fillRect(star.x + 6, star.y + 3, 1, 7);
      }
    });

    const atmosphere = earthAtmosphere(time);
    context.globalCompositeOperation = "screen";
    context.globalAlpha = atmosphere.rim;
    context.drawImage(rim, earthX, earthY);
    context.globalAlpha = atmosphere.clouds;
    context.drawImage(
      clouds,
      earthX + atmosphere.cloudX,
      earthY + atmosphere.cloudY,
    );

    const meteor = shootingStar(time);
    if (meteor) {
      const length = Math.hypot(meteor.dx, meteor.dy);
      // A tiny stepped tail keeps the meteor in the scene's pixel-art vocabulary.
      for (let segment = Math.ceil(meteor.tail / 3); segment >= 0; segment--) {
        const distance = segment * 3;
        context.globalAlpha =
          meteor.opacity * (1 - distance / (meteor.tail + 3)) ** 1.8;
        context.fillStyle = segment < 2 ? "#eaf5ff" : "#8eaccf";
        context.fillRect(
          Math.round(meteor.x - (distance * meteor.dx) / length),
          Math.round(meteor.y - (distance * meteor.dy) / length),
          segment === 0 ? 3 : 2,
          2,
        );
      }
    }

    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    const pose = dishPose(time);
    context.save();
    context.translate(1403, 501);
    context.rotate(pose.angle);
    context.scale(pose.scaleX, 1);
    context.drawImage(dish, -17, -44);
    context.restore();

    lights.forEach((light, index) => {
      context.globalCompositeOperation = "screen";
      context.globalAlpha = light.beacon
        ? antennaBeacon(time)
        : stationLight(time, index);
      context.drawImage(light.glow, light.x - 12, light.y - 12);
      // A red source-over core stays red against the pale antenna, rather than
      // washing out to white under screen blending. Center it on the pole tip.
      if (light.beacon) context.globalCompositeOperation = "source-over";
      context.fillStyle = `rgb(${light.color})`;
      const inset = light.beacon ? 1 : 0;
      context.fillRect(light.x - inset, light.y - inset, light.size, light.size);
    });

    context.globalCompositeOperation = "source-over";
    for (const mote of motes) {
      const p = lunarDustPosition(mote, time);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      // A crisp offset edge separates the dust from bright regolith. No blur.
      context.globalAlpha = p.opacity * 0.42;
      context.fillStyle = "#19263d";
      context.fillRect(x + 1, y + 1, mote.size + 1, mote.size + 1);
      context.globalAlpha = p.opacity;
      context.fillStyle = "#f4f8ff";
      context.fillRect(x, y, mote.size, mote.size);
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  };
}

export default memo(function LunarScene({ moving }: { moving: boolean }) {
  return (
    <SceneCanvas
      name="lunar"
      moving={moving}
      assets={ASSETS}
      fallback={ASSETS.original}
      prepare={prepare}
    />
  );
});
