export type Snowflake = {
  x: number;
  y: number;
  speed: number;
  sway: number;
  phase: number;
  size: number;
  opacity: number;
  depth: number;
};

export function createSnowflakes() {
  let seed = 9173;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 174 }, (_, index): Snowflake => {
    const depth = index < 78 ? 0 : index < 142 ? 1 : 2;
    return {
      x: random() * 1672,
      y: random() * 760,
      speed: 8 + depth * 11 + random() * 9,
      sway: 7 + random() * 15 + depth * 4,
      phase: random() * Math.PI * 2,
      size: depth === 0 ? 1 : depth === 1 ? 2 : random() < 0.3 ? 4 : 3,
      opacity: 0.22 + depth * 0.16 + random() * 0.15,
      depth,
    };
  });
}

const wrap = (value: number, length: number) =>
  ((value % length) + length) % length;

export function snowPosition(flake: Snowflake, time: number) {
  const y = wrap(flake.y + time * flake.speed, 760) - 15;
  const wind = time * (2 + flake.depth * 1.4) + Math.sin(time * 0.19) * 12;
  return {
    x: Math.round(
      wrap(
        flake.x + wind + Math.sin(time * 0.48 + flake.phase) * flake.sway,
        1672,
      ),
    ),
    y: Math.round(y),
    // Flakes disappear into the snowy ground before their loop restarts.
    opacity:
      flake.opacity * Math.max(0, Math.min(1, (y + 15) / 30, (745 - y) / 65)),
  };
}

export function winterLightLevel(time: number, phase: number) {
  return (
    0.5 +
    Math.sin(time * 0.52 + phase) * 0.4 +
    Math.sin(time * 1.07 + phase * 2) * 0.07
  );
}
