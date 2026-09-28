import { BLACK_HOLE } from "./eventideMotion.ts";

const INNER_RADIUS = 92;
export const LENS_RADIUS = 285;
const STRIDE = 11;
const smooth = (n: number) => {
  const t = Math.max(0, Math.min(1, n));
  return t * t * (3 - 2 * t);
};

// Inverse texture mapping: each destination pixel looks up one source pixel.
// Two broad travelling waves bend the rim; the core and distant sky are fixed.
function coefficients(x: number, y: number) {
  const dx = x - BLACK_HOLE.x,
    dy = y - BLACK_HOLE.y;
  const radius = Math.hypot(dx, dy);
  if (radius <= INNER_RADIUS || radius >= LENS_RADIUS) return null;
  const weight =
    smooth((radius - INNER_RADIUS) / (BLACK_HOLE.radius - INNER_RADIUS)) *
    (1 - smooth((radius - 180) / (LENS_RADIUS - 180)));
  const angle = Math.atan2(dy, dx);
  const a = angle * 2 + (radius - BLACK_HOLE.radius) * 0.012;
  const b = angle * 3 - (radius - BLACK_HOLE.radius) * 0.009;
  const rx = (dx / radius) * weight,
    ry = (dy / radius) * weight;
  const sa = Math.sin(a),
    ca = Math.cos(a),
    sb = Math.sin(b),
    cb = Math.cos(b);
  return [
    rx * 6 * sa - ry * 2.6 * ca,
    -rx * 6 * ca - ry * 2.6 * sa,
    rx * 2 * sb,
    rx * 2 * cb,
    ry * 6 * sa + rx * 2.6 * ca,
    -ry * 6 * ca + rx * 2.6 * sa,
    ry * 2 * sb,
    ry * 2 * cb,
  ];
}

function phase(time: number) {
  return [
    Math.cos(time * 0.28),
    Math.sin(time * 0.28),
    Math.cos(time * 0.43),
    Math.sin(time * 0.43),
  ];
}

export function horizonSourcePoint(x: number, y: number, time: number) {
  const c = coefficients(x, y);
  if (!c) return { x, y };
  const p = phase(time);
  return {
    x: x + c[0] * p[0] + c[1] * p[1] + c[2] * p[2] + c[3] * p[3],
    y: y + c[4] * p[0] + c[5] * p[1] + c[6] * p[2] + c[7] * p[3],
  };
}

// Keep small moving highlights registered to the same warped source pixels.
export function horizonDestinationPoint(x: number, y: number, time: number) {
  let point = { x, y };
  for (let i = 0; i < 4; i++) {
    const source = horizonSourcePoint(point.x, point.y, time);
    point = { x: point.x + x - source.x, y: point.y + y - source.y };
  }
  return point;
}

export function createHorizonWarp(
  source: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const x = Math.max(0, BLACK_HOLE.x - LENS_RADIUS);
  const y = Math.max(0, BLACK_HOLE.y - LENS_RADIUS);
  const w = Math.min(width - 1, BLACK_HOLE.x + LENS_RADIUS) - x + 1;
  const h = Math.min(height - 1, BLACK_HOLE.y + LENS_RADIUS) - y + 1;
  // Packed coefficients are prepared once: no pixel readback, per-pixel trig,
  // allocations, or full-screen resampling in the frame loop.
  const cells = new Float32Array(w * h * STRIDE);
  let length = 0;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const c = coefficients(x + px, y + py);
      if (!c) continue;
      cells.set([x + px, y + py, (py * w + px) * 4, ...c], length);
      length += STRIDE;
    }
  }
  return {
    x,
    y,
    width: w,
    height: h,
    paint(
      output: Uint8ClampedArray,
      shade: Uint8ClampedArray,
      shadeWidth: number,
      time: number,
    ) {
      const [a, b, c, d] = phase(time);
      for (let i = 0; i < length; i += STRIDE) {
        const sx = Math.max(
          0,
          Math.min(
            width - 1,
            Math.round(
              cells[i] +
                cells[i + 3] * a +
                cells[i + 4] * b +
                cells[i + 5] * c +
                cells[i + 6] * d,
            ),
          ),
        );
        const sy = Math.max(
          0,
          Math.min(
            height - 1,
            Math.round(
              cells[i + 1] +
                cells[i + 7] * a +
                cells[i + 8] * b +
                cells[i + 9] * c +
                cells[i + 10] * d,
            ),
          ),
        );
        const from = (sy * width + sx) * 4;
        const to = cells[i + 2];
        // The existing half-resolution illumination travels with the artwork.
        const light =
          1 - shade[((sy >> 1) * shadeWidth + (sx >> 1)) * 4 + 3] / 255;
        output[to] = source[from] * light;
        output[to + 1] = source[from + 1] * light;
        output[to + 2] = source[from + 2] * light;
        output[to + 3] = 255;
      }
    },
  };
}
