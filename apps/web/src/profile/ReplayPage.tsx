import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pause, Play } from "lucide-react";
import { Button, IconButton, Input, LinkButton, Panel, StoneDot } from "../components/ui";
import BoardCanvas from "../game/BoardCanvas";
import { coordinate, type Color } from "../game/rules";
import { CHARACTERS } from "../../../../shared/lobby.ts";
import { LobbyHeader } from "../lobby/LobbyPage";
import { shortAddress } from "../wallet/WalletButton";
import { handicapLabel, handleOf, useAnchors, useGameRecord, useHandles } from "../wallet/rated";
import { replayOf, resultText, type ReplayEnd } from "./replay";
import "../lobby/lobby.css";
import "./profile-page.css";

/** How long each move shows while the replay plays. */
const STEP_MS = 900;
const same = (a?: string | null, b?: string | null) => Boolean(a && b) && BigInt(a!) === BigInt(b!);
const colorWord = (color: Color) => (color === 1 ? "Black" : "White");
const REASONS: Record<number, string> = {
  1: "by the count",
  2: "with the board played out",
  3: "at the move limit",
  128: "by resignation",
  129: "on time",
  130: "by abandonment",
};

/** How a game ended, in words, `name` naming each side: "Aki resigned", "Aki ran out of time", "Aki wins by 6.5". */
function endText(
  end: ReplayEnd | null,
  { winner, reason, voided }: { winner: number | null; reason: number | null; voided: number | null },
  name: (color: Color) => string,
) {
  // SurroundRatings' GameVoided reasons: 4, too short to rate.
  if (voided !== null) return voided === 4 ? "Void: too short to count" : "Void: it didn't count";
  if (end?.kind === "resign") return `${name(end.color)} resigned`;
  if (end?.kind === "time") return `${name(end.color)} ran out of time`;
  if (end?.kind === "count") {
    const margin = Math.abs(end.black - end.white);
    return margin ? `${name(end.black > end.white ? 1 : 2)} wins by ${margin}` : "A draw on the count";
  }
  if (winner === 0) return "A draw";
  if (winner === 1 || winner === 2) return `${name(winner)} wins${reason && REASONS[reason] ? ` ${REASONS[reason]}` : ""}`;
  return "Not rated yet";
}

/**
 * A finished game, move by move (`#replay/<id>`, the id a player's recent
 * games list it by): the board at any move, stepped through with the buttons,
 * the slider or the arrow keys, or played through.
 */
export default function ReplayPage({ id }: { id: string }) {
  const record = useGameRecord(id);
  const anchors = useAnchors();
  const data = record.data;
  const handles = useHandles(data ? [data.black, data.white] : []);
  const replay = useMemo(() => (data ? replayOf(data.steps, data.size, data.komi_half / 2, data.winner, data.handicap ?? 0) : null), [data]);
  const last = replay ? replay.positions.length - 1 : 0;
  const [move, setMove] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // A replay opens on the game's last move.
  const at = Math.min(move ?? last, last);
  const go = (to: number) => {
    setPlaying(false);
    setMove(Math.max(0, Math.min(last, to)));
  };

  const character = (who: string) => {
    const anchor = anchors.data?.find((a) => same(a.player, who));
    return anchor?.id ? CHARACTERS.find((c) => c.id === anchor.id) : undefined;
  };
  const nameOf = (who: string) => character(who)?.name ?? handleOf(handles, who) ?? shortAddress(who);

  useEffect(() => {
    document.title = data ? `Surround — ${nameOf(data.black)} vs ${nameOf(data.white)}` : "Surround — Replay";
  });

  useEffect(() => {
    if (!playing) return;
    if (at >= last) return setPlaying(false);
    const timer = setTimeout(() => setMove(at + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, at, last]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.altKey || event.ctrlKey || event.metaKey || target?.closest("input, textarea, select, [contenteditable]"))
        return;
      const to =
        event.key === "ArrowLeft" ? at - 1 : event.key === "ArrowRight" ? at + 1 : event.key === "Home" ? 0 : event.key === "End" ? last : null;
      if (to === null) return;
      event.preventDefault();
      go(to);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  if (!data || !replay)
    return (
      <Shell>
        <Panel className="profile-hero">
          <p role="status">
            {record.error === "No such game"
              ? "No game goes by that link."
              : record.error?.startsWith("No keeper")
                ? "This game's moves weren't kept, so it can't be replayed."
                : (record.error ?? "Reading the game…")}
          </p>
        </Panel>
      </Shell>
    );

  const position = replay.positions[at];
  const played = position.moves[at - 1];
  const ended = at === last;
  const heading = played
    ? played.point === null
      ? `${colorWord(played.color)} passes`
      : `${colorWord(played.color)} ${coordinate(played.point, data.size)}`
    : last
      ? "The empty board"
      : "No moves were played";
  const result = resultText(replay.end, data.winner);
  const dead = ended && replay.end?.kind === "count" ? replay.end.dead : undefined;
  const seat = (who: string, color: Color) => {
    const ai = character(who);
    return (
      <li>
        <StoneDot color={color === 1 ? "black" : "white"} />
        <span>
          {ai ? ai.name : <a href={`#player/${handleOf(handles, who) ?? who}`}>{nameOf(who)}</a>}
        </span>
        <small className="live-muted" title="Stones captured so far">
          {position.captures[color - 1]} captured
        </small>
      </li>
    );
  };

  return (
    <Shell>
      <div className="live-match-grid replay-grid">
        <div className="match-status" aria-live="polite">
          <h1>{heading}</h1>
          <span>
            Move {at} of {last}
          </span>
        </div>
        <div className="match-board">
          <BoardCanvas
            position={position}
            coordinates
            readOnly
            dead={dead}
            onPlay={() => {}}
            onHover={() => {}}
            description={`${heading}. Move ${at} of ${last}.`}
          />
        </div>
        <div id="board-instructions" className="replay-controls">
          <Input
            type="range"
            min={0}
            max={last}
            value={at}
            onChange={(event) => go(Number(event.target.value))}
            aria-label="Move"
            aria-valuetext={`Move ${at} of ${last}: ${heading}`}
          />
          <div className="replay-buttons">
            <IconButton label="First move" disabled={at === 0} onClick={() => go(0)}>
              <ChevronsLeft size={16} />
            </IconButton>
            <IconButton label="Previous move" disabled={at === 0} onClick={() => go(at - 1)}>
              <ChevronLeft size={16} />
            </IconButton>
            <Button
              variant="primary"
              disabled={!last}
              onClick={() => {
                if (playing) return setPlaying(false);
                if (at >= last) setMove(0);
                setPlaying(true);
              }}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />} {playing ? "Pause" : at >= last ? "Replay" : "Play"}
            </Button>
            <IconButton label="Next move" disabled={at >= last} onClick={() => go(at + 1)}>
              <ChevronRight size={16} />
            </IconButton>
            <IconButton label="Last move" disabled={at >= last} onClick={() => go(last)}>
              <ChevronsRight size={16} />
            </IconButton>
          </div>
          <p className="live-muted">← → to step through the game.</p>
        </div>
        <aside className="match-sidebar">
          <Panel className="match-opponent replay-players">
            <p className="live-eyebrow">
              {data.kind === "rated" ? "RATED GAME" : "CASUAL GAME"} · {data.size} × {data.size}
            </p>
            <ul>
              {seat(data.black, 1)}
              {seat(data.white, 2)}
            </ul>
            <p className="live-muted">
              {handicapLabel(data.handicap ?? 0) ? `${handicapLabel(data.handicap ?? 0)} · ` : ""}Komi {data.komi_half / 2} ·{" "}
              {new Date(data.at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </p>
          </Panel>
          <Panel className="match-result">
            <p className="live-eyebrow">RESULT</p>
            <h2>{result || "—"}</h2>
            <p>{endText(replay.end, data, (color) => nameOf(color === 1 ? data.black : data.white))}.</p>
            {!ended && (
              <Button onClick={() => go(last)}>
                See the end
              </Button>
            )}
          </Panel>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="live-page">
      <LobbyHeader />
      <main className="live-main live-match" id="main-content">
        <div className="lobby-section-heading">
          {window.history.length > 1 ? (
            <Button variant="text" onClick={() => window.history.back()}>
              <ArrowLeft size={15} /> Back
            </Button>
          ) : (
            <LinkButton variant="text" href="#lobby">
              <ArrowLeft size={15} /> The Dojo
            </LinkButton>
          )}
        </div>
        {children}
      </main>
    </div>
  );
}

