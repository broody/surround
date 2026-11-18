/** A seat's clock as the referee's time rules show it (`standardTime`'s view): this turn's time, main time, byo-yomi. */
export type ClockView = { turn: number; bank: number; periods: number; period: number };
/** A game's clock settings: `byoyomi` null for none. */
export type ClockSettings = { turn_ms: number; bank_ms: number; byoyomi: { periods: number; period_ms: number } | null };

/**
 * What the clock panel shows for the seat due: its main time (with what
 * follows it, in byo-yomi), or once that is gone the period running and how
 * many are left. `span` is what the bar measures against; `low` turns it
 * red: the last 10 seconds of a period, or of the only time there is.
 */
export function clockFace(view: ClockView, settings: ClockSettings) {
  const main = Number(view.turn) + Number(view.bank);
  const byoyomi = settings.byoyomi;
  const periods = Number(view.periods);
  if (!byoyomi || main > 0 || periods === 0)
    return {
      ms: main,
      span: Number(settings.turn_ms) + Number(settings.bank_ms),
      low: !byoyomi && main <= 10_000,
      caption: byoyomi && periods > 0 ? `then ${periods} × ${byoyomi.period_ms / 1000} s` : null,
    };
  return {
    ms: Number(view.period),
    span: byoyomi.period_ms,
    low: Number(view.period) <= 10_000,
    caption: periods === 1 ? "Byo-yomi · last period" : `Byo-yomi · ${periods} periods`,
  };
}

/** A game's clock as players read it, for the page's note. */
export function clockNote(settings: ClockSettings | null | undefined) {
  if (!settings) return "";
  const { turn_ms, bank_ms, byoyomi } = settings;
  if (byoyomi)
    return `${Number(bank_ms) / 60_000} minutes each, then ${byoyomi.periods} periods of ${byoyomi.period_ms / 1000} seconds, timed by the referee.`;
  if (Number(turn_ms) && !Number(bank_ms)) return `${Number(turn_ms) / 1000} seconds a move, timed by the referee.`;
  return "Timed by the referee.";
}
