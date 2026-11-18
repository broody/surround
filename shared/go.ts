import {
  emptyPosition,
  play,
  type Position,
} from "../apps/web/src/game/rules.ts";
import { handicapPoints } from "../offchain/sdk/src/handicap.mjs";

/** Go's actions, as Surround's protocol numbers them (offchain/sdk/src/index.mjs). */
export const PLAY = 0,
  PASS = 1,
  PROPOSE = 2,
  ACCEPT = 3,
  RESUME = 4;
/** An arbiter step that plays a game action (others are resignations and the referee's). */
const MOVE_PLAY = 0;

/** A session's step record, as far as the position needs it. */
export type StepRecord = {
  step: { kind: number; action?: { kind: number; point?: number } };
};

/**
 * A game's first position: an empty board, or in a `handicap` game Black's
 * stones on it (`setup`) and White to move, as the rules' `init` sets it.
 */
export function openingPosition(size: number, handicap = 0): Position {
  const setup = handicapPoints(size, handicap);
  if (!setup.length) return emptyPosition(size);
  const board = emptyPosition(size).board.map((stone, point) => (setup.includes(point) ? 1 : stone));
  return { ...emptyPosition(size), board, turn: 2, hashes: [board.join("")], setup };
}

/**
 * The Go position a session's steps reached from its opening (`handicap`
 * stones, if any): plays and passes in order; resuming after a scoring
 * proposal clears the passes. Shared by the anchor daemon (the engine's
 * input) and the browser (the board it draws).
 */
export function positionOf(steps: readonly StepRecord[], size: number, handicap = 0): Position {
  let position = openingPosition(size, handicap);
  for (const { step } of steps) {
    if (step.kind !== MOVE_PLAY || !step.action) continue;
    const { kind, point } = step.action;
    if (kind === PLAY) position = play(position, point!);
    else if (kind === PASS) position = play(position, null);
    else if (kind === RESUME) position = { ...position, passes: 0, paused: false };
  }
  return position;
}

/** Points as the bitmask a scoring proposal carries. */
export const maskOf = (points: Iterable<number>) =>
  [...points].reduce((mask, point) => mask | (1n << BigInt(point)), 0n);

/** The points a bitmask names. */
export function pointsOf(mask: bigint, size: number): number[] {
  const points: number[] = [];
  for (let point = 0; point < size * size; point++)
    if (mask & (1n << BigInt(point))) points.push(point);
  return points;
}
