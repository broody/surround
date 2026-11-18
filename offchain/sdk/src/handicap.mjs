// Surround's handicap: how many stones each board takes and where they go.
// No dependencies, so the web, the anchors and the codec (index.mjs) share
// one table: the rules, the board drawn and KataGo's setup all read it.

/**
 * The most handicap a `size` board takes: 9 stones on 13×13 and 19×19, 5 on
 * 9×9 (its corner 3-3 points and centre). 1 is a game with no stones in which
 * Black moves first on half a point of komi; 0 is an even game.
 */
export const maxHandicap = size => (Number(size) === 9 ? 5 : 9);

/** The komi of a handicap game, in half-points: half a point, so a game can't be drawn. */
export const HANDICAP_KOMI_HALF = 1;

/**
 * Black's handicap stones on a `size` board, as points (row × size + column,
 * row 0 at the top), in fixed star-point placement: 2 at the upper right and
 * lower left, 3 adds the lower right, 4 the upper left, 5 the centre, 6 the
 * left and right sides (no centre), 7 the centre again, 8 all four sides, 9
 * the centre again. Under 2 there are none.
 */
export function handicapPoints(size, stones) {
  size = Number(size); stones = Number(stones);
  if (stones < 2) return [];
  const edge = size >= 13 ? 3 : 2, far = size - 1 - edge, mid = (size - 1) / 2;
  const at = (column, row) => row * size + column;
  const corners = [at(far, edge), at(edge, far), at(far, far), at(edge, edge)];
  const centre = at(mid, mid), sides = [at(edge, mid), at(far, mid)], ends = [at(mid, edge), at(mid, far)];
  if (stones <= 4) return corners.slice(0, stones);
  if (stones === 5) return [...corners, centre];
  if (stones === 6) return [...corners, ...sides];
  if (stones === 7) return [...corners, ...sides, centre];
  if (stones === 8) return [...corners, ...sides, ...ends];
  return [...corners, ...sides, ...ends, centre];
}
