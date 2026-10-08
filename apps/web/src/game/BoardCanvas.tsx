import { useEffect, useRef, useState } from "react";
import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import { boardSize, coordinate, type Color, type Position } from "./rules";
import {
  boardEdge,
  EDGE,
  fullBoard,
  isFullBoard,
  MARGIN,
  regionContains,
  STEP,
  viewport,
  type BoardRegion,
} from "./region";

// On a cropped side, grid lines trail past the last shown intersection to
// signal that the board goes on.
const CROP_TAIL = 10;

/** A teaching mark drawn on an intersection, over any stone there. */
export type BoardMark = {
  point: number;
  kind: "triangle" | "cross" | "circle" | "square" | "label";
  /** The letter or number shown by a "label" mark. */
  text?: string;
};

/** Star points: 3-3 corners on 9×9, 4-4 corners and center up to 13×13, and
 * the nine traditional points on larger boards. */
function starPoints(size: number) {
  if (size < 7) return [];
  const edge = size >= 13 ? 3 : 2;
  const far = size - 1 - edge;
  const mid = (size - 1) / 2;
  const lines = size >= 15 ? [edge, mid, far] : [edge, far];
  const points = lines.flatMap((row) => lines.map((col) => [row, col]));
  if (size < 15 && size % 2) points.push([mid, mid]);
  return points;
}

// Stones are pixel art redrawn for the board's size on screen: each art pixel
// is a whole number of screen pixels, as big as it can be while keeping at
// least MIN_ART_PIXELS across a stone. Scaling one fixed sprite instead drops
// and doubles pixels unevenly at in-between zooms.
const STONE_DIAMETER = 26.4;
const MIN_ART_PIXELS = 12;
const SHADOW_ALPHA = 0.32;

/** How a new move drops in: it fades in held above its point, a faint small
 * shadow beneath it, then falls into place as the shadow grows to the
 * stone's own width. */
export type Drop = {
  /** How high the stone is held, in stone widths. */
  height: number;
  /** How long it's held there, from when it starts to fade in; shorter than
   * the fade and it's still fading in as it falls. */
  holdMs: number;
  /** How long it takes to fall. */
  fallMs: number;
  /** Its shadow's width while held, as a share of the stone's. */
  shadow: number;
};
const DROP: Drop = { height: 0.3, holdMs: 160, fallMs: 130, shadow: 0.5 };
// Lit from the upper left, the shadow of a raised stone falls down and to the
// right, at most this many stone widths further however high it's held.
const SHADOW_REACH = 0.24;
const LIFTED_SHADOW_ALPHA = 0.2;
const FADE_MS = 110;
// Stones cascading onto an empty board drop in the order they were played,
// each a little after the one before.
const CASCADE_STAGGER_MS = 60;

type StonePalette = {
  outline: string;
  /** Dark to light. */
  body: string[];
  /** The glint's ends, then its center. */
  glint: [string, string];
  /** Light bounced up from the board along the shadowed edge. */
  rim?: string;
  /** The share of the shadowed side left in the darkest tone, and how quickly
   * the tones brighten towards the light. */
  floor: number;
  gamma: number;
};

const BLACK_STONE: StonePalette = {
  outline: "#04070b",
  body: ["#0d131b", "#19222d", "#2b3746"],
  glint: ["#4a586a", "#8e9aa8"],
  rim: "#1a2430",
  floor: 0.12,
  gamma: 1,
};

const WHITE_STONE: StonePalette = {
  outline: "#857759",
  body: ["#c8bfa8", "#e1dccd", "#f3f1e8"],
  glint: ["#fbfaf5", "#ffffff"],
  floor: 0.08,
  gamma: 0.75,
};

const normalize = (v: number[]) => {
  const length = Math.hypot(...v);
  return v.map((x) => x / length);
};
// Light from the upper left, and the direction its reflection is brightest.
const LIGHT = normalize([-0.5, -0.62, 0.6]);
const HALFWAY = normalize([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);

/**
 * The art pixels a stone `size` across covers: those whose centers lie within
 * some cutoff of its middle. Going round its edge from the top to the side,
 * each run of pixels is no longer than the one before it, or that step juts
 * out. Of the cutoffs that keep to that and still reach the edges, the one
 * whose edge bends most evenly is used, nearest the radius if several tie.
 * Cutting at the radius itself can bunch the bend into a few corners between
 * long flats and diagonals, and at 14 pixels across the stone reads as an
 * octagon.
 */
function disc(size: number) {
  const radius = size / 2;
  // Squared distance from the center of each column (or row) of pixels.
  const offsets = Array.from(
    { length: size },
    (_, i) => (i + 0.5 - radius) ** 2,
  );
  const rows = Math.ceil(radius);
  /** How far, in radians, the edge's direction strays from turning steadily
   * between the top and the side; Infinity if a step juts out. */
  const unevenness = (limit: number) => {
    // Half of each row's width, from the top to the middle.
    const half = offsets
      .slice(0, rows)
      .map((dy) => offsets.filter((dx) => dx + dy <= limit).length / 2);
    if (!half[0]) return Infinity;
    let reach = 0;
    let longest = Infinity;
    for (let j = 0; j < size / 2; j++) {
      // Past the diagonal the side mirrors the top.
      if (half[j] > Math.sqrt(offsets[j]) + 0.5) break;
      if (half[j] - reach > longest) return Infinity;
      longest = half[j] - reach;
      reach = half[j];
    }
    // The edge's stairs from the middle of the top to the middle of the
    // side, alternately across and down.
    const stairs: number[] = [];
    for (let j = 0; j < rows; j++) {
      const across = half[j] - (j ? half[j - 1] : 0);
      const down = Math.min(1, radius - j);
      if (across || !stairs.length) stairs.push(across, down);
      else stairs[stairs.length - 1] += down;
    }
    // The eye smooths the stairs into a line through the middle of each, and
    // through the middles of the top and side where they start and end.
    let x = 0;
    let y = radius;
    const path = [[x, y]];
    stairs.forEach((run, k) => {
      const [fromX, fromY] = [x, y];
      if (k % 2) y -= run;
      else x += run;
      if (k && k < stairs.length - 1)
        path.push([(fromX + x) / 2, (fromY + y) / 2]);
    });
    path.push([x, y]);
    // A circle's edge turns at a steady rate along its length.
    const pieces = path.slice(1).map(([toX, toY], k) => {
      const [fromX, fromY] = path[k];
      return {
        length: Math.hypot(toX - fromX, toY - fromY),
        angle: Math.atan2(fromY - toY, toX - fromX),
      };
    });
    const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
    let along = 0;
    let worst = 0;
    for (const { length, angle } of pieces) {
      for (const at of [along, along + length])
        worst = Math.max(worst, Math.abs(angle - ((Math.PI / 2) * at) / total));
      along += length;
    }
    return worst;
  };
  const target = radius * radius;
  let limit = target;
  let best = Infinity;
  for (const cutoff of [
    ...new Set(offsets.flatMap((a) => offsets.map((b) => a + b))),
  ].sort((a, b) => Math.abs(a - target) - Math.abs(b - target))) {
    const score = unevenness(cutoff);
    if (score < best - 1e-9) [limit, best] = [cutoff, score];
  }
  return (i: number, j: number) =>
    i >= 0 &&
    j >= 0 &&
    i < size &&
    j < size &&
    offsets[i] + offsets[j] <= limit;
}

/** A lit stone `size` art pixels across: colors row by row, null outside. */
function stoneArt(size: number, palette: StonePalette) {
  const radius = size / 2;
  const inside = disc(size);
  const r = radius - 0.6;
  const glintX = Math.round(radius + HALFWAY[0] * r - 0.5);
  const glintY = Math.round(radius + HALFWAY[1] * r - 0.5);
  const tones = palette.body.length;
  const art: (string | null)[] = [];
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const within = (d: number) =>
        inside(i - d, j) &&
        inside(i + d, j) &&
        inside(i, j - d) &&
        inside(i, j + d);
      const dx = (i + 0.5 - radius) / r;
      const dy = (j + 0.5 - radius) / r;
      const dz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
      const lit = dx * LIGHT[0] + dy * LIGHT[1] + dz * LIGHT[2];
      if (!inside(i, j)) art.push(null);
      else if (!within(1)) art.push(palette.outline);
      else if (i === glintX && j === glintY) art.push(palette.glint[1]);
      // One art pixel either side along the stone's curve: a short glint.
      else if (Math.abs(i - glintX) === 1 && i - glintX === glintY - j)
        art.push(palette.glint[0]);
      else if (palette.rim && !within(2) && lit < -0.2 && dx + dy > 0)
        art.push(palette.rim);
      else {
        // The light wraps past the lit half so the shadowed side keeps its
        // shape, and neighboring tones meet in a checkerboard seam.
        const light = Math.min(
          1,
          Math.max(0, (0.5 + 0.5 * lit - palette.floor) / (1 - palette.floor)),
        );
        const tone = light ** palette.gamma * (tones - 1);
        const base = Math.floor(tone);
        const blend = tone - base;
        const threshold =
          Math.abs(blend - 0.5) < 0.14 ? ((i + j) % 2 ? 0.3 : 0.7) : 0.5;
        art.push(
          palette.body[Math.min(tones - 1, base + (blend > threshold ? 1 : 0))],
        );
      }
    }
  return art;
}

/** Paints `size`×`size` art pixels as `block`×`block` squares, so the texture
 * maps one-to-one onto screen pixels. */
function artTexture(
  size: number,
  block: number,
  color: (index: number) => string | null,
) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size * block;
  const ctx = canvas.getContext("2d")!;
  for (let index = 0; index < size * size; index++) {
    const fill = color(index);
    if (!fill) continue;
    ctx.fillStyle = fill;
    ctx.fillRect(
      (index % size) * block,
      Math.floor(index / size) * block,
      block,
      block,
    );
  }
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
}

/** Everything drawn for stones at one on-screen size. */
function stoneTextures(size: number, block: number) {
  const art = [stoneArt(size, BLACK_STONE), stoneArt(size, WHITE_STONE)];
  // A fresh move held above the board, nearer the eye: one art pixel bigger
  // all round, keeping the same center.
  const pop = [
    stoneArt(size + 2, BLACK_STONE),
    stoneArt(size + 2, WHITE_STONE),
  ];
  const shadow = (across: number) => {
    const inside = disc(across);
    return artTexture(across, block, (k) =>
      inside(k % across, Math.floor(k / across)) ? "#42301d" : null,
    );
  };
  // The shadow of a stone held above the board, smallest first: two art
  // pixels narrower at a time, so each centers like the stone.
  const lifted: Texture[] = [];
  for (let across = size - 2; across > 0; across -= 2)
    lifted.unshift(shadow(across));
  // The last move's mark: a hollow square, centered like the stone.
  let mark = Math.round(size * 0.24);
  if ((size - mark) % 2) mark++;
  mark = Math.max(mark, size % 2 ? 3 : 4);
  const from = (size - mark) / 2;
  const onMark = (index: number) => {
    const i = (index % size) - from;
    const j = Math.floor(index / size) - from;
    return (
      i >= 0 &&
      j >= 0 &&
      i < mark &&
      j < mark &&
      (i === 0 || j === 0 || i === mark - 1 || j === mark - 1)
    );
  };
  return {
    size,
    block,
    stone: art.map((pixels) => artTexture(size, block, (k) => pixels[k])),
    pop: pop.map((pixels) => artTexture(size + 2, block, (k) => pixels[k])),
    // Both colors share one shape.
    shadow: shadow(size),
    lifted,
    mark: ["#efdba3", "#4d565e"].map((ink) =>
      artTexture(size, block, (k) => (onMark(k) ? ink : null)),
    ),
  };
}
type StoneTextures = ReturnType<typeof stoneTextures>;
const destroyStoneTextures = (set: StoneTextures) =>
  [...set.stone, ...set.pop, set.shadow, ...set.lifted, ...set.mark].forEach(
    (texture) => texture.destroy(true),
  );

type Props = {
  position: Position;
  coordinates: boolean;
  readOnly?: boolean;
  /** Shows only these columns and rows, zoomed to fill the canvas. */
  region?: BoardRegion;
  /** Replaces the read-only board's description of what it shows. */
  description?: string;
  /** Describes an interactive mode such as selecting dead groups. */
  interactionLabel?: string;
  marks?: readonly BoardMark[];
  /** Stones drawn faded, as when marked dead at the end of a game. */
  dead?: ReadonlySet<number>;
  /** Shows the side to play's stone faded here on a read-only board, as
   * hovering does on a live one; for controls laid over the board. */
  previewPoint?: number | null;
  /** Stones arriving on an empty board drop in one by one, in move order,
   * rather than appearing at once. */
  cascade?: boolean;
  /** How new stones drop in, if not as on a game board. */
  drop?: Drop;
  /** Called once the board is drawn, or is showing why it can't be. */
  onReady?: () => void;
  onPlay: (point: number) => void;
  onHover: (point: number | null) => void;
};

export default function BoardCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const repaint = useRef<() => void>(() => {});
  const relayout = useRef<() => void>(() => {});
  const setPreview = useRef<(p: number | null) => void>(() => {});
  const keyboardPoint = useRef(180);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let initialized = false;
    let animation = 0;
    let observer: ResizeObserver | undefined;
    const app = new Application();
    let stoneSet: StoneTextures | null = null;
    const parent = host.current!;

    void (async () => {
      await app.init({
        width: EDGE,
        height: EDGE,
        antialias: false,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        autoStart: false,
        backgroundAlpha: 0,
        preference: "webgl",
      });
      initialized = true;
      if (disposed) {
        // Other boards (and StrictMode's replacement) can still own pooled GPU
        // batches. Remove this canvas without clearing Pixi's global pools.
        app.destroy(
          { removeView: true, releaseGlobalResources: false },
          { children: true },
        );
        return;
      }
      app.canvas.setAttribute("aria-hidden", "true");
      parent.appendChild(app.canvas);

      const board = new Graphics();
      const drawBoard = (size: number) => {
        const edge = boardEdge(size);
        board.clear();
        board.rect(0, 0, edge, edge).fill(0x483424);
        board.rect(3, 3, edge - 6, edge - 6).fill(0xb08443);
        board.rect(6, 6, edge - 12, edge - 12).fill(0xecd094);
        board.rect(8, 8, edge - 16, edge - 16).fill(0xc5934c);
        board.rect(12, 12, edge - 24, edge - 24).fill(0xd6ac65);
        let seed = 913;
        const rand = () => {
          seed = (seed * 16807) % 2147483647;
          return seed / 2147483647;
        };
        // The same grain density at every board size.
        const grains = Math.round(850 * (edge / EDGE) ** 2);
        for (let i = 0; i < grains; i++) {
          const x = 13 + Math.floor(rand() * (edge - 26));
          const y = 13 + Math.floor(rand() * (edge - 26));
          const width = Math.min(edge - 12 - x, 6 + Math.floor(rand() * 90));
          board.rect(x, y, width, 1).fill({
            color: i % 3 ? 0x91612f : 0xffe7aa,
            alpha: i % 3 ? 0.055 : 0.13,
          });
        }
        board
          .rect(20, 20, edge - 40, edge - 40)
          .stroke({ color: 0x79552b, width: 1, alpha: 0.28 });
      };
      app.stage.addChild(board);
      const grid = new Graphics();
      app.stage.addChild(grid);
      const labels = new Container();
      app.stage.addChild(labels);
      const stones = new Container();
      const marks = new Container();
      const preview = new Container();
      app.stage.addChild(stones, marks, preview);
      const sizeNow = () => boardSize(latest.current.position.board);
      let laidOutSize = 0;
      let scale = 1;
      // Screen pixels per board unit, a grid line's width in screen pixels,
      // and where on the board, in board units, the canvas's top-left is.
      let density = 1;
      let lineWidth = 1;
      let origin = { x: 0, y: 0 };
      let hovered: number | null = null;
      // The position last drawn.
      let previous = latest.current.position;
      // Moves still on their way down. They outlast a repaint, so a quick
      // reply or a resize doesn't cut one short.
      type Landing = {
        move: number;
        point: number;
        start: number;
        /** The stones it captures, left on the board until it lands. */
        captured: { point: number; color: Color }[];
      };
      let landings: Landing[] = [];
      let painted = false;
      /** Where a stone goes: centered on its grid lines, edges on whole
       * screen pixels. */
      const stoneCenter = (point: number) => {
        const across = stoneSet!.size * stoneSet!.block;
        const axis = (line: number, start: number) => {
          // The screen pixels the line covers, as the renderer fills them.
          const at = (line - start) * density;
          const middle =
            (Math.ceil(at - 0.5) + Math.ceil(at + lineWidth - 0.5)) / 2;
          return (
            (Math.round(middle - across / 2) + across / 2) / density + start
          );
        };
        return [
          axis(MARGIN + (point % laidOutSize) * STEP, origin.x),
          axis(MARGIN + Math.floor(point / laidOutSize) * STEP, origin.y),
        ] as const;
      };
      const stoneSprite = (texture: Texture, point: number, offset = 0) => {
        const sprite = new Sprite(texture);
        const [x, y] = stoneCenter(point);
        sprite.anchor.set(0.5);
        // The textures are drawn in screen pixels.
        sprite.scale.set(1 / density);
        sprite.position.set(x + offset, y + offset);
        return sprite;
      };
      const renderPreview = () => {
        preview.removeChildren().forEach((child) => child.destroy());
        const { position, readOnly, previewPoint } = latest.current;
        const point = readOnly ? (previewPoint ?? null) : hovered;
        if (
          stoneSet &&
          point !== null &&
          !position.board[point] &&
          !position.paused
        ) {
          const ghost = stoneSprite(stoneSet.stone[position.turn - 1], point);
          ghost.alpha = 0.5;
          preview.addChild(ghost);
        }
      };
      setPreview.current = (point) => {
        hovered = point;
        latest.current.onHover(point);
        renderPreview();
        app.render();
      };
      repaint.current = () => {
        // A position on a different-sized board needs the grid redrawn first,
        // which repaints again once it's done.
        if (sizeNow() !== laidOutSize) return relayout.current();
        cancelAnimationFrame(animation);
        const {
          position,
          coordinates,
          readOnly,
          dead,
          cascade,
          drop = DROP,
        } = latest.current;
        app.stage.eventMode = readOnly ? "none" : "static";
        labels.visible = coordinates;
        stones
          .removeChildren()
          .forEach((child) => child.destroy({ children: true }));
        const set = stoneSet!;
        const now = performance.now();
        const { board, moves } = position;
        landings = landings.filter(
          (landing) =>
            now - landing.start <
              Math.max(FADE_MS, drop.holdMs + drop.fallMs) &&
            moves[landing.move]?.point === landing.point &&
            board[landing.point] === moves[landing.move].color,
        );
        const still = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        const cascading =
          cascade &&
          !still &&
          (!painted || previous.board.every((stone) => !stone));
        if (cascading)
          moves.forEach(({ point, color }, index) => {
            // Only the stones still on the board, each from its last move.
            if (
              point != null &&
              board[point] === color &&
              !dead?.has(point) &&
              !moves.slice(index + 1).some((later) => later.point === point)
            )
              landings.push({
                move: index,
                point,
                start: now + index * CASCADE_STAGGER_MS,
                captured: [],
              });
          });
        painted = true;
        const move = moves.at(-1);
        const added = moves.slice(previous.moves.length);
        const lastDrawn = previous.moves.at(-1);
        const before = moves[previous.moves.length - 1];
        const sameSize = previous.board.length === board.length;
        // The stones on screen that are gone now.
        const taken = sameSize
          ? previous.board.flatMap((color, point) =>
              color && !board[point] ? [{ point, color }] : [],
            )
          : [];
        // Only play that goes on from the position on screen drops a stone;
        // another game or lesson page just appears.
        const continues =
          added.length > 0 &&
          sameSize &&
          before?.point === lastDrawn?.point &&
          before?.color === lastDrawn?.color &&
          previous.board.every(
            (stone, point) => !stone || !board[point] || board[point] === stone,
          ) &&
          taken.length <=
            added.reduce((sum, { captures }) => sum + captures, 0);
        if (
          !cascading &&
          continues &&
          move?.point != null &&
          !previous.board[move.point] &&
          !dead?.has(move.point) &&
          !still
        )
          landings.push({
            move: moves.length - 1,
            point: move.point,
            start: now,
            // Which stones it took is only known when it's the one move since.
            captured: added.length === 1 ? taken : [],
          });
        previous = position;
        const falling: {
          landing: Landing;
          stone: Sprite;
          shadow: Sprite;
          mark: Sprite | null;
          color: Color;
          /** Where the stone and its shadow come to rest. */
          rest: number;
          shadowRest: { x: number; y: number };
          captured: Sprite[];
        }[] = [];
        const last = move?.point;
        const shadows = new Container();
        stones.addChild(shadows);
        // The stone's own shape, one art pixel down and to the right.
        const shadowSprite = (point: number) => {
          const shadow = stoneSprite(set.shadow, point, set.block / density);
          shadow.alpha = SHADOW_ALPHA;
          shadows.addChild(shadow);
          return shadow;
        };
        board.forEach((color, point) => {
          if (!color) return;
          const isDead = dead?.has(point);
          const shadow = isDead ? null : shadowSprite(point);
          const stone = stoneSprite(set.stone[color - 1], point);
          if (isDead) stone.alpha = 0.4;
          stones.addChild(stone);
          let mark: Sprite | null = null;
          if (
            point === last &&
            !readOnly &&
            // A teaching mark on the stone already draws the eye there.
            !latest.current.marks?.some((mark) => mark.point === point)
          )
            mark = stones.addChild(stoneSprite(set.mark[color - 1], point));
          const landing = landings.find((landing) => landing.point === point);
          if (landing && shadow)
            falling.push({
              landing,
              stone,
              shadow,
              mark,
              color,
              rest: stone.y,
              shadowRest: { x: shadow.x, y: shadow.y },
              captured: [],
            });
        });
        // Beneath the other stones, so a falling one passes over them.
        for (const { landing, captured } of falling)
          for (const { point, color } of landing.captured)
            if (!board[point])
              captured.push(
                shadowSprite(point),
                stones.addChildAt(stoneSprite(set.stone[color - 1], point), 1),
              );
        marks.removeChildren().forEach((child) => child.destroy());
        for (const mark of latest.current.marks ?? []) {
          const [x, y] = stoneCenter(mark.point);
          const stone = position.board[mark.point];
          const ink =
            stone === 1 ? 0xf4ead0 : stone === 2 ? 0x2a2118 : 0x3d2a14;
          const graphic = new Graphics();
          if (mark.kind === "triangle")
            graphic
              .poly([x, y - 7, x + 6.5, y + 4.5, x - 6.5, y + 4.5])
              .stroke({ color: ink, width: 1.8 });
          else if (mark.kind === "cross")
            graphic
              .moveTo(x - 5, y - 5)
              .lineTo(x + 5, y + 5)
              .moveTo(x + 5, y - 5)
              .lineTo(x - 5, y + 5)
              .stroke({ color: ink, width: 1.8 });
          else if (mark.kind === "circle")
            graphic.circle(x, y, 6.5).stroke({ color: ink, width: 1.8 });
          else if (mark.kind === "square")
            graphic
              .rect(x - 5.5, y - 5.5, 11, 11)
              .stroke({ color: ink, width: 1.8 });
          else if (!stone)
            // Clear the grid lines behind a letter on an empty point.
            graphic.rect(x - 8, y - 8, 16, 16).fill(0xd6ac65);
          marks.addChild(graphic);
          if (mark.kind === "label") {
            const text = new Text({
              text: mark.text ?? "",
              style: {
                fontFamily: "IBM Plex Mono, monospace",
                fontSize: 14,
                fontWeight: "700",
                fill: ink,
              },
              resolution: app.renderer.resolution * Math.max(1, scale),
            });
            text.anchor.set(0.5);
            text.position.set(x, y);
            marks.addChild(text);
          }
        }
        // In whole screen pixels, so the art's pixels stay whole as it falls.
        const width = set.size * set.block;
        const lift = Math.max(1, Math.round(width * drop.height));
        const reach = Math.round(width * SHADOW_REACH);
        const shrinking = [...set.lifted, set.shadow];
        /** Draws each falling move as it is at `time`; true once all have
         * landed. */
        const frame = (time: number) => {
          let done = true;
          for (const entry of falling) {
            const { landing, stone, shadow, mark, color } = entry;
            const elapsed = time - landing.start;
            // A cascading stone waits its turn unseen.
            const shown = Math.min(1, Math.max(0, elapsed / FADE_MS));
            const fall = Math.min(
              1,
              Math.max(0, (elapsed - drop.holdMs) / drop.fallMs),
            );
            // Gathering speed until it meets the board.
            const height = Math.round(lift * (1 - fall * fall));
            const near = 1 - height / lift;
            const landed = height === 0;
            // It shrinks back a step on landing rather than smoothly.
            stone.texture = (landed ? set.stone : set.pop)[color - 1];
            stone.alpha = shown;
            stone.y = entry.rest - height / density;
            // The shadow grows, darkens and slides in under the stone as it
            // comes down.
            const drift = Math.round((reach * height) / lift) / density;
            shadow.position.set(
              entry.shadowRest.x + drift,
              entry.shadowRest.y + drift,
            );
            const share = drop.shadow + near * (1 - drop.shadow);
            // Each smaller shadow is two art pixels narrower.
            shadow.texture =
              shrinking[
                Math.max(
                  0,
                  shrinking.length -
                    1 -
                    Math.round((set.size * (1 - share)) / 2),
                )
              ];
            shadow.alpha =
              shown *
              (LIFTED_SHADOW_ALPHA +
                near * (SHADOW_ALPHA - LIFTED_SHADOW_ALPHA));
            if (mark) mark.visible = landed;
            if (landed)
              entry.captured.splice(0).forEach((sprite) => sprite.destroy());
            done &&= landed && shown === 1;
          }
          return done;
        };
        if (!frame(now)) {
          const tick = () => {
            if (disposed) return;
            const landed = frame(performance.now());
            app.render();
            if (!landed) animation = requestAnimationFrame(tick);
          };
          animation = requestAnimationFrame(tick);
        }
        renderPreview();
        app.render();
      };
      const pointAt = (x: number, y: number) => {
        const col = Math.round((x - MARGIN) / STEP);
        const row = Math.round((y - MARGIN) / STEP);
        const { left, top, right, bottom } =
          latest.current.region ?? fullBoard(laidOutSize);
        return col >= left && col <= right && row >= top && row <= bottom
          ? row * laidOutSize + col
          : null;
      };
      app.stage.on("pointermove", (event) => {
        const local = event.getLocalPosition(app.stage);
        setPreview.current(pointAt(local.x, local.y));
      });
      app.stage.on("pointerleave", () => setPreview.current(null));
      app.stage.on("pointertap", (event) => {
        if (latest.current.readOnly) return;
        const local = event.getLocalPosition(app.stage);
        const point = pointAt(local.x, local.y);
        if (point !== null) {
          keyboardPoint.current = point;
          latest.current.onPlay(point);
        }
      });
      const resize = () => {
        if (disposed) return;
        const size = sizeNow();
        if (size !== laidOutSize) {
          drawBoard(size);
          laidOutSize = size;
        }
        const region = latest.current.region ?? fullBoard(size);
        const view = viewport(region, size);
        const width = Math.max(1, Math.round(parent.clientWidth));
        scale = width / view.width;
        app.renderer.resize(
          width,
          Math.max(1, Math.round(view.height * scale)),
        );
        app.stage.scale.set(scale);
        app.stage.position.set(-view.x * scale, -view.y * scale);
        density = scale * app.renderer.resolution;
        lineWidth = Math.max(1, Math.round(scale)) * app.renderer.resolution;
        origin = { x: view.x, y: view.y };
        // The biggest whole-pixel art pixel that keeps enough of them across.
        const across = STONE_DIAMETER * density;
        const block = Math.max(1, Math.floor(across / MIN_ART_PIXELS));
        // Neighbors keep at least a pixel of wood between them, so their
        // outlines never merge.
        const most = Math.floor((Math.floor(STEP * density) - 1) / block);
        let artSize = Math.min(Math.round(across / block), most);
        // A stone as wide as its line in odd or even pixels centers exactly.
        if (block === 1 && artSize % 2 !== Math.round(lineWidth) % 2) artSize--;
        let stale: StoneTextures | null = null;
        if (stoneSet?.size !== artSize || stoneSet.block !== block) {
          stale = stoneSet;
          stoneSet = stoneTextures(artSize, block);
        }
        app.stage.hitArea = new Rectangle(
          view.x,
          view.y,
          view.width,
          view.height,
        );
        // Lines are a whole number of screen pixels (at least one, even on a
        // narrow phone) so a fractional zoom can't draw them at uneven weights.
        const thickness = Math.max(1, Math.round(scale)) / scale;
        const tail = (edge: boolean) => (edge ? 0 : CROP_TAIL);
        const gridLeft = MARGIN + region.left * STEP - tail(region.left === 0);
        const gridTop = MARGIN + region.top * STEP - tail(region.top === 0);
        const gridRight =
          MARGIN + region.right * STEP + tail(region.right === size - 1);
        const gridBottom =
          MARGIN + region.bottom * STEP + tail(region.bottom === size - 1);
        grid.clear();
        for (let col = region.left; col <= region.right; col++)
          grid
            .rect(
              MARGIN + col * STEP,
              gridTop,
              thickness,
              gridBottom - gridTop + thickness,
            )
            .fill({ color: 0x684824, alpha: 0.8 });
        for (let row = region.top; row <= region.bottom; row++)
          grid
            .rect(
              gridLeft,
              MARGIN + row * STEP,
              gridRight - gridLeft + thickness,
              thickness,
            )
            .fill({ color: 0x684824, alpha: 0.8 });
        for (const [row, col] of starPoints(size)) {
          if (!regionContains(region, row * size + col, size)) continue;
          grid
            .rect(MARGIN + col * STEP - 2, MARGIN + row * STEP - 2, 5, 5)
            .fill(0x523c22);
        }
        // Labels keep the full board's on-screen size however far we zoom, and
        // rasterize at the zoomed resolution so they stay sharp.
        labels.removeChildren().forEach((child) => child.destroy());
        const label = (text: string, x: number, y: number) => {
          const node = new Text({
            text,
            style: {
              fontFamily: "IBM Plex Mono, monospace",
              fontSize: (12 * view.width) / EDGE,
              fill: 0x725630,
            },
            resolution: app.renderer.resolution * Math.max(1, scale),
          });
          node.anchor.set(0.5);
          node.position.set(x, y);
          labels.addChild(node);
        };
        const firstCol = MARGIN + region.left * STEP;
        const lastCol = MARGIN + region.right * STEP;
        const firstRow = MARGIN + region.top * STEP;
        const lastRow = MARGIN + region.bottom * STEP;
        for (let col = region.left; col <= region.right; col++) {
          label("ABCDEFGHJKLMNOPQRST"[col], MARGIN + col * STEP, firstRow - 18);
          label("ABCDEFGHJKLMNOPQRST"[col], MARGIN + col * STEP, lastRow + 20);
        }
        for (let row = region.top; row <= region.bottom; row++) {
          label(String(size - row), firstCol - 19, MARGIN + row * STEP);
          label(String(size - row), lastCol + 20, MARGIN + row * STEP);
        }
        repaint.current();
        // Only once the repaint has replaced every sprite that used them.
        if (stale) destroyStoneTextures(stale);
      };
      relayout.current = resize;
      observer = new ResizeObserver(resize);
      observer.observe(parent);
      resize();
      setReady(true);
    })().catch((reason) => {
      console.error("Board renderer failed to initialize", reason);
      if (!disposed) setError(true);
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(animation);
      observer?.disconnect();
      repaint.current = () => {};
      relayout.current = () => {};
      setPreview.current = () => {};
      if (initialized)
        app.destroy(
          { removeView: true, releaseGlobalResources: false },
          { children: true },
        );
      if (stoneSet) destroyStoneTextures(stoneSet);
    };
  }, []);

  useEffect(() => {
    if (ready || error) latest.current.onReady?.();
  }, [ready, error]);

  useEffect(() => {
    repaint.current();
  }, [
    props.position,
    props.coordinates,
    props.readOnly,
    props.marks,
    props.dead,
    props.previewPoint,
  ]);

  const size = boardSize(props.position.board);
  const region = props.region ?? fullBoard(size);
  const view = viewport(region, size);
  const regionKey = `${size}:${region.left},${region.top},${region.right},${region.bottom}`;
  useEffect(() => {
    if (!regionContains(region, keyboardPoint.current, size))
      keyboardPoint.current =
        Math.round((region.top + region.bottom) / 2) * size +
        Math.round((region.left + region.right) / 2);
    relayout.current();
  }, [regionKey]);

  const boardName = isFullBoard(region, size)
    ? `${size} by ${size} Go board`
    : `Section of a ${size} by ${size} Go board from ${coordinate(region.top * size + region.left, size)} to ${coordinate(region.bottom * size + region.right, size)}`;

  return (
    <div
      className={`board-canvas${focused ? " keyboard-focus" : ""}`}
      ref={host}
      style={{ aspectRatio: `${view.width} / ${view.height}` }}
      role={props.readOnly ? "img" : "group"}
      aria-label={
        props.readOnly
          ? props.description
            ? `${boardName}. ${props.description}`
            : `${boardName} showing an example opening. Stones sit on the grid intersections.`
          : `${boardName}. ${props.interactionLabel ?? `${props.position.turn === 1 ? "Black" : "White"} to play. Use arrow keys to select an intersection and Enter to place a stone.`}`
      }
      aria-describedby={props.readOnly ? undefined : "board-instructions"}
      tabIndex={props.readOnly ? undefined : 0}
      data-readonly={props.readOnly || undefined}
      data-ready={ready}
      onFocus={(event) => {
        setFocused(true);
        // A click or tap also focuses the board, before the stone is played;
        // only Tab should bring up the keyboard cursor (at first, the center).
        if (event.currentTarget.matches(":focus-visible"))
          setPreview.current(keyboardPoint.current);
      }}
      onBlur={() => {
        setFocused(false);
        setPreview.current(null);
      }}
      onKeyDown={(event) => {
        if (props.readOnly) return;
        let row = Math.floor(keyboardPoint.current / size);
        let col = keyboardPoint.current % size;
        if (event.key === "ArrowUp") row = Math.max(region.top, row - 1);
        else if (event.key === "ArrowDown")
          row = Math.min(region.bottom, row + 1);
        else if (event.key === "ArrowLeft")
          col = Math.max(region.left, col - 1);
        else if (event.key === "ArrowRight")
          col = Math.min(region.right, col + 1);
        else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onPlay(keyboardPoint.current);
          return;
        } else return;
        event.preventDefault();
        keyboardPoint.current = row * size + col;
        setPreview.current(keyboardPoint.current);
      }}
    >
      {error && (
        <p className="renderer-error">
          The board needs WebGL. Please enable hardware acceleration and reload.
        </p>
      )}
      {!ready && !error && (
        <p className="renderer-error">Preparing the board…</p>
      )}
      <span className="sr-only" aria-live={focused ? "polite" : "off"}>
        {coordinate(keyboardPoint.current, size)}
      </span>
    </div>
  );
}
