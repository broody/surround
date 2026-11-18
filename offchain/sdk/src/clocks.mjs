// Surround's clocks: each board's byo-yomi, the preset a timed game on it
// names, and how players read it. No dependencies, so the web can load it with
// the page; index.mjs builds the clock settings from it (`byoyomiPresets`).

/**
 * Surround's byo-yomi by board size, for rated games and timed casual ones:
 * main time, then periods.
 */
export const BYOYOMI = {
  9: { main_ms: 300_000, periods: 3, period_ms: 30_000 },
  13: { main_ms: 600_000, periods: 3, period_ms: 30_000 },
  19: { main_ms: 1_200_000, periods: 5, period_ms: 30_000 },
};
/** The clock preset a timed game on a `size` board names. */
export const byoyomiPreset = size => `byoyomi-${size}`;
/** The board a byo-yomi preset is for, or null for another clock. */
export const presetSize = clock => {
  const size = /^byoyomi-(\d+)$/.exec(clock ?? '')?.[1];
  return size && BYOYOMI[size] ? Number(size) : null;
};
/** A byo-yomi as players read it: "5 min + 3 × 30 s". */
export const byoyomiLabel = ({ main_ms, periods, period_ms }) =>
  `${main_ms / 60_000} min + ${periods} × ${period_ms / 1000} s`;
