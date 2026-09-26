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
  createSnowflakes,
  snowPosition,
  winterLightLevel,
} from "./winterWeather";

const ASSETS = {
  plate: "/assets/winter/clean-plate.png",
  original: "/assets/winter/original.png",
  left: "/assets/winter/left-pine.png",
  courtyard: "/assets/winter/courtyard-pine.png",
};

function polygon(points: number[][]) {
  const path = new Path2D();
  points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();
  return path;
}

function branchTexture(
  image: HTMLImageElement,
  bounds: [number, number, number, number],
  width: number,
  height: number,
) {
  const texture = createCanvas(width, height);
  const context = texture.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, ...bounds, 0, 0, width, height);
  // Match the isolated sprite's snow to the blue-hour background without
  // changing its true alpha gaps or modifying the generated source asset.
  context.globalCompositeOperation = "source-atop";
  context.fillStyle = "rgba(25, 36, 62, 0.13)";
  context.fillRect(0, 0, width, height);
  return texture;
}

function prepare(images: SceneImages): ScenePainter {
  const pines = [
    {
      texture: branchTexture(images.left, [107, 106, 553, 500], 340, 337),
      x: 106,
      y: 107,
      pivotX: 10,
      pivotY: 287,
      phase: 0.4,
      flex: 1.5,
    },
    {
      texture: branchTexture(images.courtyard, [707, 316, 549, 290], 302, 204),
      x: 873,
      y: 329,
      pivotX: 257,
      pivotY: 188,
      phase: 2.3,
      flex: 1.1,
    },
  ];
  const outside = polygon([
    [114, 84],
    [561, 28],
    [1240, 28],
    [1575, 102],
    [1575, 742],
    [114, 742],
  ]);
  const shelter = createCanvas(WIDTH, HEIGHT);
  const shelterContext = shelter.getContext("2d")!;
  shelterContext.drawImage(images.original, 0, 0);
  shelterContext.globalCompositeOperation = "destination-out";
  shelterContext.fill(outside);
  const snow = createSnowflakes();
  const glow = createCanvas(128, 128);
  const glowContext = glow.getContext("2d")!;
  const gradient = glowContext.createRadialGradient(64, 64, 1, 64, 64, 64);
  gradient.addColorStop(0, "#ffbd65");
  gradient.addColorStop(0.35, "#d3904266");
  gradient.addColorStop(1, "transparent");
  glowContext.fillStyle = gradient;
  glowContext.fillRect(0, 0, 128, 128);

  const lights = [
    { x: 0, y: 622, width: 98, height: 155, phase: 0.5, halo: 240 },
    { x: 209, y: 492, width: 62, height: 57, phase: 1.8, halo: 140 },
    { x: 1153, y: 446, width: 30, height: 24, phase: 3.2, halo: 95 },
    { x: 1475, y: 469, width: 41, height: 32, phase: 1.1, halo: 115 },
    { x: 1371, y: 329, width: 87, height: 88, phase: 2.5, halo: 160 },
    { x: 1471, y: 326, width: 46, height: 90, phase: 2.8, halo: 110 },
    { x: 1530, y: 346, width: 63, height: 70, phase: 3.1, halo: 115 },
    { x: 1314, y: 389, width: 19, height: 37, phase: 4.1, halo: 85 },
  ].map((light) => {
    const mask = createCanvas(light.width, light.height);
    const context = mask.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(
      images.plate,
      light.x,
      light.y,
      light.width,
      light.height,
      0,
      0,
      light.width,
      light.height,
    );
    const pixels = context.getImageData(0, 0, light.width, light.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const [r, g, b] = pixels.data.subarray(i, i + 3);
      pixels.data[i + 3] =
        r > 110 && g > 75 && r > b * 1.6 && g > b * 1.2 ? 255 : 0;
      pixels.data[i] = 31;
      pixels.data[i + 1] = 28;
      pixels.data[i + 2] = 39;
    }
    context.putImageData(pixels, 0, 0);
    return { ...light, mask };
  });

  function drawSnow(
    context: CanvasRenderingContext2D,
    time: number,
    depth: number,
  ) {
    context.fillStyle = depth === 0 ? "#aebdd9" : "#e1e7f3";
    for (const flake of snow) {
      if (flake.depth !== depth) continue;
      const point = snowPosition(flake, time);
      context.globalAlpha = point.opacity;
      context.fillRect(point.x, point.y, flake.size, flake.size);
      if (flake.size === 4) {
        context.globalAlpha *= 0.35;
        context.fillRect(point.x - 1, point.y + 1, 6, 2);
      }
    }
    context.globalAlpha = 1;
  }

  return (context, time) => {
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.drawImage(images.plate, 0, 0, WIDTH, HEIGHT);

    context.save();
    context.clip(outside);
    drawSnow(context, time, 0);

    for (const pine of pines) {
      context.save();
      context.translate(pine.x + pine.pivotX, pine.y + pine.pivotY);
      // Snow-heavy boughs only turn a fraction of a degree at their root.
      context.rotate(Math.sin(time * 0.39 + pine.phase) * 0.004);
      context.translate(-pine.pivotX, -pine.pivotY);
      const width = pine.texture.width;
      const bendAt = (x: number) => {
        const distance =
          Math.abs(x - pine.pivotX) /
          Math.max(pine.pivotX, width - pine.pivotX);
        return (
          distance *
          distance *
          pine.flex *
          Math.sin(time * 0.61 + pine.phase + distance)
        );
      };
      for (let x = 0; x < width; x += 8) {
        const span = Math.min(8, width - x);
        // A one-pixel overlap closes rasterization seams between sheared strips,
        // particularly visible on the bright snow resting on these branches.
        const sampleSpan = Math.min(span + 1, width - x);
        const a = bendAt(x),
          b = bendAt(x + span);
        context.save();
        context.transform(1, (b - a) / span, 0, 1, x, a);
        context.drawImage(
          pine.texture,
          x,
          0,
          sampleSpan,
          pine.texture.height,
          0,
          0,
          sampleSpan,
          pine.texture.height,
        );
        context.restore();
      }
      context.restore();
    }
    drawSnow(context, time, 1);

    // Occasional powder releases from a bough, dissolving before reaching land.
    for (let i = 0; i < 12; i++) {
      const progress = (time * 0.085 + i * 0.139) % 1;
      const side = i % 2;
      const x =
        (side ? 959 : 304) +
        (i % 5) * 9 +
        progress * 19 +
        Math.sin(progress * 5 + i) * 5;
      const y = (side ? 400 : 256) + progress * 83;
      context.globalAlpha = Math.sin(progress * Math.PI) * 0.24;
      context.fillStyle = "#dbe2f2";
      context.fillRect(Math.round(x), Math.round(y), 2, 2);
    }
    context.globalAlpha = 1;
    drawSnow(context, time, 2);
    context.restore();

    // Restore the actual eaves, posts and level deck over the weather. These
    // foreground pieces remain perfectly still, with no snow falling indoors.
    context.drawImage(shelter, 0, 0);
    for (const light of lights) {
      const intensity = winterLightLevel(time, light.phase);
      context.globalAlpha = 0.08 + (1 - intensity) * 0.27;
      context.drawImage(light.mask, light.x, light.y);
      context.globalCompositeOperation = "screen";
      context.globalAlpha = 0.035 + intensity * 0.12;
      context.drawImage(
        glow,
        light.x + light.width / 2 - light.halo / 2,
        light.y + light.height / 2 - light.halo / 2,
        light.halo,
        light.halo,
      );
      context.globalCompositeOperation = "source-over";
    }
    context.globalAlpha = 1;
    // Gentle light spill on the sheltered floor follows the foreground lantern.
    const warmth = winterLightLevel(time, lights[0].phase);
    context.save();
    context.beginPath();
    context.rect(0, 746, WIDTH, HEIGHT - 746);
    context.clip();
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.03 + warmth * 0.075;
    context.drawImage(glow, -40, 731, 405, 143);
    context.restore();
    context.globalAlpha = 1;
  };
}

export default memo(function WinterScene({ moving }: { moving: boolean }) {
  return (
    <SceneCanvas
      moving={moving}
      name="winter"
      assets={ASSETS}
      prepare={prepare}
      fallback={ASSETS.original}
    />
  );
});
