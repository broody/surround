import type { Color, Position } from "../apps/web/src/game/rules.ts";

export type BoardSize = 9 | 13 | 19;
export const PLACEMENT_GAMES = 5;
export const KOMI = 6.5;
export const RANKS = [
  ...Array.from({ length: 20 }, (_, i) => `${20 - i}k`),
  ...Array.from({ length: 9 }, (_, i) => `${i + 1}d`),
];
export const rankName = (rank: string) =>
  `${rank.slice(0, -1)} ${rank.endsWith("k") ? "kyu" : "dan"}`;
export const rankIndex = (rank: string) =>
  rank.endsWith("k") ? 30 - Number.parseInt(rank) : 29 + Number.parseInt(rank);
export type Character = {
  id: string;
  name: string;
  rank: string;
  portrait: string;
  style: string;
  greeting: string;
  emotions?: string;
};
// Five AI opponents, one per level from beginner to pro. Each plays KataGo's
// human SL profile for its rank at a fixed strength: its rating is pinned
// (an anchor), so the rank a newcomer earns against it means something.
// Identity and art come from the rank cast. Dialogue is deliberately editable
// character copy, independent of the engine's playing strength. A portrait
// drawn for another level names that level last.
const cast: [string, string, string, number, string, string, string?][] = [
  [
    "yuna",
    "Yuna Seki",
    "20k",
    3,
    "Eager to learn",
    "Every game teaches me something. Shall we?",
  ],
  [
    "malik",
    "Malik Diop",
    "10k",
    3,
    "An eye for opportunity",
    "There's always another way around.",
  ],
  [
    "nanami",
    "Nanami Ueda",
    "5k",
    2,
    "Clever, and growing bolder",
    "I've been getting braver. Let's find out how much.",
    "10k",
  ],
  [
    "luc",
    "Luc Moreau",
    "1d",
    1,
    "Patient and good-humored",
    "No rush. The good fights take a while to start.",
    "5k",
  ],
  [
    "ryo",
    "Ryo Kanzaki",
    "9d",
    3,
    "Master study",
    "There is always more to see.",
  ],
];
/// The pro plays at 9d, the top rank shown.
export const levelName = (rank: string) =>
  rank === "9d" ? "Pro" : rankName(rank);
export const CHARACTERS: Character[] = cast.map(
  ([id, name, rank, version, style, greeting, drawnAt = rank]) => ({
    id,
    name,
    rank,
    style,
    greeting,
    portrait: `/assets/characters/rank-${drawnAt === "9d" ? "professional" : drawnAt.replace("k", "kyu").replace("d", "dan")}-${id}-portrait-v${version}.png`,
    emotions: `/assets/characters/${id}-emotion-`,
  }),
);
export function recommendedCharacter(rank: string): Character {
  return CHARACTERS.reduce((best, character) =>
    Math.abs(rankIndex(character.rank) - rankIndex(rank)) <
    Math.abs(rankIndex(best.rank) - rankIndex(rank))
      ? character
      : best,
  );
}
export type Player = {
  id: string;
  name: string;
  rank: string;
  games: number;
  placementGames: number;
  wins: number;
  losses: number;
};
export type Seat = {
  id: string;
  name: string;
  rank: string;
  kind: "human" | "ai";
  characterId?: string;
};
export type Match = {
  id: string;
  version: number;
  size: BoardSize;
  komi: number;
  black: Seat;
  white: Seat | null;
  position: Position;
  status: "waiting" | "playing" | "scoring" | "finished" | "cancelled";
  visibility: "public" | "private";
  code?: string;
  ranked: boolean;
  placement: boolean;
  thinking: boolean;
  error?: string;
  dead: number[];
  accepted: string[];
  score?: { black: number; white: number };
  result?: {
    winner: Color;
    reason: "score" | "resign";
    margin?: number;
    rated: boolean;
    rankChanges: Record<string, string>;
  };
  updatedAt: number;
};
export type Lobby = {
  player: Player;
  activeMatch: string | null;
  queued: boolean;
  tables: { id: string; host: Seat; size: BoardSize; ranked: boolean }[];
  humans: { id: string; name: string; rank: string; playing: boolean }[];
  engine: {
    state: "starting" | "ready" | "unavailable";
    human: boolean;
    pending: number;
  };
};
