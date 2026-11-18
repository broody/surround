import { useEffect, useRef, useState } from "react";
import type { Emotion } from "../lobby/characterArt";
import type { Color, Move } from "../game/rules";

/**
 * How the AI's portrait is kept steady: "thinking" shows only once it has
 * been thinking a while, 8 seconds, longer than an ordinary move takes it
 * (offchain/anchors/pace.ts): a long think, not every turn. It then stays a
 * while, 15 to 25 seconds, as someone lost in thought would; any other face,
 * once shown, stays a few seconds before the next. A game's events cut either
 * short (moodOf's `urgent`).
 */
export const MOOD_TIMING = { thinkingMs: 8000, holdMs: 3000, thinkingHoldMs: [15_000, 25_000] as const };

/** How long a face just shown stays, at the least: "thinking" a random while in `thinkingHoldMs`. */
export function holdOf(emotion: Emotion, random: () => number = Math.random, timing = MOOD_TIMING) {
  const [low, high] = timing.thinkingHoldMs;
  return emotion === "thinking" ? low + (high - low) * random() : timing.holdMs;
}

/** Stones one move must capture, by board size, for the AI's face to answer it. */
export const CAPTURE_MOOD: Record<number, number> = { 9: 3, 13: 4, 19: 5 };

/** The AI's own mood, as it told the matchmaker (GET /games/:digest/mood): about the position after `moves`. */
export type ReportedMood = { moves: number | null; mood: "excited" | "frustrated" | null };

/**
 * The AI's face from how the game is going, over `base`, whose turn it is: a
 * `final` face (the game's end, a pass, the count) first; then the AI's own
 * mood (it lost or gained points with the player's last move), from the move
 * it answers until the player's next; then a big capture, frustrated if the
 * player took the stones and excited if the AI did, for two moves. Those
 * show at once (`urgent`); `base` keeps to `useSteadyMood`'s pace.
 */
export function moodOf({
  base,
  final,
  moves,
  ai,
  size,
  reported,
}: {
  base: Emotion;
  final: boolean;
  moves: Move[];
  ai: Color;
  size: number;
  reported: ReportedMood | null;
}): { emotion: Emotion; urgent: boolean } {
  if (final) return { emotion: base, urgent: true };
  const since = reported?.moves == null ? -1 : moves.length - reported.moves;
  if (reported?.mood && since >= 0 && since <= 1) return { emotion: reported.mood, urgent: true };
  const big = moves.slice(-2).reverse().find((move) => move.captures >= (CAPTURE_MOOD[size] ?? CAPTURE_MOOD[19]));
  if (big) return { emotion: big.color === ai ? "excited" : "frustrated", urgent: true };
  return { emotion: base, urgent: false };
}

/**
 * How long from `now` until the portrait should change from `shown` (held
 * until `until`, holdOf) to `wanted`: null if it already shows it, 0 for at
 * once. An `urgent` face (moodOf) skips the wait.
 */
export function moodWait(
  { shown, until, wanted, urgent, now }: { shown: Emotion; until: number; wanted: Emotion; urgent: boolean; now: number },
  timing = MOOD_TIMING,
): number | null {
  if (wanted === shown) return null;
  if (urgent) return 0;
  return Math.max(0, until - now, wanted === "thinking" ? timing.thinkingMs : 0);
}

/** The face to show for `wanted`, steadied by `moodWait`. */
export function useSteadyMood(wanted: Emotion, urgent: boolean): Emotion {
  const [shown, setShown] = useState(wanted);
  const until = useRef(Date.now() + holdOf(wanted));
  useEffect(() => {
    const wait = moodWait({ shown, until: until.current, wanted, urgent, now: Date.now() });
    if (wait === null) return;
    // A change of mind before it's due (the AI replied quickly) cancels it.
    const timer = setTimeout(() => {
      until.current = Date.now() + holdOf(wanted);
      setShown(wanted);
    }, wait);
    return () => clearTimeout(timer);
  }, [shown, wanted, urgent]);
  return urgent ? wanted : shown;
}

/** The AI's own mood in game `digest`, read from the matchmaker every couple of seconds while `on`. */
export function useReportedMood(matchmaker: string, digest: string, on: boolean): ReportedMood | null {
  const [mood, setMood] = useState<ReportedMood | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const read = () =>
      fetch(`${matchmaker}/games/${digest}/mood`)
        .then((response) => (response.ok ? response.json() : null))
        .then((value) => live && setMood(value))
        .catch(() => {});
    void read();
    const timer = setInterval(read, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [matchmaker, digest, on]);
  return mood;
}
