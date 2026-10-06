import type { Character, Match } from "../../../../shared/lobby.ts";

export const EMOTIONS = ["normal", "excited", "frustrated", "serene", "defeated", "thinking"] as const;
export type Emotion = (typeof EMOTIONS)[number];

// Revised states can advance without replacing the rest of a character's set.
const EMOTION_VERSIONS: Record<string, Partial<Record<Emotion, number>>> = {
  yuna: { excited: 3, frustrated: 3 },
  malik: { excited: 4, frustrated: 2, defeated: 2 },
  nanami: { normal: 2, excited: 2, frustrated: 2, defeated: 3 },
  luc: { excited: 2, frustrated: 2 },
  ryo: { excited: 3, frustrated: 3 },
};

export function characterPortrait(character: Character, emotion: Emotion = "normal") {
  const version = EMOTION_VERSIONS[character.id]?.[emotion] ?? 1;
  return character.emotions
    ? `${character.emotions}${emotion}-v${version}.png`
    : character.portrait;
}

// Show thinking during AI calculation; other expressions react to board
// events rather than an inferred mood or win probability.
export function opponentEmotion(match: Match | null | undefined): Emotion {
  if (!match) return "normal";
  if (match.result) return match.result.winner === 2 ? "excited" : "defeated";
  if (match.thinking && (match.status === "playing" || match.status === "scoring")) return "thinking";
  if (match.status !== "playing") return match.status === "scoring" ? "serene" : "normal";
  const recent = match.position.moves.slice(-2).reverse();
  if (recent[0]?.point === null) return "serene";
  const capture = recent.find(move => move.captures > 0);
  return capture ? capture.color === 2 ? "excited" : "frustrated" : "normal";
}
