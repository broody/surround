import type { HTMLAttributes, ReactNode } from "react";
import { classNames, Panel } from "../components/ui";
import type { BoardSize } from "../../../../shared/lobby.ts";
export type Presence = "online" | "playing" | "away";

export function LobbyPanel({
  title,
  subtitle,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const id = `lobby-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <Panel
      aria-labelledby={id}
      className={classNames("lobby-panel flex flex-col", className)}
      {...props}
    >
      <span className="lobby-corner tl" aria-hidden="true" />
      <span className="lobby-corner tr" aria-hidden="true" />
      <span className="lobby-corner bl" aria-hidden="true" />
      <span className="lobby-corner br" aria-hidden="true" />
      <header className="text-center">
        <h2 id={id} className="lobby-panel-title">
          {title}
        </h2>
        <Ornament />
        <p className="lobby-panel-subtitle">{subtitle}</p>
      </header>
      {children}
    </Panel>
  );
}

export function Ornament({ className }: { className?: string }) {
  return (
    <span
      className={classNames("lobby-ornament", className)}
      aria-hidden="true"
    >
      <i />
    </span>
  );
}

// A few grid lines and stones, crisp at small sizes; more lines for bigger
// boards so the three choices read differently at a glance.
const GLYPH_LINES: Record<BoardSize, number> = { 9: 4, 13: 5, 19: 7 };
const GLYPH_STONES: Record<BoardSize, [number, number, "b" | "w"][]> = {
  9: [[2, 1, "w"]],
  13: [
    [3, 1, "w"],
    [2, 3, "b"],
  ],
  19: [
    [1, 2, "w"],
    [2, 4, "w"],
    [4, 2, "b"],
    [5, 5, "b"],
  ],
};

export function BoardGlyph({ size }: { size: BoardSize }) {
  const lines = GLYPH_LINES[size];
  const step = 30 / (lines - 1);
  const at = (n: number) => 5 + n * step;
  return (
    <svg
      className="lobby-board-glyph"
      viewBox="0 0 40 40"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <rect x="1" y="1" width="38" height="38" className="board" />
      {Array.from({ length: lines }, (_, n) => (
        <g key={n} className="line">
          <line x1={at(n)} y1="5" x2={at(n)} y2="35" />
          <line x1="5" y1={at(n)} x2="35" y2={at(n)} />
        </g>
      ))}
      {GLYPH_STONES[size].map(([x, y, color]) => (
        <circle
          key={`${x}-${y}`}
          cx={at(Math.min(x, lines - 1))}
          cy={at(Math.min(y, lines - 1))}
          r={Math.min(3.4, step * 0.42)}
          className={color === "b" ? "black" : "white"}
          shapeRendering="auto"
        />
      ))}
    </svg>
  );
}

export function Avatar({
  src,
  presence,
  className,
}: {
  src: string;
  presence?: Presence;
  className?: string;
}) {
  return (
    <span className={classNames("lobby-avatar", className)}>
      <img src={src} alt="" loading="lazy" />
      {presence && <PresenceDot presence={presence} />}
    </span>
  );
}

export const PRESENCE_LABEL: Record<Presence, string> = {
  online: "Online",
  playing: "In a game",
  away: "Away",
};

export function PresenceDot({ presence }: { presence: Presence }) {
  return (
    <i className={classNames("lobby-presence", presence)} aria-hidden="true" />
  );
}
