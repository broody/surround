// Sample lobby contents. Nothing here is fetched from a relay or the channel;
// the lobby is a visual preview until online play is integrated.

export type BoardSize = 9 | 13 | 19;
export type Presence = "online" | "playing" | "away";

// Ranked games use referee clocks (60 s per turn or Japanese byo-yomi);
// casual games are untimed.
export const PACES = [
  { id: "casual", label: "Casual", clock: "Untimed" },
  { id: "ranked-turn", label: "Ranked", clock: "60 s / move" },
  { id: "ranked-byoyomi", label: "Ranked", clock: "Byo-yomi" },
] as const;
export type PaceId = (typeof PACES)[number]["id"];
export const paceById = (id: PaceId) => PACES.find((pace) => pace.id === id)!;

export const BOARD_SIZES = [
  { size: 9, label: "Quick game" },
  { size: 13, label: "Middle ground" },
  { size: 19, label: "The full board" },
] as const satisfies readonly { size: BoardSize; label: string }[];

const portrait = {
  ayu: "/assets/characters/ayu-portrait-v2.png",
  auburn: "/assets/characters/auburn-rival-portrait-v1.png",
  ponytail: "/assets/characters/ponytail-rival-portrait-v2.png",
  silver: "/assets/characters/silver-forelock-rival-portrait-v1.png",
  seeker: "/assets/player-black.png",
  wayfarer: "/assets/player-white.png",
};

export const PLAYER = {
  name: "Broody",
  rank: "12 kyu",
  portrait: portrait.seeker,
};

export type Table = {
  id: string;
  host: string;
  note: string;
  rank: string;
  size: BoardSize;
  pace: PaceId;
  presence: Presence;
  portrait: string;
};

// The creator takes seat 0 and plays black, so every open seat is white.
export const TABLES: Table[] = [
  {
    id: "moss",
    host: "MossGarden",
    note: "A quiet game.",
    rank: "9 kyu",
    size: 9,
    pace: "casual",
    presence: "online",
    portrait: portrait.ponytail,
  },
  {
    id: "lantern",
    host: "StoneLantern",
    note: "New players welcome!",
    rank: "14 kyu",
    size: 13,
    pace: "ranked-turn",
    presence: "away",
    portrait: portrait.silver,
  },
  {
    id: "river",
    host: "QuietRiver",
    note: "Let’s have a good game.",
    rank: "6 kyu",
    size: 19,
    pace: "ranked-byoyomi",
    presence: "online",
    portrait: portrait.wayfarer,
  },
  {
    id: "moongate",
    host: "MoonGate",
    note: "Deep games, kind people.",
    rank: "2 dan",
    size: 19,
    pace: "casual",
    presence: "online",
    portrait: portrait.ayu,
  },
  {
    id: "koi",
    host: "KoiPond",
    note: "Teaching game. Ask anything.",
    rank: "1 dan",
    size: 9,
    pace: "casual",
    presence: "online",
    portrait: portrait.auburn,
  },
  {
    id: "ashen",
    host: "AshenFan",
    note: "Fighting spirit welcome.",
    rank: "4 kyu",
    size: 13,
    pace: "ranked-byoyomi",
    presence: "online",
    portrait: portrait.seeker,
  },
];

export const FRIENDS: {
  name: string;
  presence: Presence;
  detail: string;
  portrait: string;
}[] = [
  {
    name: "WillowGo",
    presence: "online",
    detail: "Online",
    portrait: portrait.auburn,
  },
  {
    name: "Sora",
    presence: "playing",
    detail: "In a game · 19 × 19",
    portrait: portrait.wayfarer,
  },
  {
    name: "Hanami",
    presence: "online",
    detail: "Online",
    portrait: portrait.ponytail,
  },
  {
    name: "PineNeedle",
    presence: "away",
    detail: "Away",
    portrait: portrait.silver,
  },
];

export type ChatMessage = { time: string; name: string; text: string };

export const CHAT: ChatMessage[] = [
  { time: "21:12", name: "MoonGate", text: "table’s open if anyone wants a slow one" },
  { time: "21:14", name: "Sora", text: "what a beautiful evening for a game" },
  { time: "21:15", name: "WillowGo", text: "indeed! good games everyone :)" },
];

export const ACTIVITY = { players: 128, games: 34 };
