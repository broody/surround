import { memo } from "react";
import "./sunlit.css";
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
  createDustMotes,
  dojoBreeze,
  dustPosition,
  foliageOffset,
  sunlightLevel,
} from "./sunlitWeather";

const ASSETS = {
  original: "/assets/sunlit/original.png",
  plate: "/assets/sunlit/clean-plate.png",
  trees: "/assets/sunlit/outdoor-trees.png",
};

function polygon(points: number[][]) {
  const path = new Path2D();
  points.forEach(([x, y], index) =>
    index ? path.lineTo(x, y) : path.moveTo(x, y),
  );
  path.closePath();
  return path;
}

function crop(
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, x, y, width, height, 0, 0, width, height);
  return canvas;
}

function lightMask(
  image: HTMLImageElement,
  source: [number, number, number, number],
) {
  const canvas = crop(image, ...source);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const [r, g, b] = pixels.data.subarray(i, i + 3);
    const strength = Math.max(
      0,
      Math.min(1, (r - 173) / 65, (g - 128) / 64, (r - b - 28) / 55),
    );
    pixels.data[i] = 255;
    pixels.data[i + 1] = 229;
    pixels.data[i + 2] = 168;
    pixels.data[i + 3] = Math.round(strength * 255);
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function prepare(images: SceneImages): ScenePainter {
  // Only outdoor apertures reveal the inpainted backing. Every indoor pixel,
  // including the level tatami and shoji rails, comes from the approved image.
  const openings = polygon([
    [211, 121],
    [319, 192],
    [319, 606],
    [211, 643],
  ]);
  openings.addPath(
    polygon([
      [1326, 256],
      [1403, 256],
      [1403, 577],
      [1326, 577],
    ]),
  );
  const branches = [
    {
      texture: crop(images.trees, 185, 103, 158, 491),
      x: 185,
      y: 103,
      phase: 0.3,
      amplitude: 4.6,
    },
    {
      texture: crop(images.trees, 1310, 238, 120, 348),
      x: 1310,
      y: 238,
      phase: 1.5,
      amplitude: 3.2,
    },
  ];

  // Registered light masks preserve the photographed-in-artwork lattice lines:
  // brightness changes, but the floor texture and geometry never slide around.
  const wallLight = lightMask(images.original, [447, 239, 607, 319]);
  const floorLight = lightMask(images.original, [204, 590, 1291, 304]);
  const wallShimmer = createCanvas(wallLight.width, wallLight.height);
  const floorShimmer = createCanvas(floorLight.width, floorLight.height);
  const shimmer = (
    mask: HTMLCanvasElement,
    buffer: HTMLCanvasElement,
    time: number,
    phase: number,
  ) => {
    const c = buffer.getContext("2d")!;
    c.clearRect(0, 0, buffer.width, buffer.height);
    c.globalCompositeOperation = "source-over";
    const center = buffer.width * (0.5 + Math.sin(time * 0.32 + phase) * 0.42);
    const width = buffer.width * 0.36;
    const gradient = c.createLinearGradient(
      center - width,
      0,
      center + width,
      buffer.height * 0.7,
    );
    gradient.addColorStop(0, "#fff1bd00");
    gradient.addColorStop(0.35, "#ffe7a966");
    gradient.addColorStop(0.5, "#fff6d8ef");
    gradient.addColorStop(0.7, "#ffe7a955");
    gradient.addColorStop(1, "#fff1bd00");
    c.fillStyle = gradient;
    c.fillRect(0, 0, buffer.width, buffer.height);
    c.globalCompositeOperation = "destination-in";
    c.drawImage(mask, 0, 0);
    return buffer;
  };
  const wall = new Path2D();
  wall.rect(452, 247, 140, 307);
  wall.rect(634, 247, 413, 307);
  const floor = polygon([
    [440, 599],
    [1240, 599],
    [1491, 745],
    [1672, 837],
    [1672, 886],
    [0, 886],
    [210, 652],
  ]);

  const leafShadow = createCanvas(158, 220);
  const shadowContext = leafShadow.getContext("2d")!;
  shadowContext.drawImage(branches[0].texture, 0, 0, 158, 220, 0, 0, 158, 220);
  shadowContext.globalCompositeOperation = "source-in";
  shadowContext.fillStyle = "#675138";
  shadowContext.fillRect(0, 0, 158, 220);

  // A low-resolution light texture gives the shafts the same pixel scale as
  // the art; it is additive light, not an opaque fog sheet over the room.
  const rays = createCanvas(Math.ceil(WIDTH / 3), Math.ceil(HEIGHT / 3));
  const rayContext = rays.getContext("2d")!;
  rayContext.scale(1 / 3, 1 / 3);
  for (const ray of [
    { x: 336, y: 181, end: 1100, width: 230, alpha: 0.28 },
    { x: 373, y: 227, end: 990, width: 125, alpha: 0.22 },
    { x: 404, y: 269, end: 1210, width: 155, alpha: 0.17 },
  ]) {
    const light = rayContext.createLinearGradient(ray.x, ray.y, ray.end, 810);
    light.addColorStop(0, "#ffe7b000");
    light.addColorStop(0.28, `rgba(255, 225, 165, ${ray.alpha})`);
    light.addColorStop(0.74, `rgba(255, 229, 182, ${ray.alpha * 0.5})`);
    light.addColorStop(1, "#ffe7b000");
    rayContext.fillStyle = light;
    rayContext.fill(
      polygon([
        [ray.x, ray.y],
        [ray.x + 24, ray.y + 18],
        [ray.end + ray.width, 810],
        [ray.end, 810],
      ]),
    );
  }
  const room = polygon([
    [326, 200],
    [1237, 220],
    [1237, 585],
    [1498, 747],
    [1672, 838],
    [1672, 887],
    [210, 887],
    [210, 650],
    [326, 621],
  ]);
  const dust = createDustMotes();

  return (context, time) => {
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.drawImage(images.original, 0, 0, WIDTH, HEIGHT);

    context.save();
    context.clip(openings);
    context.drawImage(images.plate, 0, 0, WIDTH, HEIGHT);
    for (const branch of branches) {
      const { texture, x, y, phase, amplitude } = branch;
      for (let row = 0; row < texture.height; row += 8) {
        const span = Math.min(8, texture.height - row);
        const sample = Math.min(span + 1, texture.height - row);
        const a = foliageOffset(row, texture.height, time, phase, amplitude);
        const b = foliageOffset(
          row + span,
          texture.height,
          time,
          phase,
          amplitude,
        );
        context.save();
        context.transform(1, 0, (b - a) / span, 1, x + a, y + row);
        context.drawImage(
          texture,
          0,
          row,
          texture.width,
          sample,
          0,
          0,
          texture.width,
          sample,
        );
        context.restore();
      }
    }
    context.restore();

    const light = sunlightLevel(time);
    const wind = dojoBreeze(time, 0.3);
    context.save();
    context.clip(wall);
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.12 + (light - 0.65) * 0.7;
    context.drawImage(wallLight, 447, 239);
    context.globalAlpha = 0.38;
    context.drawImage(shimmer(wallLight, wallShimmer, time, 0), 447, 239);
    context.globalCompositeOperation = "multiply";
    context.globalAlpha = 0.075 + wind * 0.02;
    context.drawImage(
      leafShadow,
      465 + wind * 5,
      296 + dojoBreeze(time, 1.1) * 2,
      233,
      318,
    );
    context.restore();

    context.save();
    context.clip(floor);
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.1 + (light - 0.65) * 0.75;
    context.drawImage(floorLight, 204, 590);
    context.globalAlpha = 0.4;
    context.drawImage(shimmer(floorLight, floorShimmer, time, 0.7), 204, 590);
    context.globalCompositeOperation = "multiply";
    context.globalAlpha = 0.07 + wind * 0.018;
    context.transform(2.3, 0.06, 0.9, 0.46, 350 + wind * 6, 603);
    context.drawImage(leafShadow, 0, 0);
    context.restore();

    context.save();
    context.clip(room);
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.42 + (light - 0.65) * 1.25;
    context.drawImage(rays, 0, 0, WIDTH, HEIGHT);
    context.globalCompositeOperation = "screen";
    for (const mote of dust) {
      const p = dustPosition(mote, time);
      // A small halo and a crisp bright core remain legible against warm tatami.
      context.fillStyle = "#ffd47f";
      context.globalAlpha = p.opacity * 0.18;
      context.fillRect(p.x - 2, p.y - 2, mote.size + 4, mote.size + 4);
      context.fillStyle = "#fff9e5";
      context.globalAlpha = p.opacity;
      context.fillRect(p.x, p.y, mote.size, mote.size);
    }
    context.restore();
  };
}

export default memo(function SunlitScene({ moving }: { moving: boolean }) {
  return (
    <SceneCanvas
      name="sunlit"
      moving={moving}
      assets={ASSETS}
      fallback={ASSETS.original}
      prepare={prepare}
    />
  );
});
