import { groupAt, type Position } from "../../apps/web/src/game/rules.ts";

/** Ownership is reported from Black's perspective by analysis.cfg. */
export function deadStones(
  position: Position,
  ownership?: number[],
): Set<number> {
  if (
    !ownership ||
    ownership.length !== position.board.length ||
    ownership.some((value) => !Number.isFinite(value) || Math.abs(value) > 1)
  )
    throw new Error("KataGo did not return a usable score estimate.");
  const dead = new Set<number>();
  const seen = new Set<number>();
  position.board.forEach((stone, point) => {
    if (!stone || seen.has(point)) return;
    const stones = [...groupAt(position.board, point).stones];
    stones.forEach((point) => seen.add(point));
    const average =
      stones.reduce((sum, point) => sum + ownership[point], 0) / stones.length;
    if ((stone === 1 && average < -0.8) || (stone === 2 && average > 0.8))
      stones.forEach((point) => dead.add(point));
  });
  return dead;
}
