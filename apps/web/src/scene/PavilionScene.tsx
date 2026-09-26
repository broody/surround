import { memo } from "react";
import SceneCanvas, { type SceneImages, type ScenePainter } from "./SceneCanvas";
import { createCanvas, SCENE_WIDTH as WIDTH, SCENE_HEIGHT as HEIGHT } from "./layers";
import { cloudDrift, createPetals, pavilionLightLevel, petalPosition } from "./pavilionWeather";

const ASSETS = {
  plate: "/assets/pavilion/clean-plate.png",
  original: "/assets/pavilion/original.png",
  left: "/assets/pavilion/blossom-left.png",
  right: "/assets/pavilion/blossom-right.png",
  sky: "/assets/pavilion/sky-clouds.png",
  mist: "/assets/pavilion/valley-mist.png",
};

function polygon(points: number[][]) {
  const path = new Path2D();
  points.forEach(([x, y], i) => i ? path.lineTo(x, y) : path.moveTo(x, y));
  path.closePath();
  return path;
}

function texture(
  image: HTMLImageElement,
  source: [number, number, number, number],
  width: number,
  height: number,
  tint: number,
) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, ...source, 0, 0, width, height);
  context.globalCompositeOperation = "source-atop";
  context.fillStyle = `rgba(19, 30, 54, ${tint})`;
  context.fillRect(0, 0, width, height);
  return canvas;
}

function matte(image: HTMLImageElement, path: Path2D) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d")!;
  context.clip(path);
  context.drawImage(image, 0, 0, WIDTH, HEIGHT);
  return canvas;
}

function prepare(images: SceneImages): ScenePainter {
  const branches = [
    { texture: texture(images.left, [0, 34, 967, 498], 530, 273, 0.26),
      x: 116, y: 30, pivotX: 0, pivotY: 62, phase: 0.3, flex: 2.8 },
    { texture: texture(images.right, [1095, 35, 503, 254], 316, 160, 0.14),
      x: 1240, y: 42, pivotX: 316, pivotY: 90, phase: 2.4, flex: 2.1 },
  ];
  const sky = texture(images.sky, [31, 209, 2125, 315], 1420, 170, 0.22);
  const mist = texture(images.mist, [16, 118, 2140, 526], 1450, 356, 0.10);
  const opening = new Path2D();
  opening.rect(139, 50, 1400, 682);
  const skyWindow = polygon([
    [139, 50], [1539, 50], [1539, 191], [1436, 185], [1404, 226],
    [1335, 201], [1310, 298], [1240, 287], [1140, 319], [988, 280],
    [899, 316], [772, 254], [683, 303], [627, 279], [516, 316],
    [438, 297], [364, 296], [258, 261], [197, 271], [172, 260], [139, 269],
  ]);

  // Register solid near slopes in front of the cloud sea. Use the clean plate
  // here so no fragments of the original, frozen fog return with the cliffs.
  const cliffs = polygon([
    [0, 320], [149, 334], [186, 349], [213, 363], [246, 384],
    [270, 417], [335, 440], [393, 452], [439, 470], [466, 500],
    [512, 541], [544, 591], [566, 659], [588, 734], [0, 734],
  ]);
  cliffs.addPath(polygon([
    [1539, 186], [1438, 187], [1414, 212], [1388, 239], [1375, 308],
    [1322, 323], [1294, 349], [1267, 369], [1240, 400], [1230, 439],
    [1221, 473], [1189, 503], [1164, 552], [1138, 594], [1081, 630],
    [1039, 688], [1030, 734], [WIDTH, 734], [WIDTH, 186],
  ]));
  cliffs.addPath(polygon([
    [320, 404], [338, 395], [355, 383], [365, 377], [369, 391],
    [394, 400], [405, 405], [384, 411], [391, 438], [407, 448],
    [403, 455], [329, 455], [327, 442], [339, 437], [339, 411],
  ]));
  const nearSlopes = matte(images.plate, cliffs);

  // Preserve the source's small, distant cherry trees, whose pink pixels are
  // separable from the dark cliff. Large foreground boughs use generated RGBA.
  const distantBlossoms = createCanvas(WIDTH, HEIGHT);
  const blossomContext = distantBlossoms.getContext("2d", { willReadFrequently: true })!;
  for (const [x, y, w, h] of [[1450, 322, 90, 91], [1353, 429, 130, 90], [1460, 538, 79, 115]]) {
    blossomContext.drawImage(images.original, x, y, w, h, x, y, w, h);
  }
  const blossomPixels = blossomContext.getImageData(0, 0, WIDTH, HEIGHT);
  for (let i = 0; i < blossomPixels.data.length; i += 4) {
    const [r, g, b] = blossomPixels.data.subarray(i, i + 3);
    if (!(r > 65 && r > g * 1.13 && b > g * 1.06 && r > b * 0.9))
      blossomPixels.data[i + 3] = 0;
  }
  blossomContext.putImageData(blossomPixels, 0, 0);

  // Recover the dark island silhouettes from the source pixels, rather than
  // introducing polygon edges across their mist-covered feet. A soft blue-
  // luminance key removes the pale source fog; the moving near bank crosses it.
  const islandPeaks = createCanvas(610, 270);
  const peakContext = islandPeaks.getContext("2d", { willReadFrequently: true })!;
  peakContext.drawImage(images.original, 485, 365, 610, 270, 0, 0, 610, 270);
  const peakPixels = peakContext.getImageData(0, 0, 610, 270);
  for (let i = 0; i < peakPixels.data.length; i += 4) {
    const pixel = i / 4, x = pixel % 610, y = Math.floor(pixel / 610);
    const edge = Math.min(1, x / 24, (609 - x) / 24, y / 16, (269 - y) / 35);
    const alpha = Math.max(0, Math.min(1, (79 - peakPixels.data[i + 1]) / 24));
    peakPixels.data[i + 3] = Math.round(255 * edge * alpha);
  }
  peakContext.putImageData(peakPixels, 0, 0);

  // Only actual timber is restored: the gaps in the rail remain see-through.
  const framePath = new Path2D();
  for (const rect of [
    [0, 0, WIDTH, 56], [0, 0, 139, 733], [1539, 0, 133, 733],
    [0, 733, WIDTH, 208], [136, 638, 1410, 19], [138, 678, 1406, 15],
    [136, 714, 1410, 20], [212, 607, 61, 127], [564, 648, 27, 85],
    [823, 648, 30, 85], [1097, 648, 29, 85], [1404, 607, 62, 127],
  ]) framePath.rect(...rect as [number, number, number, number]);
  framePath.addPath(polygon([[218, 607], [223, 580], [233, 572], [233, 559],
    [244, 550], [259, 558], [259, 576], [269, 588], [267, 608]]));
  framePath.addPath(polygon([[1411, 607], [1415, 581], [1426, 572], [1426, 559],
    [1438, 550], [1452, 559], [1452, 575], [1462, 590], [1460, 608]]));
  const frame = matte(images.plate, framePath);
  const petals = createPetals();

  const glow = createCanvas(128, 128);
  const glowContext = glow.getContext("2d")!;
  const gradient = glowContext.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "#ffbd65b0");
  gradient.addColorStop(0.3, "#efab5040");
  gradient.addColorStop(1, "#efab5000");
  glowContext.fillStyle = gradient;
  glowContext.fillRect(0, 0, 128, 128);

  const lights = [
    { x: 20, y: 191, w: 53, h: 58, phase: 0.4, halo: 190 },
    { x: 1608, y: 191, w: 47, h: 58, phase: 2.6, halo: 190 },
    { x: 341, y: 408, w: 39, h: 30, phase: 3.7, halo: 90 },
    { x: 1423, y: 276, w: 104, h: 34, phase: 1.8, halo: 125 },
    { x: 1347, y: 361, w: 13, h: 20, phase: 0.6, halo: 52 },
    { x: 1385, y: 369, w: 13, h: 20, phase: 1.5, halo: 52 },
    { x: 1454, y: 394, w: 15, h: 20, phase: 2.1, halo: 56 },
    { x: 1475, y: 453, w: 15, h: 22, phase: 3.5, halo: 62 },
    { x: 1638, y: 528, w: 26, h: 39, phase: 4.4, halo: 82 },
  ].map((light) => {
    const mask = createCanvas(light.w, light.h);
    const context = mask.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(images.original, light.x, light.y, light.w, light.h,
      0, 0, light.w, light.h);
    const pixels = context.getImageData(0, 0, light.w, light.h);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const [r, g, b] = pixels.data.subarray(i, i + 3);
      pixels.data[i + 3] = r > 115 && g > 70 && r > b * 1.6 && g > b * 1.2 ? 255 : 0;
      pixels.data[i] = 42;
      pixels.data[i + 1] = 31;
      pixels.data[i + 2] = 37;
    }
    context.putImageData(pixels, 0, 0);
    return { ...light, mask };
  });

  return (context, time) => {
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.drawImage(images.plate, 0, 0, WIDTH, HEIGHT);

    context.save();
    context.clip(skyWindow);
    const skyShift = cloudDrift(time, 0);
    context.globalAlpha = 0.64;
    context.drawImage(sky, 139 + skyShift.x, 120 + skyShift.y);
    context.restore();

    context.save();
    context.clip(opening);
    const far = cloudDrift(time, 1);
    context.globalAlpha = 0.84;
    context.drawImage(mist, 115 + far.x, 326 + far.y, 1450, 316);
    context.globalAlpha = 1;
    context.drawImage(islandPeaks, 485, 365);
    const near = cloudDrift(time, 2);
    context.globalAlpha = 0.83;
    context.drawImage(mist, 215 + near.x, 465 + near.y, 1270, 288);
    context.globalAlpha = 1;
    context.drawImage(nearSlopes, 0, 0);
    context.drawImage(distantBlossoms, 0, 0);

    for (const branch of branches) {
      context.save();
      context.translate(branch.x + branch.pivotX, branch.y + branch.pivotY);
      context.rotate(Math.sin(time * 0.43 + branch.phase) * 0.005);
      context.translate(-branch.pivotX, -branch.pivotY);
      const width = branch.texture.width;
      const bend = (x: number) => {
        const distance = Math.abs(x - branch.pivotX) / width;
        return distance * distance * branch.flex * Math.sin(time * 0.7 + branch.phase + distance);
      };
      for (let x = 0; x < width; x += 8) {
        const span = Math.min(8, width - x);
        const sample = Math.min(span + 1, width - x);
        const a = bend(x), b = bend(x + span);
        context.save();
        context.transform(1, (b - a) / span, 0, 1, x, a);
        context.drawImage(branch.texture, x, 0, sample, branch.texture.height,
          0, 0, sample, branch.texture.height);
        context.restore();
      }
      context.restore();
    }

    for (const petal of petals) {
      const p = petalPosition(petal, time);
      context.globalAlpha = p.opacity;
      context.fillStyle = petal.depth ? "#e2a4ba" : "#b991b6";
      context.fillRect(p.x, p.y, p.width, petal.size);
      if (petal.depth) {
        context.fillStyle = "#ac6c90";
        context.fillRect(p.x + p.width - 1, p.y + petal.size - 1, 2, 2);
      }
    }
    // A few warm, rising pixels near the lantern trail and veranda.
    context.fillStyle = "#ffe2a0";
    for (let i = 0; i < 24; i++) {
      const progress = (time * (0.024 + (i % 4) * 0.003) + i * 0.137) % 1;
      const x = 159 + (i * 163) % 1345 + Math.sin(time * 0.4 + i) * 7;
      const y = 698 - progress * (100 + i % 5 * 18);
      context.globalAlpha = Math.sin(progress * Math.PI) * 0.38;
      context.fillRect(Math.round(x), Math.round(y), i % 4 === 0 ? 3 : 2, 2);
    }
    context.restore();
    context.globalAlpha = 1;
    context.drawImage(frame, 0, 0);

    for (const light of lights) {
      const level = pavilionLightLevel(time, light.phase);
      context.globalAlpha = 0.06 + (1 - level) * 0.27;
      context.drawImage(light.mask, light.x, light.y);
      context.globalCompositeOperation = "screen";
      context.globalAlpha = 0.07 + level * 0.20;
      context.drawImage(glow, light.x + light.w / 2 - light.halo / 2,
        light.y + light.h / 2 - light.halo / 2, light.halo, light.halo);
      context.globalCompositeOperation = "source-over";
    }
    context.globalAlpha = 1;
    context.save();
    context.beginPath();
    context.rect(0, 733, WIDTH, HEIGHT - 733);
    context.clip();
    context.globalCompositeOperation = "screen";
    for (let i = 0; i < 2; i++) {
      context.globalAlpha = 0.025 + pavilionLightLevel(time, lights[i].phase) * 0.075;
      context.drawImage(glow, i ? 1328 : -36, 735, 380, 156);
    }
    context.restore();
  };
}

export default memo(function PavilionScene({ moving }: { moving: boolean }) {
  return <SceneCanvas moving={moving} name="pavilion" assets={ASSETS}
    prepare={prepare} fallback={ASSETS.original} />;
});
