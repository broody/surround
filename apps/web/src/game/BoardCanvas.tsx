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
import { coordinate, SIZE, type Position } from "./rules";

const EDGE = 600;
const MARGIN = 48;
const STEP = 28;

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
  onPlay: (point: number) => void;
  onHover: (point: number | null) => void;
};

export default function BoardCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const repaint = useRef<() => void>(() => {});
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
        app.destroy(true, { children: true });
        return;
      }
      app.canvas.setAttribute("aria-hidden", "true");
      parent.appendChild(app.canvas);

      const board = new Graphics();
      board.rect(0, 0, EDGE, EDGE).fill(0x483424);
      board.rect(3, 3, 594, 594).fill(0xb08443);
      board.rect(6, 6, 588, 588).fill(0xecd094);
      board.rect(8, 8, 584, 584).fill(0xc5934c);
      board.rect(12, 12, 576, 576).fill(0xd6ac65);
      let seed = 913;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      for (let i = 0; i < 850; i++) {
        const x = 13 + Math.floor(rand() * 574);
        const y = 13 + Math.floor(rand() * 574);
        const width = Math.min(588 - x, 6 + Math.floor(rand() * 90));
        board.rect(x, y, width, 1).fill({
          color: i % 3 ? 0x91612f : 0xffe7aa,
          alpha: i % 3 ? 0.055 : 0.13,
        });
      }
      board
        .rect(20, 20, 560, 560)
        .stroke({ color: 0x79552b, width: 1, alpha: 0.28 });
      app.stage.addChild(board);
      const grid = new Graphics();
      app.stage.addChild(grid);
      const labels = new Container();
      const label = (text: string, x: number, y: number) => {
        const node = new Text({
          text,
          style: {
            fontFamily: "IBM Plex Mono, monospace",
            fontSize: 12,
            fill: 0x725630,
          },
        });
        node.anchor.set(0.5);
        node.position.set(x, y);
        labels.addChild(node);
      };
      for (let i = 0; i < SIZE; i++) {
        label("ABCDEFGHJKLMNOPQRST"[i], MARGIN + i * STEP, 30);
        label(String(SIZE - i), 29, MARGIN + i * STEP);
        label("ABCDEFGHJKLMNOPQRST"[i], MARGIN + i * STEP, 572);
        label(String(SIZE - i), 572, MARGIN + i * STEP);
      }
      app.stage.addChild(labels);
      textures.push(stoneTexture(false), stoneTexture(true));
      const stones = new Container();
      const preview = new Container();
      app.stage.addChild(stones, preview);
      let hovered: number | null = null;
      let previousMoveCount = latest.current.position.moves.length;
      const renderPreview = () => {
        preview.removeChildren().forEach((child) => child.destroy());
        const { position } = latest.current;
        if (
          !latest.current.readOnly &&
          hovered !== null &&
          !position.board[hovered] &&
          !position.paused
        ) {
          const ghost = new Sprite(textures[position.turn - 1]);
          ghost.anchor.set(0.5);
          ghost.position.set(
            MARGIN + (hovered % SIZE) * STEP + 0.5,
            MARGIN + Math.floor(hovered / SIZE) * STEP + 0.5,
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
        cancelAnimationFrame(animation);
        const { position, coordinates } = latest.current;
        labels.visible = coordinates;
        stones.removeChildren().forEach((child) => child.destroy());
        let animated: Sprite | null = null;
        const last = position.moves.at(-1)?.point;
        const shadow = new Graphics();
        stones.addChild(shadow);
        position.board.forEach((color, point) => {
          if (!color) return;
          const x = MARGIN + (point % SIZE) * STEP + 0.5;
          const y = MARGIN + Math.floor(point / SIZE) * STEP + 0.5;
          shadow
            .ellipse(x + 1, y + 4, 12, 10)
            .fill({ color: 0x42301d, alpha: 0.3 });
          const stone = new Sprite(textures[color - 1]);
          stone.anchor.set(0.5);
          stone.position.set(x, y);
          stones.addChild(stone);
          if (point === last && !latest.current.readOnly) {
            const mark = new Graphics()
              .rect(x - 3, y - 3, 6, 6)
              .stroke({ color: color === 1 ? 0xeedba6 : 0x555e66, width: 1.5 });
            stones.addChild(mark);
            if (
              position.moves.length > previousMoveCount &&
              !window.matchMedia("(prefers-reduced-motion: reduce)").matches
            )
              animated = stone;
          }
        });
        previousMoveCount = position.moves.length;
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
      app.stage.eventMode = latest.current.readOnly ? "none" : "static";
      app.stage.hitArea = new Rectangle(0, 0, EDGE, EDGE);
      const pointAt = (x: number, y: number) => {
        const col = Math.round((x - MARGIN) / STEP);
        const row = Math.round((y - MARGIN) / STEP);
        return col >= 0 && col < SIZE && row >= 0 && row < SIZE
          ? row * SIZE + col
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
        const size = Math.max(1, Math.round(parent.clientWidth));
        const scale = size / EDGE;
        app.renderer.resize(size, size);
        app.stage.scale.set(scale);
        // A minimum one-screen-pixel line survives even a narrow phone viewport.
        const thickness = Math.max(1, 1 / scale);
        grid.clear();
        for (let i = 0; i < SIZE; i++) {
          grid
            .rect(MARGIN + i * STEP, MARGIN, thickness, STEP * 18 + thickness)
            .fill({ color: 0x684824, alpha: 0.8 });
          grid
            .rect(MARGIN, MARGIN + i * STEP, STEP * 18 + thickness, thickness)
            .fill({ color: 0x684824, alpha: 0.8 });
        }
        for (const row of [3, 9, 15])
          for (const col of [3, 9, 15]) {
            grid
              .rect(MARGIN + col * STEP - 2, MARGIN + row * STEP - 2, 5, 5)
              .fill(0x523c22);
          }
        repaint.current();
      };
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
      setPreview.current = () => {};
      if (initialized) app.destroy(true, { children: true });
      textures.forEach((texture) => texture.destroy(true));
    };
  }, []);

  useEffect(() => {
    repaint.current();
  }, [props.position, props.coordinates]);

  return (
    <div
      className={`board-canvas${focused ? " keyboard-focus" : ""}`}
      ref={host}
      role={props.readOnly ? "img" : "group"}
      aria-label={
        props.readOnly
          ? "19 by 19 Go board showing an example opening. Stones sit on the grid intersections."
          : `19 by 19 Go board. ${props.position.turn === 1 ? "Black" : "White"} to play. Use arrow keys to select an intersection and Enter to place a stone.`
      }
      aria-describedby={props.readOnly ? undefined : "board-instructions"}
      tabIndex={props.readOnly ? undefined : 0}
      data-readonly={props.readOnly || undefined}
      data-ready={ready}
      onFocus={() => {
        setFocused(true);
        setPreview.current(keyboardPoint.current);
      }}
      onBlur={() => {
        setFocused(false);
        setPreview.current(null);
      }}
      onKeyDown={(event) => {
        if (props.readOnly) return;
        let row = Math.floor(keyboardPoint.current / SIZE);
        let col = keyboardPoint.current % SIZE;
        if (event.key === "ArrowUp") row = Math.max(0, row - 1);
        else if (event.key === "ArrowDown") row = Math.min(18, row + 1);
        else if (event.key === "ArrowLeft") col = Math.max(0, col - 1);
        else if (event.key === "ArrowRight") col = Math.min(18, col + 1);
        else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onPlay(keyboardPoint.current);
          return;
        } else return;
        event.preventDefault();
        keyboardPoint.current = row * SIZE + col;
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
        {coordinate(keyboardPoint.current)}
      </span>
    </div>
  );
}
