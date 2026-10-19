import { levelName, type BoardSize } from "../../../../shared/lobby.ts";

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

/** A level such as "20 kyu" as a large number over a small unit; "Pro" stands
 * alone. */
export function RankBadge({ rank }: { rank: string }) {
  const [value, unit] = levelName(rank).split(" ");
  return (
    <span className="character-rank">
      <strong>{value}</strong>
      {unit && ` ${unit}`}
    </span>
  );
}
