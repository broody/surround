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
import { boardSize, coordinate, type Position } from "./rules";
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

function stoneTexture(white: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const colors = white
    ? ["#a3977d", "#c1bbaa", "#e0ddcf", "#efeee3", "#fffdf2"]
    : ["#080d15", "#131c28", "#202c3b", "#34404d", "#637080"];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5);
      if (d > 13.2) continue;
      const highlight = Math.hypot(x - 11, y - 10);
      const shade =
        d > 12.1
          ? 0
          : highlight < 4.2
            ? 4
            : highlight < 8.2
              ? 3
              : highlight < 15
                ? 2
                : 1;
      ctx.fillStyle = colors[shade];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
}

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
    const textures: Texture[] = [];
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
      textures.push(stoneTexture(false), stoneTexture(true));
      const stones = new Container();
      const marks = new Container();
      const preview = new Container();
      app.stage.addChild(stones, marks, preview);
      const sizeNow = () => boardSize(latest.current.position.board);
      let laidOutSize = 0;
      let scale = 1;
      let hovered: number | null = null;
      let previousMoveCount = latest.current.position.moves.length;
      const renderPreview = () => {
        preview.removeChildren().forEach((child) => child.destroy());
        const { position, readOnly, previewPoint } = latest.current;
        const point = readOnly ? (previewPoint ?? null) : hovered;
        if (point !== null && !position.board[point] && !position.paused) {
          const ghost = new Sprite(textures[position.turn - 1]);
          ghost.anchor.set(0.5);
          ghost.position.set(
            MARGIN + (point % laidOutSize) * STEP + 0.5,
            MARGIN + Math.floor(point / laidOutSize) * STEP + 0.5,
          );
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
        const { position, coordinates, readOnly, dead } = latest.current;
        const size = laidOutSize;
        app.stage.eventMode = readOnly ? "none" : "static";
        labels.visible = coordinates;
        stones.removeChildren().forEach((child) => child.destroy());
        let animated: Sprite | null = null;
        const last = position.moves.at(-1)?.point;
        const shadow = new Graphics();
        stones.addChild(shadow);
        position.board.forEach((color, point) => {
          if (!color) return;
          const x = MARGIN + (point % size) * STEP + 0.5;
          const y = MARGIN + Math.floor(point / size) * STEP + 0.5;
          const isDead = dead?.has(point);
          if (!isDead)
            shadow
              .ellipse(x + 1, y + 4, 12, 10)
              .fill({ color: 0x42301d, alpha: 0.3 });
          const stone = new Sprite(textures[color - 1]);
          stone.anchor.set(0.5);
          stone.position.set(x, y);
          if (isDead) stone.alpha = 0.4;
          stones.addChild(stone);
          if (point === last && !latest.current.readOnly) {
            // A teaching mark on the stone already draws the eye there.
            if (!latest.current.marks?.some((mark) => mark.point === point))
              stones.addChild(
                new Graphics().rect(x - 3, y - 3, 6, 6).stroke({
                  color: color === 1 ? 0xeedba6 : 0x555e66,
                  width: 1.5,
                }),
              );
            if (
              position.moves.length > previousMoveCount &&
              !window.matchMedia("(prefers-reduced-motion: reduce)").matches
            )
              animated = stone;
          }
        });
        previousMoveCount = position.moves.length;
        marks.removeChildren().forEach((child) => child.destroy());
        for (const mark of latest.current.marks ?? []) {
          const x = MARGIN + (mark.point % size) * STEP + 0.5;
          const y = MARGIN + Math.floor(mark.point / size) * STEP + 0.5;
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
        renderPreview();
        app.render();
        if (animated) {
          const target: Sprite = animated;
          const start = performance.now();
          const tick = () => {
            if (disposed) return;
            const t = Math.min(1, (performance.now() - start) / 140);
            target.scale.set(1 + (1 - t) * 0.18);
            target.alpha = 0.6 + t * 0.4;
            app.render();
            if (t < 1) animation = requestAnimationFrame(tick);
          };
          animation = requestAnimationFrame(tick);
        }
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
      textures.forEach((texture) => texture.destroy(true));
    };
  }, []);

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
