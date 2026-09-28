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
  createPineMotes,
  FUJI_BIRD_COUNT,
  fujiBirdPosition,
  fujiCloudBankDrift,
  fujiCloudDrift,
  lakeGlint,
  lakeOffset,
  LAKE_BOTTOM,
  LAKE_TOP,
  pineBend,
  pineMotePosition,
} from "./fujiWeather";
import "./fuji.css";

const ASSETS = {
  original: "/assets/fuji/original.png",
  plate: "/assets/fuji/clean-plate.png",
  pines: "/assets/fuji/pines.png",
  cloudFree: "/assets/fuji/cloud-free-plate.png",
  cloudsFar: "/assets/fuji/clouds-far.png",
  cloudsNear: "/assets/fuji/clouds-near.png",
};

function crop(
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const canvas = createCanvas(width, height);
  canvas
    .getContext("2d")!
    .drawImage(image, x, y, width, height, 0, 0, width, height);
  return canvas;
}

function prepare(images: SceneImages): ScenePainter {
  const base = createCanvas(WIDTH, HEIGHT);
  const baseContext = base.getContext("2d")!;
  baseContext.drawImage(images.original, 0, 0, WIDTH, HEIGHT);
  // Use the tree-free backing only near removed trees. The lake, shore and
  // reflection retain the approved source artwork.
  for (const [x, y, w, h] of [
    [0, 0, 720, 329],
    [0, 305, 360, 430],
    [1260, 0, 412, 366],
    [1530, 562, 142, 173],
  ]) {
    const patch = crop(images.plate, x, y, w, h);
    const c = patch.getContext("2d")!;
    const pixels = c.getImageData(0, 0, w, h);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const edge = Math.min(
          x === 0 ? 20 : px,
          x + w === WIDTH ? 20 : w - 1 - px,
          y === 0 ? 20 : py,
          h - 1 - py,
        );
        pixels.data[(py * w + px) * 4 + 3] = Math.min(1, edge / 14) * 255;
      }
    }
    c.putImageData(pixels, 0, 0);
    baseContext.drawImage(patch, x, y);
  }

  // Remove the baked-in clouds before reintroducing the moving cutouts. Blend
  // into the unchanged valley below, not through the mountain or sky.
  const clearSky = crop(images.cloudFree, 0, 0, WIDTH, 410);
  const clearContext = clearSky.getContext("2d")!;
  const clearPixels = clearContext.getImageData(0, 0, WIDTH, 410);
  for (let y = 380; y < 410; y++) {
    for (let x = 0; x < WIDTH; x++)
      clearPixels.data[(y * WIDTH + x) * 4 + 3] = ((409 - y) / 29) * 255;
  }
  clearContext.putImageData(clearPixels, 0, 0);
  baseContext.drawImage(clearSky, 0, 0);

  // Derive a registered skyline from the cloud-free painting once. Three
  // consecutive non-sky pixels avoid isolated texture specks; everything below
  // this ridge occludes the rear cloud bank, including the side foothills.
  const mountain = crop(base, 0, 0, WIDTH, 410);
  const mountainContext = mountain.getContext("2d")!;
  const mountainPixels = mountainContext.getImageData(0, 0, WIDTH, 410);
  const isLand = (x: number, y: number) => {
    const i = (y * WIDTH + x) * 4;
    const r = clearPixels.data[i], b = clearPixels.data[i + 2];
    return b < 238 || r > b * 0.96;
  };
  for (let x = 0; x < WIDTH; x++) {
    let ridge = 380;
    for (let y = 100; y < 380; y++) {
      if (isLand(x, y) && isLand(x, y + 1) && isLand(x, y + 2)) {
        ridge = y;
        break;
      }
    }
    for (let y = 0; y < ridge; y++)
      mountainPixels.data[(y * WIDTH + x) * 4 + 3] = 0;
  }
  mountainContext.putImageData(mountainPixels, 0, 0);
  const farClouds = crop(images.cloudsFar, 0, 100, 1671, 390);
  const nearClouds = crop(images.cloudsNear, 300, 282, 1235, 137);

  const pines = [
    { x: 0, y: 0, w: 715, h: 322, right: false, phase: 0.3, amplitude: 5.2 },
    { x: 0, y: 322, w: 350, h: 438, right: false, phase: 2.1, amplitude: 3.4 },
    { x: 1260, y: 0, w: 412, h: 370, right: true, phase: 3.2, amplitude: 4.2 },
    {
      x: 1530,
      y: 562,
      w: 142,
      h: 198,
      right: true,
      phase: 1.4,
      amplitude: 2.2,
    },
  ].map((pine) => ({
    ...pine,
    texture: crop(images.pines, pine.x, pine.y, pine.w, pine.h),
  }));

  // Keep the original high wisps in addition to the new larger cloud banks.
  const clouds = [
    [347, 168, 164, 35],
    [950, 109, 451, 58],
    [1280, 172, 253, 39],
  ].map(([x, y, w, h], index) => {
    const texture = crop(images.original, x, y, w, h);
    const c = texture.getContext("2d")!;
    const pixels = c.getImageData(0, 0, w, h);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        const [r, g, b] = pixels.data.subarray(i, i + 3);
        const mountain = index === 1 && x + px < 1040 && y + py > 141;
        const edge = Math.min(
          1,
          px / 4,
          py / 3,
          (w - 1 - px) / 4,
          (h - 1 - py) / 3,
        );
        pixels.data[i + 3] =
          !mountain && r > 175 && g > 150 && b > 155
            ? Math.max(0, Math.min(1, (r - b + 10) / 22)) * edge * 255
            : 0;
      }
    }
    c.putImageData(pixels, 0, 0);
    return { x, y, texture };
  });

  const lake = crop(base, 0, LAKE_TOP, WIDTH, LAKE_BOTTOM - LAKE_TOP);
  const glints = crop(lake, 0, 0, lake.width, lake.height);
  const glintContext = glints.getContext("2d")!;
  const lightPixels = glintContext.getImageData(
    0,
    0,
    glints.width,
    glints.height,
  );
  for (let i = 0; i < lightPixels.data.length; i += 4) {
    const [r, g, b] = lightPixels.data.subarray(i, i + 3);
    lightPixels.data[i + 3] =
      r > 160 && g > 150 && r > b * 0.98 ? Math.min(255, (r - 150) * 3) : 0;
  }
  glintContext.putImageData(lightPixels, 0, 0);

  // Solid original timber is the final layer; moving pines remain behind it.
  const foreground = createCanvas(WIDTH, HEIGHT);
  const front = foreground.getContext("2d")!;
  for (const [x, y, w, h] of [
    [0, 730, WIDTH, HEIGHT - 730],
    [0, 660, WIDTH, 20],
    [0, 704, WIDTH, 26],
    [137, 630, 51, 102],
    [504, 630, 46, 102],
    [1125, 630, 48, 102],
    [1483, 630, 52, 102],
    [344, 678, 28, 28],
    [798, 678, 29, 28],
    [932, 678, 28, 28],
    [1320, 678, 29, 28],
  ])
    front.drawImage(images.original, x, y, w, h, x, y, w, h);
  const motes = createPineMotes();

  return (context, time) => {
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.drawImage(base, 0, 0);
    const farDrift = fujiCloudBankDrift("far", time);
    // Overscan the far bank so its full-width cutout never exposes an edge.
    context.drawImage(farClouds, -60 + farDrift.x, 60 + farDrift.y, WIDTH + 120, 310);
    clouds.forEach((cloud, index) => {
      const drift = fujiCloudDrift(index, time);
      context.drawImage(cloud.texture, cloud.x + drift.x, cloud.y + drift.y);
    });
    context.drawImage(mountain, 0, 0);
    const nearDrift = fujiCloudBankDrift("near", time);
    context.drawImage(nearClouds, 376 + nearDrift.x, 276 + nearDrift.y, 1050, 103);

    context.fillStyle = "#ffffff";
    for (let index = 0; index < FUJI_BIRD_COUNT; index++) {
      const bird = fujiBirdPosition(index, time);
      if (bird.opacity === 0) continue;
      const x = Math.round(bird.x), y = Math.round(bird.y);
      context.globalAlpha = bird.opacity;
      context.fillRect(x, y, 2, 2);
      for (let wing = 1; wing <= bird.span; wing++) {
        const rise = Math.round((wing / bird.span) * bird.wing);
        context.fillRect(x - wing, y + rise, 1, 1);
        context.fillRect(x + wing + 1, y + rise, 1, 1);
      }
    }
    context.globalAlpha = 1;
    for (let row = 0; row < lake.height; row += 2) {
      const height = Math.min(2, lake.height - row);
      const shift = lakeOffset(LAKE_TOP + row, time);
      context.drawImage(
        lake,
        0,
        row,
        WIDTH,
        height,
        shift,
        LAKE_TOP + row,
        WIDTH,
        height,
      );
      context.globalCompositeOperation = "screen";
      context.globalAlpha = lakeGlint(row, time);
      context.drawImage(
        glints,
        0,
        row,
        WIDTH,
        height,
        shift,
        LAKE_TOP + row,
        WIDTH,
        height,
      );
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
    }
    for (const pine of pines) {
      for (let x = 0; x < pine.w; x += 8) {
        const span = Math.min(8, pine.w - x);
        const sample = Math.min(span + 1, pine.w - x);
        const bend = (column: number) =>
          pineBend(
            pine.right ? 1 - column / pine.w : column / pine.w,
            time,
            pine.phase,
            pine.amplitude,
          );
        const a = bend(x),
          b = bend(x + span);
        context.save();
        context.transform(1, (b - a) / span, 0, 1, pine.x + x, pine.y + a);
        context.drawImage(
          pine.texture,
          x,
          0,
          sample,
          pine.h,
          0,
          0,
          sample,
          pine.h,
        );
        context.restore();
      }
    }
    context.drawImage(foreground, 0, 0);
    context.fillStyle = "#fff1c6";
    for (const mote of motes) {
      const p = pineMotePosition(mote, time);
      context.globalAlpha = p.opacity;
      context.fillRect(Math.round(p.x), Math.round(p.y), mote.size, mote.size);
    }
    context.globalAlpha = 1;
  };
}

export default memo(function FujiScene({ moving }: { moving: boolean }) {
  return (
    <SceneCanvas
      name="fuji"
      moving={moving}
      assets={ASSETS}
      prepare={prepare}
      fallback={ASSETS.original}
    />
  );
});
