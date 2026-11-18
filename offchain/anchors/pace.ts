// How long an AI takes over a move, so it plays like someone thinking and not
// like a program: quick on a forced reply, longer in the middle game and on a
// hard choice, a little longer when behind, and a long think when the
// player's last move cost it points. Most moves take a second or three; a
// long think comes at most every few moves, and never runs past its board's
// cap or a small share of the time it has left for the move.

export type PaceInput = {
  /** The board's size: 9, 13 or 19. */
  size: number;
  /** Moves played so far. */
  moves: number;
  /** The AI's score lead before this move, from its own side; null if unknown. */
  lead: number | null;
  /** Its lead at its last turn, before that move; null on its first. */
  leadBefore: number | null;
  /** How likely the human policy rates its likeliest move (0 to 1): a forced move is near 1; null if unknown. */
  top: number | null;
  /** The player just passed, or the AI is passing: answered at once. */
  passing: boolean;
  /** Moves the AI has made since its last long think. */
  sinceLong: number;
  /** The character's tempo (TEMPO): above 1 slower, below quicker. */
  tempo: number;
  /**
   * In a timed game, the milliseconds it has for this move before it loses a
   * byo-yomi period or flags (its main time, or else its period); null if
   * untimed.
   */
  leftMs: number | null;
};

export const PACE = {
  /** The longest think on each board, in milliseconds. */
  cap: { 9: 6_000, 13: 10_000, 19: 15_000 } as Record<number, number>,
  /** The shortest pause for any move. */
  floor: 400,
  /** A forced move or an answer to a pass: this long, give or take. */
  quick: [500, 1_200] as const,
  /** The typical think by stage of the game (the share of the board filled): opening, middle game, endgame. */
  stages: [
    { until: 0.1, ms: 1_000 },
    { until: 0.45, ms: 2_000 },
    { until: Infinity, ms: 1_600 },
  ],
  /** Smaller boards think shorter. */
  board: { 9: 0.7, 13: 0.85, 19: 1 } as Record<number, number>,
  /** How widely a think varies around the typical one (a log-normal spread). */
  spread: 0.45,
  /** The human policy's likeliest move at least this likely: a forced move. */
  forced: 0.6,
  /** Behind by more than this many points: thinks a little longer. */
  behind: 3,
  /** Its lead fell by at least this many points since its last turn (per board): a long think. */
  shock: { 9: 3, 13: 5, 19: 6 } as Record<number, number>,
  /** A hard position (the likeliest move under this) may bring a long think by itself, this often. */
  hard: { top: 0.15, chance: 0.2 },
  /** Moves between long thinks. */
  rest: 5,
  /** The most of the time it has for a move (`leftMs`) a think may use. */
  clockShare: 0.2,
};

/** Each character's tempo, by id (shared/lobby.ts): eager and bold players quicker, patient ones slower. */
export const TEMPO: Record<string, number> = {
  yuna: 0.8,
  malik: 1,
  nanami: 0.9,
  luc: 1.25,
  ryo: 1.15,
};

/** A standard normal sample from `random`. */
function gaussian(random: () => number) {
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** How long the AI should take over this move, in milliseconds, and whether that is a long think. */
export function paceFor(input: PaceInput, random: () => number = Math.random): { ms: number; long: boolean } {
  const { size, moves, lead, leadBefore, top, passing, sinceLong, tempo, leftMs } = input;
  const cap = Math.min(PACE.cap[size] ?? PACE.cap[19], leftMs !== null ? leftMs * PACE.clockShare : Infinity);
  const clamp = (ms: number) => Math.round(Math.max(PACE.floor, Math.min(cap, ms)));
  const [low, high] = PACE.quick;
  if (passing || (top !== null && top >= PACE.forced))
    return { ms: clamp((low + (high - low) * random()) * tempo), long: false };

  const rested = sinceLong >= PACE.rest;
  const shocked = lead !== null && leadBefore !== null && leadBefore - lead >= (PACE.shock[size] ?? PACE.shock[19]);
  const hard = top !== null && top < PACE.hard.top && random() < PACE.hard.chance;
  if (rested && (shocked || hard)) return { ms: clamp(cap * (0.55 + 0.45 * random())), long: true };

  const filled = moves / (size * size);
  let ms = PACE.stages.find((stage) => filled < stage.until)!.ms * (PACE.board[size] ?? 1);
  if (top !== null) ms *= 0.8 + 0.6 * (1 - top);
  if (lead !== null && lead < -PACE.behind) ms *= 1.25;
  ms *= tempo * Math.exp(PACE.spread * gaussian(random));
  return { ms: clamp(ms), long: false };
}

/**
 * The AI's mood after the player's move, for its portrait: frustrated when its
 * lead fell since its last turn by a long think's margin (`PACE.shock`),
 * excited when it rose as much; null otherwise.
 */
export function moodFor({ size, lead, leadBefore }: Pick<PaceInput, "size" | "lead" | "leadBefore">) {
  if (lead === null || leadBefore === null) return null;
  const margin = PACE.shock[size] ?? PACE.shock[19];
  return lead - leadBefore <= -margin ? "frustrated" : lead - leadBefore >= margin ? "excited" : null;
}
