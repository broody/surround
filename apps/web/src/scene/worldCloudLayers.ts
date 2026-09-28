import type { WorldId } from "./worldMotion";

export type CloudDepth = "far" | "middle" | "near";
export const CLOUD_DEPTHS: CloudDepth[] = ["far", "middle", "near"];

// Source-image rows, not screen coordinates. Small lower wisps approach the
// horizon; the upper, larger banks sit closer to the viewer in these paintings.
const DEPTH_ROWS: Record<WorldId, readonly [number, number]> = {
  venice: [120, 265], taj: [110, 185], santorini: [170, 225],
  petra: [90, 170], patagonia: [150, 230],
};

export function cloudDepthAt(id: WorldId, row: number): CloudDepth {
  const [near, middle] = DEPTH_ROWS[id];
  return row < near ? "near" : row < middle ? "middle" : "far";
}

// Assign complete connected cloud silhouettes to a plane. This is done once
// when the scene loads, not per frame. Unlike horizontal slices, a bank spanning
// a depth boundary stays intact as the different planes pass one another.
export function splitWorldClouds(id: WorldId, width: number, height: number, rgba: Uint8ClampedArray) {
  const count = width * height;
  if (rgba.length !== count * 4) throw new Error("Cloud pixel dimensions do not match");
  const labels = new Uint8Array(count).fill(255);
  const visited = new Uint8Array(count);
  const queue = new Uint32Array(count);
  const solid = (p: number) => rgba[p * 4 + 3] >= 16;

  for (let start = 0; start < count; start++) {
    if (visited[start] || !solid(start)) continue;
    let head = 0, tail = 1, weight = 0, rows = 0;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      const alpha = rgba[p * 4 + 3];
      weight += alpha;
      rows += y * alpha;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const n = ny * width + nx;
        if (!visited[n] && solid(n)) { visited[n] = 1; queue[tail++] = n; }
      }
    }
    const depth = CLOUD_DEPTHS.indexOf(cloudDepthAt(id, rows / weight));
    for (let i = 0; i < tail; i++) labels[queue[i]] = depth;
  }

  const planes = CLOUD_DEPTHS.map(depth => ({ depth, pixels: new Uint8ClampedArray(rgba.length) }));
  for (let p = 0; p < count; p++) {
    if (!rgba[p * 4 + 3]) continue;
    let depth = labels[p];
    if (depth === 255) {
      // Retain delicate low-alpha fringe with the nearest strong silhouette.
      const x = p % width, y = Math.floor(p / width);
      search: for (let r = 1; r <= 3; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const label = labels[ny * width + nx];
          if (label !== 255) { depth = label; break search; }
        }
      }
      if (depth === 255) depth = CLOUD_DEPTHS.indexOf(cloudDepthAt(id, y));
    }
    planes[depth].pixels.set(rgba.subarray(p * 4, p * 4 + 4), p * 4);
  }
  return planes;
}
