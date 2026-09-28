const TAU = Math.PI * 2;
const wrap = (n: number) => ((n % 1) + 1) % 1;

export const BLACK_HOLE = { x: 892, y: 249, radius: 164 };

// Separate periods and phases make the islands feel suspended, not synchronised.
export function islandPose(index: number, time: number) {
  const phase = index * 2.17;
  return {
    x: Math.sin(time * 0.14 + phase) * (1.5 + index * 0.3),
    y: Math.sin(time * (0.24 - index * 0.018) + phase) * (3.5 + index * 0.6),
    angle: Math.sin(time * 0.11 + phase) * 0.004,
  };
}

export function accretionPhase(x: number, y: number) {
  const diskHeight = y - (250 + (x - 835) * 0.085);
  return Math.abs(diskHeight) < 78
    ? x * 0.018 + diskHeight * 0.24
    : Math.atan2(y - BLACK_HOLE.y, x - BLACK_HOLE.x) * 5 +
        Math.hypot(x - BLACK_HOLE.x, y - BLACK_HOLE.y) * 0.12;
}

export function flowShade(phase: number, time: number) {
  return (
    0.05 +
    (0.5 + Math.sin(phase - time * 0.72) * 0.5) * 0.12 +
    (0.5 + Math.sin(phase * 2.7 - time * 1.05) * 0.5) * 0.035
  );
}

export function filamentPoint(index: number, time: number, tail = 0) {
  const angle =
    index * 2.399 + time * (0.03 + (index % 4) * 0.003) - tail * 0.007;
  if (index < 12) {
    const radius = 180 + ((index * 17) % 70);
    return {
      x: BLACK_HOLE.x + Math.cos(angle) * radius,
      y: BLACK_HOLE.y + Math.sin(angle) * radius,
    };
  }
  const radius = 380 + ((index * 83) % 390);
  const x = 840 + Math.cos(angle) * radius;
  return {
    x,
    y: 252 + (x - 835) * 0.085 + Math.sin(angle) * (42 + (index % 4) * 9),
  };
}

export function eventideStarPulse(index: number, time: number) {
  return Math.sin((time * TAU) / (5.5 + (index % 8)) + index * 2.399) * 0.5;
}

export function terraceLight(index: number, time: number) {
  return 0.57 + Math.sin(time * 0.46 - index * 0.85) * 0.27;
}

export function floorShimmer(x: number, time: number) {
  return 0.1 + Math.sin(time * 0.4 - x * 0.008) * 0.075;
}

export type CelestialMote = {
  x: number;
  y: number;
  phase: number;
  duration: number;
  size: number;
  amber: boolean;
};

export function createCelestialMotes(): CelestialMote[] {
  let seed = 920267;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 48 }, (_, i) => ({
    x: 170 + random() * 1330,
    y: 680 + random() * 245,
    phase: random(),
    duration: 19 + random() * 20,
    size: i % 7 === 0 ? 3 : 2,
    amber: i % 3 !== 0,
  }));
}

export function celestialMotePosition(mote: CelestialMote, time: number) {
  const progress = wrap(mote.phase + time / mote.duration);
  return {
    x: mote.x + Math.sin(progress * TAU + mote.phase * TAU) * 18,
    y: mote.y - progress * 125,
    opacity: Math.sin(progress * Math.PI) ** 2 * 0.66,
  };
}
