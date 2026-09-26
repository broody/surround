import { emptyPosition, play, SIZE } from "../game/rules.ts";

export const LESSON_STONE = 9 * SIZE + 9;
export const LESSON_TARGET = LESSON_STONE + 1;

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
