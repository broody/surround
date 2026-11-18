/** A seat's clock as the referee's time rules show it (`standardTime`'s view): this turn's time, main time, byo-yomi. */
export type ClockView = { turn: number; bank: number; periods: number; period: number };
/** A game's clock settings: `byoyomi` null for none. */
export type ClockSettings = { turn_ms: number; bank_ms: number; byoyomi: { periods: number; period_ms: number } | null };

/** How one seat's clock reads, as KGS shows it: main time, then `0:24 (3)`. */
export type SeatClock = {
  /** The time shown: main time, or once that is gone the period running. */
  ms: number;
  /** Byo-yomi periods left, the one running included; null for a clock without them. */
  periods: number | null;
  /** Whether main time is gone and the periods are running. */
  byoyomi: boolean;
  /** What the bar measures against: a period, or a clock without byo-yomi's whole time; 0 for no bar. */
  span: number;
  /** Red: the last period, or the last 10 seconds of a clock without byo-yomi. */
  low: boolean;
  /** Flash and tick: the last 10 seconds of a period, or of a clock without byo-yomi. */
  warn: boolean;
  /** Main time has 30 seconds or less left, with byo-yomi to follow. */
  soon: boolean;
};

const WARN_MS = 10_000;
const SOON_MS = 30_000;

/** One seat's clock: main time with its periods waiting, then the period running and how many are left. */
export function seatClock(view: ClockView, settings: ClockSettings): SeatClock {
  const main = Number(view.turn) + Number(view.bank);
  const byoyomi = settings.byoyomi;
  if (!byoyomi) {
    const warn = main <= WARN_MS;
    return {
      ms: main,
      periods: null,
      byoyomi: false,
      span: Number(settings.turn_ms) + Number(settings.bank_ms),
      low: warn,
      warn,
      soon: false,
    };
  }
  const periods = Number(view.periods);
  if (main > 0)
    return { ms: main, periods, byoyomi: false, span: 0, low: false, warn: false, soon: main <= SOON_MS };
  const period = periods > 0 ? Number(view.period) : 0;
  return {
    ms: period,
    periods,
    byoyomi: true,
    span: byoyomi.period_ms,
    low: periods <= 1,
    warn: period <= WARN_MS,
    soon: false,
  };
}

/** What changed between two readings of a seat's clock: byo-yomi began, or a period was used up. */
export function clockEvent(before: SeatClock | undefined, after: SeatClock): "byoyomi" | "period" | null {
  if (!before || before.periods === null || after.periods === null) return null;
  if (!before.byoyomi && after.byoyomi) return "byoyomi";
  // The last period running out ends the game on time: nothing to mark.
  if (before.byoyomi && after.periods < before.periods && after.periods > 0) return "period";
  return null;
}

/** A clock's time as players read it: `4:07`. */
export function clockText(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A seat's clock as a screen reader says it: "0:24 left in this period, 3 periods left". */
export function clockSpeech(clock: SeatClock) {
  const time = clockText(clock.ms);
  if (clock.periods === null) return `${time} left`;
  const periods = `${clock.periods} ${clock.periods === 1 ? "period" : "periods"}`;
  return clock.byoyomi ? `${time} left in this period, ${periods} left` : `${time} of main time, then ${periods}`;
}

/** A game's time control, short: "5 min + 3 × 30 s". */
export function clockLabel(settings: ClockSettings | null | undefined) {
  if (!settings) return "";
  const { turn_ms, bank_ms, byoyomi } = settings;
  const bank = Number(bank_ms);
  const main = bank % 60_000 ? `${Math.round(bank / 1000)} s` : `${bank / 60_000} min`;
  if (byoyomi) return `${main} + ${byoyomi.periods} × ${byoyomi.period_ms / 1000} s`;
  if (Number(turn_ms) && !Number(bank_ms)) return `${Number(turn_ms) / 1000} s a move`;
  return "";
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
