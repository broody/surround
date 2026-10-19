import type { Character } from "../../../../shared/lobby.ts";

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

