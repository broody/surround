import type { BoardRegion } from "../game/region.ts";
import { emptyPosition, play, SIZE, type Position } from "../game/rules.ts";

export const LESSON_STONE = 9 * SIZE + 9;
export const LESSON_TARGET = LESSON_STONE + 1;
export const LESSON_REGION: BoardRegion = {
  left: 7,
  top: 7,
  right: 11,
  bottom: 11,
};

// A legal sequence on the real board. Two distant black stones and a pass
// let White surround the center; only the central 5×5 area is illustrated.
export function createCaptureLesson() {
  return [
    LESSON_STONE,
    LESSON_STONE - 1,
    0,
    LESSON_STONE - SIZE,
    SIZE * SIZE - 1,
    LESSON_STONE + SIZE,
    null,
  ].reduce((position, point) => play(position, point), emptyPosition());
}

/**
 * White's try from the lesson position, wherever the player put the stone.
 * Each try starts over from the lesson, so a miss leaves White to play again.
 * Throws where `play` would, as on an occupied point.
 */
export function tryCapture(point: number): {
  position: Position;
  captured: boolean;
} {
  const after = play(createCaptureLesson(), point);
  const captured = after.captures[1] > 0;
  return { position: captured ? after : { ...after, turn: 2 }, captured };
}
