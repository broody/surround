export const MODES = [
  {
    id: "story",
    number: "01",
    title: "Story mode",
    category: "SINGLE PLAYER",
    status: "Coming soon",
    description: "A quiet journey through new rivals.",
    action: "Discover the story",
  },
  {
    id: "study",
    number: "02",
    title: "Study mode",
    category: "LEARN & EXPLORE",
    status: "Board preview",
    description: "Learn the game, one move at a time.",
    action: "Open the study board",
  },
  {
    id: "online",
    number: "03",
    title: "The playing hall",
    category: "HUMANS & AI",
    status: "Open for play",
    description: "Meet a rival. Find your level. Grow together.",
    action: "Enter the multiplayer lobby",
  },
] as const;

export type ModeId = (typeof MODES)[number]["id"];
export type PreviewMode = "story" | "online" | "ai";
export type Page = "home" | "play";

// Small hash router: normal anchors, deep links and browser back/forward all
// work without a routing dependency. The game state stays in the parent App.
export function pageFromHash(hash: string): Page {
  return hash === "#play" ? "play" : "home";
}
