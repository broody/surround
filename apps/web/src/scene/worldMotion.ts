import type { CloudDepth } from "./worldCloudLayers";

export type WorldId = "venice" | "taj" | "santorini" | "petra" | "patagonia";
export const WORLD_IDS: WorldId[] = ["venice", "taj", "santorini", "petra", "patagonia"];
const TAU = Math.PI * 2;
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export function smooth01(x: number) {
  const p = clamp01(x);
  return p * p * (3 - 2 * p);
}

export const WORLD_CLOUD_MARGIN = 64;
export const WORLD_CLOUD_WIDTH = 1672 + WORLD_CLOUD_MARGIN * 2;
const CLOUD_SPEED: Record<WorldId, number> = {
  venice: 1.05, taj: 0.85, santorini: 1.2, petra: 0.75, patagonia: 1.5,
};
export const CLOUD_PARALLAX: Record<CloudDepth, number> = { far: 0.32, middle: 0.65, near: 1 };

// Steady wind, not a sine-wave shuttle that stops and reverses direction.
// The neighboring copies exchange places invisibly at each full-width wrap.
export function worldCloudDrift(id: WorldId, time: number, depth: CloudDepth = "near") {
  const parallax = CLOUD_PARALLAX[depth];
  return {
    x: ((time * CLOUD_SPEED[id] * parallax) % WORLD_CLOUD_WIDTH + WORLD_CLOUD_WIDTH) % WORLD_CLOUD_WIDTH,
    y: Math.sin(time * 0.039) * 1.5 * parallax,
  };
}

export function worldCloudCopies(id: WorldId, time: number, depth: CloudDepth = "near") {
  const drift = worldCloudDrift(id, time, depth);
  const x = drift.x - WORLD_CLOUD_MARGIN;
  return [x - WORLD_CLOUD_WIDTH, x, x + WORLD_CLOUD_WIDTH]
    .filter(left => left < 1672 && left + WORLD_CLOUD_WIDTH > 0)
    .map(left => ({ x: left, y: drift.y }));
}

export function worldBranchBend(reach: number, time: number, phase: number, amplitude: number) {
  const tip = clamp01(reach);
  return tip * tip * amplitude * (
    Math.sin(time * 0.71 + phase + tip) * 0.72 +
    Math.sin(time * 1.47 + phase * 1.8 + tip * 2.1) * 0.28
  );
}

export function worldRipple(depth: number, row: number, time: number, amplitude: number) {
  const edge = smooth01(depth * 9) * smooth01((1 - depth) * 9);
  return edge * amplitude * (0.35 + clamp01(depth) * 0.65) * (
    Math.sin(row * 0.2 - time * 1.16) * 0.7 +
    Math.sin(row * 0.071 + time * 0.73) * 0.3
  );
}

export function worldGlint(row: number, time: number, strength: number) {
  return (0.5 + Math.sin(row * 0.23 - time * 0.94) * 0.5) ** 4 * strength;
}

export function worldLight(time: number, phase: number) {
  return 0.08 + (0.5 + Math.sin(time * 0.87 + phase) * 0.5) * 0.1 +
    (0.5 + Math.sin(time * 2.1 + phase * 1.3) * 0.5) * 0.025;
}

export function worldStar(time: number, phase: number) {
  return 0.12 + (0.5 + Math.sin(time * 0.89 + phase) * 0.5) ** 3 * 0.52;
}

export function sailboatPose(time: number) {
  return { x: Math.sin(time * 0.012) * 95, y: Math.sin(time * 0.9) * 0.65 };
}

export type WorldParticle = {
  x: number; y: number; phase: number; duration: number;
  size: number; travel: number; lift: number;
};
export type ParticleArea = readonly [number, number, number, number];

export function createWorldParticles(id: WorldId, areas: readonly ParticleArea[], count: number): WorldParticle[] {
  let seed = 281003 + WORLD_IDS.indexOf(id) * 137;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: count }, (_, i) => {
    const [x, y, w, h] = areas[i % areas.length];
    return {
      x: x + random() * w, y: y + random() * h,
      phase: random(), duration: 22 + random() * 27,
      size: i % 5 === 0 ? 3 : 2,
      travel: 45 + random() * 100,
      lift: id === "patagonia" ? -90 - random() * 100 : 20 + random() * 75,
    };
  });
}

export function worldParticlePosition(particle: WorldParticle, time: number) {
  const p = ((particle.phase + time / particle.duration) % 1 + 1) % 1;
  return {
    x: particle.x + p * particle.travel + Math.sin(p * TAU + particle.phase * TAU) * 9,
    y: particle.y - p * particle.lift + Math.sin(p * TAU * 1.5) * 5,
    opacity: smooth01(p / 0.16) * smooth01((1 - p) / 0.2) * 0.58,
    turn: Math.cos(time * 1.8 + particle.phase * TAU),
  };
}
