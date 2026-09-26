export type Petal = {
  x: number;
  y: number;
  speed: number;
  sway: number;
  phase: number;
  size: number;
  depth: number;
};

const wrap = (value: number, length: number) =>
  ((value % length) + length) % length;

export function createPetals(): Petal[] {
  let seed = 24091;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 48 }, (_, index) => {
    const depth = index < 28 ? 0 : 1;
    return {
      x: random() * 1672,
      y: random() * 690,
      speed: 7 + random() * 7 + depth * 7,
      sway: 9 + random() * 23,
      phase: random() * Math.PI * 2,
      size: depth ? 4 : 2,
      depth,
    };
  });
}

export function petalPosition(petal: Petal, time: number) {
  const y = wrap(petal.y + time * petal.speed, 690) + 40;
  return {
    x: Math.round(
      wrap(
        petal.x + time * (4 + petal.depth * 2) +
          Math.sin(time * 0.62 + petal.phase) * petal.sway,
        1740,
      ) - 34,
    ),
    y: Math.round(y),
    width: Math.max(1, Math.round(petal.size * Math.abs(Math.cos(time * 1.2 + petal.phase)))),
    opacity: (0.45 + petal.depth * 0.25) *
      Math.max(0, Math.min(1, (y - 40) / 50, (730 - y) / 65)),
  };
}

// Incommensurate, slow cycles stay bounded without a visible wrap/reset.
export function cloudDrift(time: number, depth: number) {
  return {
    x: Math.sin(time * (0.023 + depth * 0.011) + depth * 1.8) * (26 + depth * 10),
    y: Math.sin(time * 0.041 + depth * 2.1) * (1 + depth),
  };
}

export function pavilionLightLevel(time: number, phase: number) {
  return 0.5 + Math.sin(time * 0.49 + phase) * 0.38 +
    Math.sin(time * 0.93 + phase * 1.7) * 0.08;
}
