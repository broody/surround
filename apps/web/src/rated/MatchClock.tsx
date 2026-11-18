import { useEffect, useRef, useState, type ReactNode } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { IconButton, Panel, StoneDot, classNames } from "../components/ui";
import { clockEvent, clockLabel, clockSpeech, clockText, seatClock, type SeatClock } from "./clockFace.ts";
import { chime, readClockSound, tick, writeClockSound } from "./clockSound.ts";
import type { RatedGame } from "./game.ts";

/** How long a byo-yomi or period-used tag stays up. */
const TAG_MS = 4000;

type Tag = { text: string; until: number };

/**
 * Both players' clocks, as KGS shows them: the opponent above, you below,
 * each with captures and time; the one running is raised. Main time shows the
 * periods waiting as pips, then byo-yomi reads `0:24 (3)` with a bar for the
 * period. The last 10 seconds of a period flash and, on your clock, tick.
 */
export default function MatchClock({
  game,
  opponentName,
  captures,
  children,
}: {
  game: RatedGame;
  opponentName: string;
  captures: [number, number];
  children: ReactNode;
}) {
  const [sound, setSound] = useState(readClockSound);
  const before = useRef<(SeatClock | undefined)[]>([]);
  const tags = useRef<(Tag | undefined)[]>([]);
  const lastTick = useRef<number | null>(null);

  const settings = game.terms.clock?.settings ?? null;
  const now = Date.now();
  const { views } = game.clock(now);
  const clocks = settings && views ? views.map((view) => seatClock(view, settings)) : null;
  const due = game.finished ? null : game.due;

  // After each render (the page redraws four times a second): mark byo-yomi
  // beginning and periods used up, and tick each second of your warning.
  useEffect(() => {
    if (!clocks) return;
    const at = Date.now();
    clocks.forEach((clock, seat) => {
      const event = clockEvent(before.current[seat], clock);
      before.current[seat] = clock;
      if (!event) return;
      tags.current[seat] = {
        text: event === "byoyomi" ? "Byo-yomi" : clock.periods === 1 ? "Last period" : "Period used",
        until: at + TAG_MS,
      };
      if (sound && seat === game.seat) chime();
    });
    const mine = clocks[game.seat];
    if (sound && due === game.seat && mine.warn) {
      const second = Math.ceil(mine.ms / 1000);
      if (second !== lastTick.current && second > 0) tick(mine.low);
      lastTick.current = second;
    } else lastTick.current = null;
  });

  const label = clockLabel(settings);
  const row = (seat: 0 | 1) => {
    const clock = clocks?.[seat];
    const running = due === seat;
    const mine = seat === game.seat;
    const flash = Boolean(running && clock?.warn && clock.ms % 1000 >= 500);
    const event = tags.current[seat];
    const tag =
      event && event.until > now
        ? event.text
        : clock?.byoyomi && clock.periods === 1
          ? "Last period"
          : running && clock?.soon
            ? "Byo-yomi next"
            : null;
    return (
      <li
        key={seat}
        className={classNames(
          "match-clock-row",
          running && "is-running",
          clock?.low && "is-low",
          flash && "is-flash",
        )}
      >
        <StoneDot color={seat === 0 ? "black" : "white"} />
        <div className="match-clock-who">
          <span className="match-clock-name">
            <strong>{mine ? "You" : opponentName}</strong>
            {tag && (
              <span className={classNames("match-clock-tag", clock?.soon && !clock.byoyomi && "is-quiet")}>{tag}</span>
            )}
          </span>
          <span className="match-clock-sub">
            {captures[seat]} captured{running ? " · to play" : ""}
          </span>
        </div>
        {clock && (
          <div className="match-clock-time">
            <span role={running ? "timer" : undefined}>
              <span aria-hidden="true">{clockText(clock.ms)}</span>
              {clock.byoyomi && <small aria-hidden="true"> ({clock.periods})</small>}
              <span className="sr-only">{clockSpeech(clock)}</span>
            </span>
            {clock.byoyomi || clock.periods === null ? (
              clock.span > 0 && (
                <span className="match-clock-bar" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, (clock.ms / clock.span) * 100)}%` }} />
                </span>
              )
            ) : (
              <span className="match-clock-pips" aria-hidden="true">
                {Array.from({ length: clock.periods }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <Panel className="match-clock">
      <div className="match-clock-head">
        <p className="live-eyebrow">{label ? `CLOCK · ${label.toUpperCase()}` : "PLAYERS"}</p>
        {clocks && (
          <IconButton
            label={sound ? "Mute the clock" : "Unmute the clock"}
            aria-pressed={!sound}
            onClick={() => {
              writeClockSound(!sound);
              setSound(!sound);
            }}
          >
            {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </IconButton>
        )}
      </div>
      <ul className="match-clock-rows">{[game.seat === 0 ? 1 : 0, game.seat].map((seat) => row(seat as 0 | 1))}</ul>
      <div className="match-clock-actions">{children}</div>
    </Panel>
  );
}
