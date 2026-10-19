export type BoardSize = 9 | 13 | 19;
export const RANKS = [
  ...Array.from({ length: 20 }, (_, i) => `${20 - i}k`),
  ...Array.from({ length: 9 }, (_, i) => `${i + 1}d`),
];
export const rankName = (rank: string) =>
  `${rank.slice(0, -1)} ${rank.endsWith("k") ? "kyu" : "dan"}`;
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
