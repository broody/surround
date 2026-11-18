// How long an AI takes over a move, the way a person spends their clock: a
// budget a move from the time it has and the moves it expects to play, then
// more on a hard move and less on an easy one. How hard a move is comes from
// KataGo's human model at the AI's rank (katago/engine.ts `difficultyOf`): how
// many moves such a player would weigh, how unsettled the board is, how much
// the choice matters. A forced reply comes in about a second; a move that cost
// it points brings a long think. The same position gets the same think, give
// or take a tenth, and a think never runs past its board's cap or half a
// byo-yomi period.
import { BYOYOMI } from "../sdk/src/clocks.mjs";

export type PaceInput = {
  /** The board's size: 9, 13 or 19. */
  size: number;
  /** Moves played so far. */
  moves: number;
  /** The AI's score lead before this move, from its own side; null if unknown. */
  lead: number | null;
  /** Its lead at its last turn, before that move; null on its first. */
  leadBefore: number | null;
  /** How likely the human policy rates its likeliest move (0 to 1): near 1 for a forced reply. */
  top: number | null;
  /** How many moves a human of its rank would seriously weigh (the policy's perplexity). */
  choices: number | null;
  /** How much of the board is still unsettled, 0 to 1. */
  unsettled: number | null;
  /** The points between the best candidate and the third: how much the choice matters. */
  stakes: number | null;
  /** The player just passed, or the AI is passing: answered at once. */
  passing: boolean;
  /** Moves the AI has made since its last long think. */
  sinceLong: number;
  /** The character's tempo (TEMPO): above 1 slower, below quicker. */
  tempo: number;
  /**
   * The AI's clock: main time left, and byo-yomi periods left and the time in
   * the current one; null for an untimed game, paced as if on its board's byo-yomi.
   */
  clock: { mainMs: number; periods: number; periodMs: number } | null;
  /** The position's, so the same position gets the same think. */
  seed: number;
};

export const PACE = {
  /** The shortest pause for any move. */
  floor: 600,
  /** A forced reply or an answer to a pass: about this long. */
  quick: 1_000,
  /**
   * A forced reply: the human policy's likeliest move at least this likely, or
   * hardly a second choice. A kyu player's policy is often 0.6 to 0.8 sure of
   * an ordinary move, so only near-certainty counts.
   */
  forced: { top: 0.85, choices: 1.6 },
  /** Moves in a typical game on each board, both sides. */
  expected: { 9: 60, 13: 130, 19: 220 } as Record<number, number>,
  /** Its own moves it always plans for, however late. */
  minLeft: { 9: 8, 13: 15, 19: 25 } as Record<number, number>,
  /** The share of its main time it plans to spend. */
  share: 0.6,
  /** In byo-yomi: a move's budget, and the most it may use, as shares of a period. */
  period: { budget: 0.25, cap: 0.5 },
  /** The longest think on each board. */
  cap: { 9: 15_000, 13: 20_000, 19: 30_000 } as Record<number, number>,
  /** As many even choices as this: an ordinary move, the budget. */
  choices: 12,
  /** The opening (this share of the board filled): played from knowledge, quicker. */
  opening: { until: 0.08, factor: 0.6 },
  /** Behind by more than this many points: a little longer. */
  behind: { points: 3, factor: 1.15 },
  /**
   * Its lead fell by at least this many points since its last turn (per
   * board): a long think. A 64-visit search's lead swings by several points
   * from move to move, so less is noise.
   */
  shock: { 9: 6, 13: 9, 19: 12 } as Record<number, number>,
  /** A long think: at least this many budgets. */
  long: 3,
  /** Moves between long thinks. */
  rest: 5,
  /** How far a think strays from its formula, either way. */
  jitter: 0.1,
};

/** Each character's tempo, by id (shared/lobby.ts): eager and bold players quicker, patient ones slower. */
export const TEMPO: Record<string, number> = {
  yuna: 0.8,
  malik: 1,
  nanami: 0.9,
  luc: 1.25,
  ryo: 1.15,
};

/** A number in [0, 1) from `seed`, always the same one (mulberry32). */
function unit(seed: number) {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * What a move is worth spending (`budget`) and the most it may take (`cap`),
 * from the AI's clock: its main time over the moves it expects to play, or a
 * share of a byo-yomi period. Untimed, as if on its board's byo-yomi, fresh.
 */
export function budgetOf({ size, moves, clock }: Pick<PaceInput, "size" | "moves" | "clock">) {
  const boardCap = PACE.cap[size] ?? PACE.cap[19];
  const expected = PACE.expected[size] ?? PACE.expected[19];
  if (!clock) {
    const preset = BYOYOMI[size as 9 | 13 | 19] ?? BYOYOMI[19];
    return { budget: (preset.main_ms * PACE.share) / (expected / 2), cap: boardCap };
  }
  const { mainMs, periods, periodMs } = clock;
  if (mainMs <= 0 && periods > 0)
    return { budget: periodMs * PACE.period.budget, cap: Math.min(boardCap, periodMs * PACE.period.cap) };
  const own = Math.max(PACE.minLeft[size] ?? PACE.minLeft[19], (expected - moves) / 2);
  // In main time, a think may run on into a period, as far as half of it.
  return {
    budget: (mainMs * PACE.share) / own,
    cap: Math.min(boardCap, mainMs + (periods > 0 ? periodMs * PACE.period.cap : 0)),
  };
}

/** How hard a move is, as a share of the budget: 1 for an ordinary one, more for a hard fight, less for an easy one. */
export function weightOf({ size, moves, lead, choices, unsettled, stakes }: PaceInput) {
  const spread = choices === null ? 0.8 : Math.min(1.4, Math.max(0.1, Math.log(Math.max(1, choices)) / Math.log(PACE.choices)));
  let weight = 0.35 + 0.65 * spread;
  if (unsettled !== null) weight *= 0.6 + Math.min(1, unsettled);
  if (stakes !== null) weight *= 1 + Math.min(stakes, 12) / 24;
  if (moves / (size * size) < PACE.opening.until) weight *= PACE.opening.factor;
  if (lead !== null && lead < -PACE.behind.points) weight *= PACE.behind.factor;
  return weight;
}

/** How long the AI should take over this move, in milliseconds, and whether that is a long think. */
export function paceFor(input: PaceInput): { ms: number; long: boolean } {
  const { size, lead, leadBefore, top, choices, passing, sinceLong, tempo, seed } = input;
  const { budget, cap } = budgetOf(input);
  const jitter = 1 + PACE.jitter * (2 * unit(seed) - 1);
  const clamp = (ms: number) => Math.round(Math.max(Math.min(PACE.floor, cap), Math.min(cap, ms)));
  if (passing || (top !== null && top >= PACE.forced.top) || (choices !== null && choices < PACE.forced.choices))
    return { ms: clamp(Math.min(budget, PACE.quick) * tempo * jitter), long: false };
  const ms = budget * weightOf(input) * tempo * jitter;
  const shocked = lead !== null && leadBefore !== null && leadBefore - lead >= (PACE.shock[size] ?? PACE.shock[19]);
  if (shocked && sinceLong >= PACE.rest) return { ms: clamp(Math.max(ms, budget * PACE.long * tempo * jitter)), long: true };
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
