import { areaScore, opposite, play, type Color, type Position } from "../game/rules.ts";
import { ACCEPT, PASS, PLAY, PROPOSE, RESUME, openingPosition, pointsOf } from "../../../../shared/go.ts";

/** Arbiter step kinds (offchain/sdk): a game action, a resignation, the referee's flag. */
const MOVE_PLAY = 0,
  MOVE_RESIGN = 4,
  MOVE_FLAG = 5;

/** A step as the matchmaker serves a replay (GET /games/:id/record): bare, without signatures. */
export type ReplayStep = {
  kind: number;
  action?: { kind: number; point?: number; dead?: string };
  seat?: number;
};

/** How a replayed game ended, as its steps show it; null when they don't say (a game played out, or cut short). */
export type ReplayEnd =
  | { kind: "resign"; color: Color }
  | { kind: "time"; color: Color }
  | { kind: "count"; dead: Set<number>; black: number; white: number };

/**
 * Every position a game passed through, one per move (a play or a pass),
 * from the opening board (empty, or a `handicap` game's stones), and how it ended. Proposals, acceptances and
 * resumptions at scoring aren't moves: they only decide the end. A game that
 * ends on the board (two passes after a resumption) is counted with every
 * stone alive. A step the board can't take (it never should) ends the replay
 * there.
 */
export function replayOf(steps: readonly ReplayStep[], size: number, komi: number, winner: number | null = null, handicap = 0) {
  const positions: Position[] = [openingPosition(size, handicap)];
  let end: ReplayEnd | null = null;
  let proposed: Set<number> | null = null;
  let resumed = false;
  const count = (board: Position["board"], dead: Set<number>): ReplayEnd => {
    const area = areaScore(board, dead);
    return { kind: "count", dead, black: area.black, white: area.white + komi };
  };
  for (const step of steps) {
    const position = positions[positions.length - 1];
    if (step.kind === MOVE_RESIGN) {
      end = { kind: "resign", color: step.seat === 1 ? 2 : 1 };
      break;
    }
    if (step.kind === MOVE_FLAG) {
      // The referee flags the side that lost; at scoring, whose turn it was isn't the board's.
      end = { kind: "time", color: winner === 1 ? 2 : winner === 2 ? 1 : position.turn };
      break;
    }
    if (step.kind !== MOVE_PLAY || !step.action) continue;
    const { kind, point, dead } = step.action;
    if (kind === PLAY || kind === PASS) {
      let next: Position;
      try {
        next = play(position, kind === PLAY ? point! : null);
      } catch {
        break;
      }
      positions.push(next);
      // Once play resumed, two passes end the game, every stone on the board counted alive.
      if (resumed && next.paused) {
        end = count(next.board, new Set());
        break;
      }
    } else if (kind === PROPOSE) proposed = new Set(pointsOf(BigInt(dead ?? 0), size));
    else if (kind === RESUME) {
      proposed = null;
      resumed = true;
      positions[positions.length - 1] = { ...position, passes: 0, paused: false };
    } else if (kind === ACCEPT && proposed) {
      end = count(position.board, proposed);
      break;
    }
  }
  return { positions, end };
}

/** A game's result as players write it: "B+R", "W+T", "B+6.5", "Draw". */
export function resultText(end: ReplayEnd | null, winner: number | null) {
  const side = (color: Color) => (color === 1 ? "B" : "W");
  if (winner === 0) return "Draw";
  if (end?.kind === "resign") return `${side(opposite(end.color))}+R`;
  if (end?.kind === "time") return `${side(opposite(end.color))}+T`;
  if (end?.kind === "count") {
    const margin = Math.abs(end.black - end.white);
    return margin ? `${end.black > end.white ? "B" : "W"}+${margin}` : "Draw";
  }
  return winner === 1 ? "B+" : winner === 2 ? "W+" : "";
}
