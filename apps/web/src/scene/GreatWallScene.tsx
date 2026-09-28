import { memo } from "react";
import SceneCanvas, { type SceneImages, type ScenePainter } from "./SceneCanvas";
import { createCanvas, SCENE_WIDTH as WIDTH, SCENE_HEIGHT as HEIGHT } from "./layers";
import {
  autumnLeafPosition, createAutumnLeaves, wallCloudDrift,
  wallTreeBend, type AutumnLeaf,
} from "./greatWallWeather";
import "./great-wall.css";

const ASSETS = {
  original: "/assets/great-wall/original.png",
  plate: "/assets/great-wall/clean-plate.png",
  foliage: "/assets/great-wall/foliage.png",
  clouds: "/assets/great-wall/clouds.png",
};

function crop(image: CanvasImageSource, x: number, y: number, w: number, h: number,
  width = w, height = h) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, x, y, w, h, 0, 0, width, height);
  return canvas;
}

function polygon(points: number[][]) {
  const path = new Path2D();
  points.forEach(([x, y], i) => i ? path.lineTo(x, y) : path.moveTo(x, y));
  path.closePath();
  return path;
}

// Registered skyline, including the left tower's crenellations. Sky movement
// cannot carry clouds over the ridgeline or the tower masonry.
const SKYLINE = [
  [0, 42], [65, 77], [65, 124], [74, 126], [74, 98], [141, 128],
  [141, 159], [147, 159], [147, 130], [209, 151], [209, 230],
  [222, 237], [216, 249], [243, 246], [266, 253], [290, 251],
  [314, 242], [350, 246], [380, 235], [411, 240], [447, 231],
  [484, 219], [503, 223], [524, 230], [551, 222], [571, 226],
  [597, 213], [624, 209], [627, 196], [644, 196], [646, 210],
  [677, 222], [707, 229], [746, 222], [778, 229], [811, 213],
  [841, 202], [873, 221], [904, 228], [939, 230], [968, 236],
  [1002, 227], [1036, 220], [1061, 210], [1095, 222], [1127, 215],
  [1155, 200], [1184, 179], [1200, 157], [1231, 151], [1258, 137],
  [1294, 131], [1318, 144], [1350, 142], [1378, 149], [1407, 126],
  [1441, 105], [1475, 97], [1490, 82], [1519, 90], [1535, 94],
  [1563, 104], [1601, 119], [1639, 97], [1672, 94],
];

type Tree = {
  texture: HTMLCanvasElement;
  x: number; y: number; axis: "x" | "y";
  phase: number; amplitude: number;
};

function drawTree(context: CanvasRenderingContext2D, tree: Tree, time: number) {
  const { texture, x, y, axis, phase, amplitude } = tree;
  const horizontal = axis === "x";
  const length = horizontal ? texture.width : texture.height;
  const bend = (position: number) => wallTreeBend(
    horizontal ? position / length : 1 - position / length, time, phase, amplitude,
  );
  for (let p = 0; p < length; p += 6) {
    const span = Math.min(6, length - p);
    const sample = Math.min(span + 1, length - p);
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

const LEAF_COLORS = ["#d89a40", "#b66832", "#e8b956", "#c58036"];
function drawLeaves(context: CanvasRenderingContext2D, leaves: AutumnLeaf[], time: number) {
  for (const leaf of leaves) {
    const p = autumnLeafPosition(leaf, time);
    if (p.opacity < 0.01 || p.x > WIDTH + 12 || p.y > HEIGHT + 12) continue;
    context.save();
    context.globalAlpha = p.opacity;
    context.translate(Math.round(p.x), Math.round(p.y));
    context.rotate(p.angle);
    context.scale(p.width, 1);
    context.fillStyle = LEAF_COLORS[leaf.color];
    const s = leaf.size;
    context.fillRect(-s / 2, -s / 2, s, s);
    context.fillRect(-s, -1, s * 2, 2);
    context.fillStyle = "#815637";
    context.fillRect(0, s / 2, 1, 2);
    context.restore();
  }
}

function prepare(images: SceneImages): ScenePainter {
  const sky = polygon([[0, 0], [WIDTH, 0], ...[...SKYLINE].reverse()]);
  const base = crop(images.original, 0, 0, WIDTH, HEIGHT);
  const c = base.getContext("2d")!;
  c.save();
  c.clip(sky);
  c.drawImage(images.plate, 0, 0, WIDTH, HEIGHT);
  c.restore();

  // Reveal the inpainted backing only at removed branches. Keep the approved
  // mountains, distant wall and flat terrace, not a regenerated full scene.
  for (const [x, y, w, h] of [[0, 0, 160, 620], [208, 451, 294, 242], [1300, 411, 372, 285]]) {
    const patch = crop(images.plate, x, y, w, h);
    const pc = patch.getContext("2d")!;
    const pixels = pc.getImageData(0, 0, w, h);
    for (let row = 0; row < h; row++) {
      for (let column = 0; column < w; column++) {
        const edge = Math.min(x === 0 ? 20 : column, x + w === WIDTH ? 20 : w - 1 - column,
          y === 0 ? 20 : row, h - 1 - row);
        pixels.data[(row * w + column) * 4 + 3] = Math.min(1, edge / 18) * 255;
      }
    }
    pc.putImageData(pixels, 0, 0);
    c.drawImage(patch, x, y);
  }

  const clouds = [crop(images.clouds, 0, 0, WIDTH, 123), crop(images.clouds, 0, 123, WIDTH, 113)];
  const trees: Tree[] = [
    { texture: crop(images.foliage, 210, 480, 260, 290, 260, 220), x: 212, y: 474, axis: "y", phase: 1.3, amplitude: 3.1 },
    { texture: crop(images.foliage, 1224, 410, 447, 370, 360, 268), x: 1312, y: 427, axis: "y", phase: 3.2, amplitude: 3.8 },
  ];
  // The generated sheet joins this bough to a different lower tree. Feather
  // that junction out instead of showing a rectangular crop on the tower face.
  const boughTexture = crop(images.foliage, 0, 0, 151, 500);
  const bc = boughTexture.getContext("2d")!;
  const boughPixels = bc.getImageData(0, 0, 151, 500);
  for (let y = 0; y < 500; y++) {
    for (let x = 0; x < 151; x++) {
      const fade = Math.min(1, (499 - y) / 80, (150 - x) / 12);
      boughPixels.data[(y * 151 + x) * 4 + 3] *= fade;
    }
  }
  bc.putImageData(boughPixels, 0, 0);
  const leftBough: Tree = { texture: boughTexture,
    x: 0, y: 0, axis: "x", phase: 0.4, amplitude: 3.6 };

  // Foreground masonry masks moving trees; no rectangular tree crops can cross
  // the stonework. The preserved original floor is completely stationary.
  const front = createCanvas(WIDTH, HEIGHT);
  const fc = front.getContext("2d")!;
  const masonry = polygon([
    [0, 609], [43, 609], [43, 634], [81, 634], [81, 608], [130, 608],
    [130, 634], [165, 634], [165, 608], [235, 608], [235, 628],
    [335, 628], [335, 660], [373, 660], [373, 628], [511, 628],
    [511, 660], [544, 660], [544, 628], [670, 628], [670, 660],
    [709, 660], [709, 628], [843, 628], [843, 660], [882, 660],
    [882, 628], [1007, 628], [1007, 660], [1039, 660], [1039, 628],
    [1157, 628], [1157, 660], [1197, 660], [1197, 628], [1334, 628],
    [1334, 660], [1365, 660], [1365, 628], [1538, 628], [1538, 607],
    [1672, 607], [1672, HEIGHT], [0, HEIGHT],
  ]);
  fc.save();
  fc.clip(masonry);
  fc.drawImage(images.original, 0, 0, WIDTH, HEIGHT);
  fc.restore();
  // The left lower tree attaches behind the tower, the narrow edge bough in front.
  fc.drawImage(base, 0, 300, 217, 309, 0, 300, 217, 309);
  const leaves = createAutumnLeaves();
  const distantLeaves = leaves.filter((leaf) => !leaf.near);
  const nearbyLeaves = leaves.filter((leaf) => leaf.near);

  return (context, time) => {
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.drawImage(base, 0, 0);
    context.save();
    context.clip(sky);
    clouds.forEach((cloud, index) => {
      const drift = wallCloudDrift(index, time);
      context.globalAlpha = index ? 0.72 : 0.86;
      // Overscan keeps source edges offscreen over the full travel range.
      context.drawImage(cloud, -70 + drift.x, index * 123 + drift.y, WIDTH + 140, cloud.height);
    });
    context.restore();
    drawLeaves(context, distantLeaves, time);
    for (const tree of trees) drawTree(context, tree, time);
    context.drawImage(front, 0, 0);
    drawTree(context, leftBough, time);
    drawLeaves(context, nearbyLeaves, time);
    context.globalAlpha = 1;
  };
}

export default memo(function GreatWallScene({ moving }: { moving: boolean }) {
  return <SceneCanvas name="great-wall" moving={moving} assets={ASSETS}
    prepare={prepare} fallback={ASSETS.original} />;
});
