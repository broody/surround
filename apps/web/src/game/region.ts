import { SIZE } from "./rules.ts";

/** Inclusive column and row bounds of a rectangular window onto the board. */
export type BoardRegion = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

// BoardCanvas draws a 19×19 board in a 600-unit square: intersections start
// MARGIN in from the frame and sit STEP apart. Smaller boards keep the same
// spacing and shrink the square.
export const EDGE = 600;
export const MARGIN = 48;
export const STEP = 28;
// A cropped side keeps just enough wood for its coordinates.
const CROP_PAD = 26;

/** The side of the square a whole board of `size` lines is drawn in. */
export const boardEdge = (size: number) => MARGIN * 2 + (size - 1) * STEP;

export const fullBoard = (size = SIZE): BoardRegion => ({
  left: 0,
  top: 0,
  right: size - 1,
  bottom: size - 1,
});

export const isFullBoard = (region: BoardRegion, size = SIZE) =>
  region.left === 0 &&
  region.top === 0 &&
  region.right === size - 1 &&
  region.bottom === size - 1;

/**
 * Frames the given points with `margin` lines of breathing room and at least
 * `minSpan` lines per axis. When only one line would be left between the frame
 * and a board edge, the edge is included so corner and side problems read as
 * such instead of floating one line short of it.
 */
export function focusRegion(
  points: Iterable<number>,
  size = SIZE,
  margin = 2,
  minSpan = 9,
): BoardRegion {
  const cols: number[] = [];
  const rows: number[] = [];
  for (const point of points) {
    cols.push(point % size);
    rows.push(Math.floor(point / size));
  }
  if (!cols.length) return fullBoard(size);
  const [left, right] = span(cols, size, margin, minSpan);
  const [top, bottom] = span(rows, size, margin, minSpan);
  return { left, top, right, bottom };
}

function span(values: number[], size: number, margin: number, minSpan: number) {
  const target = Math.min(minSpan, size);
  let lo = Math.max(0, Math.min(...values) - margin);
  let hi = Math.min(size - 1, Math.max(...values) + margin);
  while (hi - lo + 1 < target) {
    if (lo > 0) lo--;
    if (hi - lo + 1 < target && hi < size - 1) hi++;
  }
  if (lo === 1) lo = 0;
  if (hi === size - 2) hi = size - 1;
  return [lo, hi] as const;
}

/** The part of the board drawing that shows `region`. */
export function viewport(region: BoardRegion, size = SIZE) {
  const pad = (edge: boolean) => (edge ? MARGIN : CROP_PAD);
  const x = MARGIN + region.left * STEP - pad(region.left === 0);
  const y = MARGIN + region.top * STEP - pad(region.top === 0);
  const right = MARGIN + region.right * STEP + pad(region.right === size - 1);
  const bottom =
    MARGIN + region.bottom * STEP + pad(region.bottom === size - 1);
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Where an intersection lands on a board rendered for `region`, as fractions
 * of its width and height, with the line spacing as a fraction of its width.
 * Lets HTML overlays line up with the canvas at any size.
 */
export function placement(region: BoardRegion, point: number, size = SIZE) {
  const view = viewport(region, size);
  return {
    x: (MARGIN + (point % size) * STEP - view.x) / view.width,
    y: (MARGIN + Math.floor(point / size) * STEP - view.y) / view.height,
    step: STEP / view.width,
  };
}

export const regionContains = (
  region: BoardRegion,
  point: number,
  size = SIZE,
) => {
  const col = point % size;
  const row = Math.floor(point / size);
  return (
    col >= region.left &&
    col <= region.right &&
    row >= region.top &&
    row <= region.bottom
  );
};
