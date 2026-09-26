export const MODES = [
  {
    id: "story",
    number: "01",
    title: "Story mode",
    category: "SINGLE PLAYER",
    status: "Coming soon",
    description:
      "An engaging single-player journey. New rivals. Your next chapter.",
    action: "Discover the story",
  },
  {
    id: "study",
    number: "02",
    title: "Study mode",
    category: "LEARN & EXPLORE",
    status: "Board preview",
    description: "Start from zero. Learn the game, study positions, and grow.",
    action: "Open the study board",
  },
  {
    id: "online",
    number: "03",
    title: "Online P2P",
    category: "SETTLED ON STARKNET",
    status: "Coming soon",
    description:
      "Challenge a rival. Play for real rewards. Settle on Starknet.",
    action: "Explore online play",
  },
] as const;

export type ModeId = (typeof MODES)[number]["id"];
export type PreviewMode = "story" | "online" | "ai";
export type Page = "home" | "study";

// Small hash router: normal anchors, deep links and browser back/forward all
// work without a routing dependency. The game state stays in the parent App.
export function pageFromHash(hash: string): Page {
  return hash === "#study" ? "study" : "home";
}
