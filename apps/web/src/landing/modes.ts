export const MODES = [
  {
    id: "online",
    number: "01",
    title: "The Dojo",
    category: "HUMANS & AI",
    description: "Meet a rival. Find your level. Grow together.",
    action: "Enter the multiplayer lobby",
  },
  {
    id: "study",
    number: "02",
    title: "Study mode",
    category: "LEARN & EXPLORE",
    description: "Learn the game, one move at a time.",
    action: "Open the study board",
  },
  {
    id: "story",
    number: "03",
    title: "Story mode",
    category: "SINGLE PLAYER",
    status: "Coming soon",
    description: "A quiet journey through new rivals.",
    action: "Discover the story",
  },
] as const;

export type ModeId = (typeof MODES)[number]["id"];
