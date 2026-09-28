const TAU = Math.PI * 2;
const wrap = (value: number) => ((value % 1) + 1) % 1;
const smooth = (value: number) => value * value * (3 - 2 * value);

export const EARTH = { x: 302, y: 207, rx: 195, ry: 182 };
export const METEOR_CYCLE = 38;
export const METEOR_DURATION = 1.4;

export function outsideEarth(x: number, y: number, margin = 0) {
  return (
    ((x - EARTH.x) / (EARTH.rx + margin)) ** 2 +
      ((y - EARTH.y) / (EARTH.ry + margin)) ** 2 >
    1
  );
}

// Clearly visible dim-to-bright cycles, offset per star and never rapid flashes.
export function starPulse(time: number, index: number) {
  return (
    Math.sin((time * TAU) / (4.5 + (index % 8) * 0.65) + index * 2.399) * 0.64 +
    Math.sin(time * 0.41 + index * 0.91) * 0.08
  );
}

export function dishPose(time: number) {
  const scan = Math.sin((time * TAU) / 54);
  return {
    angle: scan * 0.14,
    scaleX: 0.96 + Math.cos((time * TAU) / 54) * 0.04,
  };
}

export function stationLight(time: number, index: number) {
  return 0.5 + Math.sin((time * TAU) / (5.5 + index * 1.9) + index * 2) * 0.3;
}

// A soft navigation beacon on the fixed antenna: bright crest, long gentle fade.
export function antennaBeacon(time: number) {
  const pulse = 0.5 + Math.cos((time * TAU) / 4.8) * 0.5;
  return 0.18 + pulse * pulse * 0.82;
}

export function earthAtmosphere(time: number) {
  return {
    rim: 0.18 + Math.sin((time * TAU) / 24) * 0.13,
    clouds: 0.32 + Math.sin((time * TAU) / 39 + 0.7) * 0.06,
    cloudX: Math.sin((time * TAU) / 84) * 6,
    cloudY: Math.sin((time * TAU) / 103) * 1.4,
  };
}

export function shootingStar(time: number) {
  const cycle = Math.floor(time / METEOR_CYCLE);
  // The first visit gets a shooting star after 11 seconds, then roughly 38s apart.
  const start = 11 + ((cycle * 7) % 5);
  const age = time - cycle * METEOR_CYCLE - start;
  if (age < 0 || age >= METEOR_DURATION) return null;
  const progress = age / METEOR_DURATION;
  const x = 650 + ((cycle * 173) % 520) + progress * 240;
  const y = 64 + ((cycle * 41) % 85) + progress * 82;
  return {
    x,
    y,
    dx: 240,
    dy: 82,
    opacity: Math.sin(progress * Math.PI) * 0.62,
    tail: Math.min(72, progress * 200),
  };
}

export type LunarDust = {
  x: number;
  y: number;
  phase: number;
  duration: number;
  drift: number;
  height: number;
  opacity: number;
  size: number;
};

export function createLunarDust(): LunarDust[] {
  let seed = 19690720;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 96 }, (_, index) => ({
    x: 80 + random() * 1500,
    y: index < 26 ? 580 + random() * 140 : 740 + random() * 195,
    phase: random(),
    duration: 18 + random() * 18,
    drift: (random() - 0.5) * 90,
    height: 45 + random() * 90,
    opacity: 0.65 + random() * 0.3,
    size: index % 9 === 0 ? 4 : index % 3 === 0 ? 3 : 2,
  }));
}

export function lunarDustPosition(mote: LunarDust, time: number) {
  const progress = wrap(mote.phase + time / mote.duration);
  const fade = smooth(Math.min(1, progress / 0.18, (1 - progress) / 0.18));
  return {
    x: mote.x + (progress - 0.5) * mote.drift,
    // Slow, low-gravity arcs rather than wind or fog on the airless surface.
    y: mote.y - Math.sin(progress * Math.PI) * mote.height,
    opacity:
      fade *
      mote.opacity *
      (0.83 + Math.sin(time * 0.6 + mote.phase * TAU) * 0.17),
  };
}
