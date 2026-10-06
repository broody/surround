import type { Character, Match } from "../../../../shared/lobby.ts";

export const EMOTIONS = ["normal", "excited", "frustrated", "serene", "defeated"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export function characterPortrait(character: Character, emotion: Emotion = "normal") {
  return character.emotions
    ? `${character.emotions}${emotion}-v1.png`
    : character.portrait;
}

// React to board events, rather than claiming to know the engine's mood or
// win probability. A capture reaction lasts through the immediate reply.
export function opponentEmotion(match: Match | null | undefined): Emotion {
  if (!match) return "normal";
  if (match.result) return match.result.winner === 2 ? "excited" : "defeated";
  if (match.status !== "playing") return match.status === "scoring" ? "serene" : "normal";
  const recent = match.position.moves.slice(-2).reverse();
  if (recent[0]?.point === null) return "serene";
  const capture = recent.find(move => move.captures > 0);
  return capture ? capture.color === 2 ? "excited" : "frustrated" : "normal";
}
