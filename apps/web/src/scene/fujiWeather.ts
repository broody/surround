const TAU = Math.PI * 2;
const smooth = (value: number) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};

// Heavy pine trunks stay anchored. The outer needle clusters catch the breeze.
export function pineBend(
  distance: number,
  time: number,
  phase: number,
  amplitude: number,
) {
  const tip = Math.max(0, Math.min(1, distance));
  return (
    tip *
    tip *
    amplitude *
    (Math.sin(time * 0.62 + phase + tip * 1.1) * 0.78 +
      Math.sin(time * 1.31 + phase * 1.7 + tip * 2.4) * 0.22)
  );
}

export function fujiCloudDrift(index: number, time: number) {
  return {
    x:
      Math.sin(time * (0.027 + index * 0.004) + index * 1.7) * (18 + index * 4),
    y: Math.sin(time * 0.046 + index * 1.3) * 1.4,
  };
}

export function fujiCloudBankDrift(layer: "far" | "near", time: number) {
  const near = layer === "near";
  return {
    x: Math.sin(time * (near ? 0.029 : 0.019)) * (near ? 52 : 36),
    y: Math.sin(time * 0.037 + (near ? 1.2 : 0)) * (near ? 1.8 : 1.1),
  };
}

const BIRD_FLIGHTS = [
  { delay: 0, duration: 64, reverse: false, height: 206, phase: 0 },
  { delay: 45, duration: 56, reverse: true, height: 258, phase: 1.7 },
] as const;
export const FUJI_BIRD_COUNT = BIRD_FLIGHTS.length;

// Independent crossings, never a formation. The second bird enters later from
// the opposite side, briefly overlapping the first; both then leave a quiet gap.
// Start partway into the first solo flight so it is visible soon after loading.
export function fujiBirdPosition(index: number, time: number) {
  const flight = BIRD_FLIGHTS[index % FUJI_BIRD_COUNT];
  const cycle = (((time + 18 - flight.delay) % 142) + 142) % 142;
  const progress = Math.min(1, cycle / flight.duration);
  const flap = (((time + flight.phase) % 5.8) + 5.8) % 5.8;
  const travel = -100 + progress * 1872;
  return {
    x: flight.reverse ? 1672 - travel : travel,
    y: flight.height + Math.sin(time * 0.17 + flight.phase) * 5 +
      progress * (flight.reverse ? 12 : -22),
    // Angular pixel wings: short flapping bursts interspersed with gliding.
    wing: flap < 2.6 ? Math.round(Math.sin(flap * 9) * 2) : -1,
    span: index % 2 === 0 ? 5 : 4,
    opacity: cycle < flight.duration
      ? smooth(cycle / 3) * smooth((flight.duration - cycle) / 3) * 0.9
      : 0,
  };
}

export const LAKE_TOP = 476;
export const LAKE_BOTTOM = 629;

export function lakeOffset(y: number, time: number) {
  const depth = (y - LAKE_TOP) / (LAKE_BOTTOM - LAKE_TOP);
  const edge = smooth(depth * 8) * smooth((1 - depth) * 8);
  return (
    edge *
    (0.45 + depth * 1.8) *
    (Math.sin(y * 0.17 - time * 0.95) * 0.72 +
      Math.sin(y * 0.063 + time * 0.58) * 0.28)
  );
}

export function lakeGlint(row: number, time: number) {
  return 0.035 + (0.5 + Math.sin(row * 0.31 - time * 0.78) * 0.5) ** 3 * 0.24;
}

export type PineMote = {
  x: number;
  y: number;
  phase: number;
  duration: number;
  size: number;
};
export function createPineMotes(): PineMote[] {
  let seed = 270926;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 32 }, (_, index) => ({
    x: index % 2 ? 1250 + random() * 330 : 25 + random() * 405,
    y: 290 + random() * 465,
    phase: random(),
    duration: 19 + random() * 19,
    size: index % 5 === 0 ? 3 : 2,
  }));
}

export function pineMotePosition(mote: PineMote, time: number) {
  const p = (((mote.phase + time / mote.duration) % 1) + 1) % 1;
  return {
    x: mote.x + p * 37 + Math.sin(p * TAU + mote.phase * TAU) * 9,
    y: mote.y - p * 82,
    opacity: Math.sin(p * Math.PI) ** 2 * 0.54,
  };
}
