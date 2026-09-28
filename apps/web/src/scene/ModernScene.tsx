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
  CLOUD_SPAN,
  roomClock,
  roomCloudOffset,
  roomTreeOffset,
} from "./modernWeather";
import "./modern.css";

const ASSETS = {
  original: "/assets/modern/original.png",
  plate: "/assets/modern/clean-plate.png",
  trees: "/assets/modern/outdoor-trees.png",
  clouds: "/assets/modern/clouds.png",
};

function polygon(points: number[][]) {
  const path = new Path2D();
  points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();
  return path;
}

function prepare(images: SceneImages): ScenePainter {
  // These apertures deliberately exclude every blind, mullion and window sill.
  const windows = new Path2D();
  for (const pane of [
    [
      [1306, 146],
      [1361, 132],
      [1361, 338],
      [1306, 333],
    ],
    [
      [1384, 131],
      [1453, 113],
      [1453, 348],
      [1384, 341],
    ],
    [
      [1481, 107],
      [1585, 81],
      [1585, 365],
      [1481, 352],
    ],
    [
      [1620, 70],
      [1672, 56],
      [1672, 382],
      [1620, 371],
    ],
  ])
    windows.addPath(polygon(pane));

  // A skyline matte keeps moving clouds behind the original building silhouettes.
  const sky = polygon([
    [1290, 35],
    [1672, 35],
    [1672, 120],
    [1657, 124],
    [1657, 163],
    [1635, 169],
    [1635, 230],
    [1600, 235],
    [1600, 125],
    [1544, 125],
    [1536, 123],
    [1511, 132],
    [1511, 202],
    [1495, 203],
    [1495, 245],
    [1440, 246],
    [1440, 201],
    [1425, 200],
    [1425, 191],
    [1405, 191],
    [1405, 200],
    [1355, 200],
    [1355, 164],
    [1311, 164],
    [1311, 240],
    [1290, 240],
  ]);
  const clouds = createCanvas(CLOUD_SPAN, 210);
  const cloudContext = clouds.getContext("2d")!;
  cloudContext.imageSmoothingEnabled = false;
  // The generated sheet is 1671 px wide. Preserve its native scale, not a stretch.
  cloudContext.drawImage(
    images.clouds,
    1280,
    35,
    images.clouds.width - 1280,
    210,
    0,
    0,
    images.clouds.width - 1280,
    210,
  );

  const trees = createCanvas(384, 156);
  const treeContext = trees.getContext("2d")!;
  treeContext.imageSmoothingEnabled = false;
  treeContext.drawImage(images.trees, 1288, 232, 384, 156, 0, 0, 384, 156);

  // Keep the approved room pixel-for-pixel outside the windows and clock face.
  const base = createCanvas(WIDTH, HEIGHT);
  const baseContext = base.getContext("2d")!;
  baseContext.drawImage(images.original, 0, 0, WIDTH, HEIGHT);
  baseContext.save();
  baseContext.clip(windows);
  baseContext.drawImage(images.plate, 0, 0, WIDTH, HEIGHT);
  baseContext.restore();
  baseContext.save();
  baseContext.beginPath();
  baseContext.ellipse(987, 119, 24, 24, 0, 0, Math.PI * 2);
  baseContext.clip();
  baseContext.drawImage(images.plate, 0, 0, WIDTH, HEIGHT);
  baseContext.restore();

  const hand = (
    context: CanvasRenderingContext2D,
    angle: number,
    length: number,
    width: number,
    color: string,
    tail = 0,
  ) => {
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineCap = "square";
    context.beginPath();
    context.moveTo(987 - Math.sin(angle) * tail, 119 + Math.cos(angle) * tail);
    context.lineTo(
      987 + Math.sin(angle) * length,
      119 - Math.cos(angle) * length,
    );
    context.stroke();
  };

  return (context, time) => {
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.drawImage(base, 0, 0);
    context.save();
    context.clip(windows);
    context.save();
    context.clip(sky);
    const travel = roomCloudOffset(time);
    for (const repeat of [-1, 0, 1]) {
      context.drawImage(
        clouds,
        Math.round(1280 + travel + repeat * CLOUD_SPAN),
        35,
      );
    }
    context.restore();
    // Connected strips bend the foliage, rather than sliding rectangular panes.
    for (let row = 0; row < trees.height; row += 6) {
      const span = Math.min(6, trees.height - row);
      const sample = Math.min(span + 1, trees.height - row);
      const a = roomTreeOffset(row, trees.height, time);
      const b = roomTreeOffset(row + span, trees.height, time);
      context.save();
      context.transform(1, 0, (b - a) / span, 1, 1288 + a, 232 + row);
      context.drawImage(
        trees,
        0,
        row,
        trees.width,
        sample,
        0,
        0,
        trees.width,
        sample,
      );
      context.restore();
    }
    context.restore();

    // Weather uses pauseable scene time; the clock resyncs to local system time
    // on every paint, including the first frame after pause or a hidden tab.
    const angles = roomClock();
    hand(context, angles.hour, 12, 2, "#393630");
    hand(context, angles.minute, 18, 1.5, "#393630");
    hand(context, angles.second, 20, 1, "#915f41", 4);
    context.fillStyle = "#393630";
    context.fillRect(986, 118, 3, 3);
  };
}

export default memo(function ModernScene({ moving }: { moving: boolean }) {
  return (
    <SceneCanvas
      name="modern"
      moving={moving}
      assets={ASSETS}
      fallback={ASSETS.original}
      prepare={prepare}
    />
  );
});
