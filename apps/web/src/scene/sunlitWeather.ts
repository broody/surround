const TAU = Math.PI * 2;
const wrap = (value: number) => ((value % 1) + 1) % 1;

export function dojoBreeze(time: number, phase = 0) {
  return (
    Math.sin(time * 0.53 + phase) * 0.7 +
    Math.sin(time * 0.21 + phase + 0.8) * 0.3
  );
}

// The bottom of each tree stays attached; only the canopy and branch tips flex.
export function foliageOffset(
  row: number,
  height: number,
  time: number,
  phase: number,
  amplitude: number,
) {
  const reach = Math.max(0, Math.min(1, 1 - row / height));
  if (reach === 0) return 0;
  const flutter = Math.sin(time * 1.37 + reach * 4 + phase) * 0.18;
  return reach * reach * amplitude * (dojoBreeze(time, phase) * 0.82 + flutter);
}

// Slow exposure variation; the original daylight always stays underneath.
export function sunlightLevel(time: number) {
  return (
    0.82 + Math.sin(time * 0.47) * 0.13 + Math.sin(time * 0.23 + 1.1) * 0.04
  );
}

export type DustMote = {
  x: number;
  y: number;
  phase: number;
  speed: number;
  opacity: number;
  size: number;
  drift: number;
};

export function sunbeamStrength(x: number, y: number) {
  const depth = y - 180;
  const distance =
    Math.abs(x - (360 + depth * 0.98)) / (80 + Math.max(0, depth) * 0.24);
  const windowDistance =
    Math.abs(x - (330 + depth * 0.48)) / (90 + Math.max(0, depth) * 0.16);
  return Math.max(
    0,
    1 - distance * distance,
    (1 - windowDistance * windowDistance) * 0.85,
  );
}

export function createDustMotes(): DustMote[] {
  let seed = 18437;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 112 }, (_, index) => {
    const y = 390 + random() * 435;
    const depth = y - 180;
    // Some dust stays near the window, visible beside the board and in portrait.
    const nearWindow = index < 40;
    return {
      x:
        (nearWindow ? 330 + depth * 0.48 : 360 + depth * 0.98) +
        (random() - 0.5) * (nearWindow ? 170 : 250),
      y,
      phase: random(),
      speed: 0.024 + random() * 0.016,
      opacity: 0.66 + random() * 0.32,
      size: index % 7 === 0 ? 4 : index % 3 === 0 ? 3 : 2,
      drift: nearWindow ? 85 : 175,
    };
  });
}

export function dustPosition(mote: DustMote, time: number) {
  const progress = wrap(mote.phase + time * mote.speed);
  const x =
    mote.x +
    Math.sin(time * 0.52 + mote.phase * TAU) * 15 -
    progress * mote.drift;
  const y = mote.y - progress * 210;
  const ramp = Math.min(1, progress / 0.18, (1 - progress) / 0.18);
  const fade = ramp * ramp * (3 - 2 * ramp);
  const glint = 0.78 + Math.sin(time * 0.9 + mote.phase * TAU) * 0.22;
  return {
    x: Math.round(x),
    y: Math.round(y),
    // Fade at both ends before looping; dust is mostly invisible outside a ray.
    opacity: fade * glint * mote.opacity * sunbeamStrength(x, y),
  };
}
