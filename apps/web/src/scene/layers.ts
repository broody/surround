export const SCENE_WIDTH = 1672;
export const SCENE_HEIGHT = 941;

export type SceneImages = {
  plate: HTMLImageElement;
  water: HTMLImageElement;
  canopy: HTMLImageElement;
  maple: HTMLImageElement;
  shrub: HTMLImageElement;
  cloud: HTMLImageElement;
};

export const ASSET_URLS: Record<keyof SceneImages, string> = {
  plate: "/assets/garden/clean-plate.png",
  water: "/assets/moonlit-dojo.png",
  canopy: "/assets/garden/maple-canopy.png",
  maple: "/assets/garden/maple-foreground.png",
  shrub: "/assets/garden/right-shrub.png",
  cloud: "/assets/garden/cloud-bank.png",
};

export function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// The generated alpha sprites retain transparent padding, so source bounds and
// scene registration are explicit. Source PNGs remain untouched on disk.
export const BRANCH_LAYERS = [
  {
    key: "canopy",
    source: [7, 0, 940, 651],
    x: 352,
    y: 111,
    width: 406,
    height: 281,
    pivot: [0, 24],
    axis: "x",
    rotation: 0.011,
    flex: 3.5,
    phase: 0.7,
    nightTint: 0.53,
    behindFrame: true,
  },
  {
    key: "maple",
    source: [0, 161, 334, 669],
    x: -9,
    y: 190,
    width: 275,
    height: 606,
    pivot: [0, 375],
    axis: "y",
    rotation: 0.008,
    flex: 2.9,
    phase: 1.8,
    nightTint: 0.39,
    behindFrame: false,
  },
  {
    key: "shrub",
    source: [1404, 393, 268, 246],
    x: 1496,
    y: 482,
    width: 184,
    height: 169,
    pivot: [182, 149],
    axis: "x",
    rotation: 0.012,
    flex: 2.2,
    phase: 3.2,
    nightTint: 0.15,
    behindFrame: false,
  },
] as const;

type BranchSpec = (typeof BRANCH_LAYERS)[number];
export type BranchLayer = { spec: BranchSpec; texture: HTMLCanvasElement };

function sprite(
  image: HTMLImageElement,
  source: readonly [number, number, number, number],
  width: number,
  height: number,
  nightTint = 0,
) {
  const result = createCanvas(width, height);
  const context = result.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, ...source, 0, 0, width, height);
  if (nightTint) {
    context.globalCompositeOperation = "source-atop";
    context.fillStyle = `rgba(12, 23, 35, ${nightTint})`;
    context.fillRect(0, 0, width, height);
  }
  return result;
}

export function prepareLayers(images: SceneImages) {
  const branches: BranchLayer[] = BRANCH_LAYERS.map((spec) => ({
    spec,
    texture: sprite(
      images[spec.key],
      spec.source,
      spec.width,
      spec.height,
      spec.nightTint,
    ),
  }));
  const cloud = sprite(images.cloud, [80, 273, 2008, 230], 1004, 115);

  // Real foreground matte: the sky is cut out, so its clouds can move behind
  // mountains, distant trees, the pagoda spire and the architecture.
  const foreground = createCanvas(SCENE_WIDTH, SCENE_HEIGHT);
  const foregroundContext = foreground.getContext("2d")!;
  foregroundContext.drawImage(images.plate, 0, 0, SCENE_WIDTH, SCENE_HEIGHT);
  const sky = new Path2D();
  const skyline = [
    [355, 113],
    [1447, 113],
    [1447, 258],
    [1433, 258],
    [1415, 278],
    [1370, 292],
    [1331, 267],
    [1325, 225],
    [1314, 224],
    [1306, 269],
    [1274, 289],
    [1220, 295],
    [1158, 287],
    [1084, 264],
    [1000, 225],
    [986, 228],
    [893, 263],
    [797, 253],
    [681, 281],
    [568, 260],
    [521, 243],
    [477, 224],
    [427, 197],
    [355, 192],
  ];
  skyline.forEach(([x, y], index) =>
    index ? sky.lineTo(x, y) : sky.moveTo(x, y),
  );
  sky.closePath();
  foregroundContext.globalCompositeOperation = "destination-out";
  foregroundContext.fill(sky);
  return { branches, cloud, foreground };
}

export function drawBranch(
  context: CanvasRenderingContext2D,
  layer: BranchLayer,
  time: number,
) {
  const { spec, texture } = layer;
  const [rootX, rootY] = spec.pivot;
  const breeze =
    Math.sin(time * 0.55) * 0.65 + Math.sin(time * 0.23 + 0.6) * 0.35;
  const delayedBreeze = Math.sin(time * 0.55 - spec.phase * 0.19);
  const angle = spec.rotation * (breeze * 0.72 + delayedBreeze * 0.28);
  context.save();
  if (spec.behindFrame) {
    context.beginPath();
    context.rect(355, 113, 1092, 585);
    context.clip();
  }
  context.translate(spec.x + rootX, spec.y + rootY);
  context.rotate(angle);
  context.translate(-rootX, -rootY);

  // Connected strips form a continuous bending branch, anchored at its root.
  // The source is only foliage + alpha: no sky/wall pixels can move with it.
  const horizontal = spec.axis === "x";
  const length = horizontal ? spec.width : spec.height;
  const anchor = horizontal ? rootX : rootY;
  const reach = Math.max(anchor, length - anchor);
  const bendAt = (position: number) => {
    const distance = Math.min(1, Math.abs(position - anchor) / reach);
    return (
      distance *
      distance *
      spec.flex *
      (Math.sin(time * 0.79 + distance * 1.4 + spec.phase) * 0.76 +
        Math.sin(time * 1.63 + distance * 3 + spec.phase) * 0.24)
    );
  };
  for (let position = 0; position < length; position += 8) {
    const size = Math.min(8, length - position);
    const a = bendAt(position);
    const b = bendAt(position + size);
    context.save();
    if (horizontal) {
      context.transform(1, (b - a) / size, 0, 1, position, a);
      context.drawImage(
        texture,
        position,
        0,
        size,
        spec.height,
        0,
        0,
        size,
        spec.height,
      );
    } else {
      context.transform(1, 0, (b - a) / size, 1, a, position);
      context.drawImage(
        texture,
        0,
        position,
        spec.width,
        size,
        0,
        0,
        spec.width,
        size,
      );
    }
    context.restore();
  }
  context.restore();
}
