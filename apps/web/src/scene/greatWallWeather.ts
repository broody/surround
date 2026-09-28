const TAU = Math.PI * 2;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};

// The same breeze drives the boughs. Nothing reads wall
// time, so the shared scene pause freezes every layer at its current pose.
export function wallBreeze(time: number) {
  return Math.sin(time * 0.61) * 0.7 + Math.sin(time * 1.17 + 0.8) * 0.3;
}

export function wallTreeBend(reach: number, time: number, phase: number, amplitude: number) {
  const tip = clamp(reach);
  return tip * tip * amplitude * (
    wallBreeze(time - phase * 0.3) * 0.65 +
    Math.sin(time * 1.52 + phase + tip * 2) * 0.35
  );
}

export function wallCloudDrift(layer: number, time: number) {
  return {
    x: Math.sin(time * (layer === 0 ? 0.026 : 0.038)) * (layer === 0 ? 48 : 62),
    y: Math.sin(time * 0.047 + layer) * 1.3,
  };
}

export type AutumnLeaf = {
  x: number;
  y: number;
  fall: number;
  travel: number;
  phase: number;
  duration: number;
  size: number;
  color: number;
  near: boolean;
};

export function createAutumnLeaves(): AutumnLeaf[] {
  let seed = 270927;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 44 }, (_, index) => {
    const near = index < 26;
    const left = index % 3 !== 0;
    return {
      x: left ? 20 + random() * 370 : 1270 + random() * 365,
      y: near ? (left ? 70 + random() * 385 : 460 + random() * 130) : 350 + random() * 200,
      fall: near ? 310 + random() * 230 : 145 + random() * 140,
      travel: near ? 185 + random() * 280 : 70 + random() * 105,
      phase: random(),
      duration: near ? 22 + random() * 18 : 32 + random() * 20,
      size: near ? 3 + Math.floor(random() * 3) : 2,
      color: index % 4,
      near,
    };
  });
}

export function autumnLeafPosition(leaf: AutumnLeaf, time: number) {
  const p = ((leaf.phase + time / leaf.duration) % 1 + 1) % 1;
  const flutter = time * 1.8 + leaf.phase * TAU;
  return {
    x: leaf.x + p * leaf.travel + Math.sin(p * TAU * 1.5 + leaf.phase * TAU) * 23,
    y: leaf.y + p * leaf.fall + Math.sin(p * TAU * 2 + leaf.phase * TAU) * 9,
    angle: time * (leaf.near ? 0.9 : 0.6) + Math.sin(flutter) * 0.5 + leaf.phase * TAU,
    width: 0.25 + Math.abs(Math.cos(flutter)) * 0.75,
    opacity: smooth(p / 0.12) * smooth((1 - p) / 0.16) * (leaf.near ? 0.86 : 0.48),
  };
}
