// One docs diagram on the game's own board, for render.ts to photograph. The
// diagram comes in the query: ?d={"rows":[...],"size":200}.
import { createRoot } from "react-dom/client";
import BoardCanvas, { type BoardMark } from "../../src/game/BoardCanvas";
import type { BoardRegion } from "../../src/game/region";
import type { Position, Stone } from "../../src/game/rules";

/**
 * Rows of characters, one per point (as apps/docs writes them):
 *   .  empty           X  black stone       O  white stone
 *   x  dead black      o  dead white        (faded, in the other's area)
 *   b  black's area    w  white's area      (a small square)
 *   *  a marked point (a liberty, or the point a move is played on)
 *   1–9 a numbered black stone, A–I a numbered white stone (A = 1)
 */
function diagram(rows: string[]) {
  const grid = rows.map((row) => row.replace(/\s+/g, "").split(""));
  const size = grid.length;
  const board: Stone[] = [];
  const marks: BoardMark[] = [];
  const dead = new Set<number>();
  grid.forEach((row, y) =>
    row.forEach((c, x) => {
      const point = y * size + x;
      const black = c === "X" || c === "x" || /[1-9]/.test(c);
      const white = c === "O" || c === "o" || /[A-I]/.test(c);
      board.push(black ? 1 : white ? 2 : 0);
      if (c === "x" || c === "o") {
        // A dead stone's point is its captor's area.
        dead.add(point);
        marks.push({ point, kind: "area", color: c === "x" ? 2 : 1 });
      } else if (/[1-9]/.test(c)) marks.push({ point, kind: "label", text: c });
      else if (/[A-I]/.test(c))
        marks.push({
          point,
          kind: "label",
          text: String(c.charCodeAt(0) - 64),
        });
      else if (c === "b" || c === "w")
        marks.push({ point, kind: "area", color: c === "b" ? 1 : 2 });
      else if (c === "*") marks.push({ point, kind: "circle" });
    }),
  );
  const position: Position = {
    board,
    turn: 1,
    captures: [0, 0],
    moves: [],
    hashes: [board.join("")],
    passes: 0,
    paused: false,
  };
  // Zoomed in on what the diagram is about; a diagram that fills the board
  // shows all of it.
  const shown = board.flatMap((stone, point) =>
    stone || marks.some((mark) => mark.point === point) ? [point] : [],
  );
  return { position, marks, dead, region: square(shown, size) };
}

/** A square window on `points`, one line around them and at least five
 * across, centered on them as far as the board's edges allow. */
function square(points: number[], size: number): BoardRegion {
  const bounds = (values: number[]) =>
    values.length
      ? [Math.min(...values) - 1, Math.max(...values) + 1]
      : [0, size - 1];
  const [left, right] = bounds(points.map((point) => point % size));
  const [top, bottom] = bounds(points.map((point) => Math.floor(point / size)));
  const span = Math.min(
    size,
    Math.max(5, right - left + 1, bottom - top + 1),
  );
  const fit = (lo: number, hi: number) => {
    const start = Math.round((lo + hi + 1 - span) / 2);
    const at = Math.max(0, Math.min(size - span, start));
    return [at, at + span - 1];
  };
  const [x0, x1] = fit(left, right);
  const [y0, y1] = fit(top, bottom);
  return { left: x0, top: y0, right: x1, bottom: y1 };
}

const { rows, size } = JSON.parse(
  new URLSearchParams(location.search).get("d") ?? "{}",
) as { rows: string[]; size: number };
const { position, marks, dead, region } = diagram(rows);
const noop = () => {};

createRoot(document.getElementById("root")!).render(
  <div style={{ width: size }}>
    <BoardCanvas
      position={position}
      marks={marks}
      dead={dead}
      region={region}
      coordinates={false}
      readOnly
      onPlay={noop}
      onHover={noop}
    />
  </div>,
);
