import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, Flag, RotateCcw } from "lucide-react";
import { Button, Dialog, LinkButton, Panel, StoneDot } from "../components/ui";
import BoardCanvas from "../game/BoardCanvas";
import { colorName, coordinate } from "../game/rules";
import { CHARACTERS, levelName, rankName, type Match } from "../../../../shared/lobby.ts";
import { characterPortrait, opponentEmotion } from "./characterArt";
import CharacterPortrait from "./CharacterPortrait";
import { APIError, readSession, request, useResource } from "./api";
import { LobbyHeader } from "./LobbyPage";
import "./lobby.css";

export default function MatchPage({ id }: { id: string }) {
  const session = readSession();
  const resource = useResource<Match>(`/matches/${id}`, Boolean(session), 1200);
  const match = resource.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const confirm = useRef<HTMLDialogElement>(null);
  const dead = useMemo(() => new Set(match?.dead), [match?.dead]);
  async function action(action: string, point?: number | null) {
    if (!match || busy || !resource.connected) return;
    setBusy(true);
    setError("");
    try {
      const submit = (version: number) =>
        request<Match>(`/matches/${id}`, {
          action,
          version,
          ...(point === undefined ? {} : { point }),
        });
      let result: Match;
      try {
        result = await submit(match.version);
      } catch (error) {
        // The other player may have accepted the same proposal since our
        // last poll. Reconcile that approval, but never accept changed stones.
        if (
          action !== "accept" ||
          !(error instanceof APIError) ||
          error.status !== 409
        )
          throw error;
        const current = await request<Match>(`/matches/${id}`);
        if (current.status === "finished") result = current;
        else if (
          current.status === "scoring" &&
          current.dead.join(",") === match.dead.join(",") &&
          current.score?.black === match.score?.black &&
          current.score?.white === match.score?.white
        ) {
          result = current.accepted.includes(session!.player.id)
            ? current
            : await submit(current.version);
        } else throw error;
      }
      resource.setData(result);
      resource.refresh();
    } catch (error) {
      setError((error as Error).message);
      resource.refresh();
    } finally {
      setBusy(false);
    }
  }
  const color = match?.black.id === session?.player.id ? 1 : 2;
  const character = CHARACTERS.find(
    (character) => character.id === match?.white?.characterId,
  );
  const scoring = match?.status === "scoring";
  const finished =
    match?.status === "finished" || match?.status === "cancelled";
  const canPlay =
    match?.status === "playing" &&
    match.position.turn === color &&
    !match.thinking &&
    !busy &&
    resource.connected;
  const emotion = opponentEmotion(match);
  const portrait = character && characterPortrait(character, emotion);
  const status = !match
    ? "Preparing your table…"
    : match.status === "waiting"
      ? "Waiting for your opponent"
      : match.status === "cancelled"
        ? "Table closed"
        : match.result
          ? `${colorName(match.result.winner)} wins${match.result.reason === "resign" ? " by resignation" : ` by ${match.result.margin} points`}`
          : match.error
            ? "The AI needs a moment"
            : scoring
              ? match.thinking
                ? "Counting the board…"
                : "Agree on the final score"
              : match.thinking
                ? `${character?.name ?? "Your opponent"} is thinking…`
                : `${colorName(match.position.turn)} to play${canPlay ? " · your turn" : ""}`;
  return (
    <div className="live-page">
      <LobbyHeader />
      <main className="live-main live-match" id="main-content">
        <div className="lobby-section-heading">
          <LinkButton variant="text" href="#lobby">
            <ArrowLeft size={15} /> The Dojo
          </LinkButton>
          <span className="live-muted">
            {match
              ? `${match.size} × ${match.size} · Untimed · ${match.komi} komi · ${match.placement ? "Placement" : match.ranked ? "Ranked" : "Practice"}`
              : "YOUR TABLE"}
          </span>
        </div>
        {(error || resource.error || match?.error) && (
          <div className="live-error" role="alert">
            {error || resource.error || match?.error}
            <Button
              size="sm"
              onClick={() => {
                if (match?.error) void action("retry");
                else {
                  setError("");
                  resource.refresh();
                }
              }}
              disabled={busy}
            >
              Retry
            </Button>
          </div>
        )}
        {!session ? (
          <Panel className="match-waiting">
            <h1>Enter the Dojo first.</h1>
            <LinkButton href="#lobby" variant="primary">
              Enter the lobby
            </LinkButton>
          </Panel>
        ) : !match ? (
          <p role="status">Preparing your table…</p>
        ) : (
          <div className="live-match-grid">
            <div>
              <div className="match-seats">
                {[match.black, match.white].map((seat, index) => (
                  <Panel key={index} className="match-seat">
                    <StoneDot color={index === 0 ? "black" : "white"} />
                    <div>
                      <strong>
                        {seat?.name ?? "An open seat"}
                        {seat?.id === session.player.id ? " · you" : ""}
                      </strong>
                      <span>
                        {seat
                          ? seat.kind === "ai"
                            ? `${levelName(seat.rank)} · AI`
                            : `${rankName(seat.rank)} · Human`
                          : "Waiting for a human"}
                      </span>
                    </div>
                    {seat?.kind === "ai" && portrait && (
                      <CharacterPortrait src={portrait} alt="" />
                    )}
                  </Panel>
                ))}
              </div>
              <div className="match-status" aria-live="polite">
                <h1>{status}</h1>
                <span>Move {match.position.moves.length}</span>
              </div>
              <div className="match-board">
                <BoardCanvas
                  position={match.position}
                  coordinates
                  readOnly={
                    !canPlay &&
                    !(scoring && !character && !busy && resource.connected)
                  }
                  dead={dead}
                  onPlay={(point) =>
                    void action(scoring ? "dead" : "move", point)
                  }
                  onHover={() => {}}
                  description={status}
                  interactionLabel={
                    scoring
                      ? "Scoring. Use arrow keys and Enter to select dead groups."
                      : undefined
                  }
                />
              </div>
              <p id="board-instructions" className="live-muted">
                {scoring && !character
                  ? "Select dead groups, then both players accept the count. Resume play if you disagree."
                  : "Arrow keys select an intersection. Enter plays a stone."}
              </p>
              <div className="match-actions">
                {!finished && match.status !== "waiting" && (
                  <>
                    <Button
                      disabled={!canPlay}
                      onClick={() => void action("move", null)}
                    >
                      Pass
                    </Button>
                    <Button
                      disabled={busy || !resource.connected}
                      onClick={() => confirm.current?.showModal()}
                    >
                      <Flag size={15} /> Resign
                    </Button>
                  </>
                )}
                {finished && (
                  <LinkButton variant="primary" href="#lobby">
                    Find your next game <ArrowLeft size={15} />
                  </LinkButton>
                )}
              </div>
            </div>
            <aside className="match-sidebar">
              {match.status === "waiting" ? (
                <Panel className="match-waiting">
                  <p className="live-eyebrow">
                    {match.code ? "YOUR PRIVATE TABLE" : "YOUR OPEN TABLE"}
                  </p>
                  <h2>There's a seat waiting.</h2>
                  <p>
                    {match.code
                      ? "Share this invitation with a friend. Your game begins when they join."
                      : "Your table is visible in the Dojo. Keep this page open while you wait."}
                  </p>
                  {match.code && (
                    <>
                      <strong className="match-code">
                        {match.code.slice(0, 6)}-{match.code.slice(6)}
                      </strong>
                      <Button
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(
                              `${window.location.origin}/#lobby?invite=${match.code}`,
                            )
                            .then(() => setCopied(true))
                            .catch(() =>
                              setError("Copy the invitation code shown above."),
                            );
                        }}
                      >
                        <Copy size={14} />{" "}
                        {copied ? "Invitation copied" : "Copy invitation"}
                      </Button>
                    </>
                  )}
                  <Button disabled={busy} onClick={() => void action("cancel")}>
                    Close table
                  </Button>
                </Panel>
              ) : (
                <>
                  {character && portrait && (
                    <Panel className="match-character">
                      <CharacterPortrait
                        src={portrait}
                        alt={`${character.name}, your AI opponent, ${emotion}`}
                      />
                      <span className="lobby-badge">AI OPPONENT</span>
                      <h2>{character.name}</h2>
                      <p>{character.style}</p>
                      <blockquote>
                        {match.result
                          ? match.result.winner === 1
                            ? "Well played. There's always another game, and something new to learn."
                            : "Thank you for the game. Shall we try again sometime?"
                          : character.greeting}
                      </blockquote>
                    </Panel>
                  )}
                  {scoring && (
                    <Panel className="match-count">
                      <p className="live-eyebrow">THE FINAL COUNT</p>
                      <h2>
                        {match.score?.black ?? "…"} —{" "}
                        {match.score?.white ?? "…"}
                      </h2>
                      <p>Black area · White area + {match.komi} komi</p>
                      <p>
                        {character
                          ? "Dead stones are marked by the AI. Resume to play out any disputed groups."
                          : `${match.accepted.length} of 2 players have accepted. Changing dead groups resets both approvals.`}
                      </p>
                      <Button
                        variant="primary"
                        disabled={
                          busy ||
                          match.thinking ||
                          Boolean(match.error) ||
                          match.accepted.includes(session.player.id) ||
                          !resource.connected
                        }
                        onClick={() => void action("accept")}
                      >
                        {match.accepted.includes(session.player.id)
                          ? "Waiting for agreement…"
                          : "Accept score"}
                      </Button>
                      <Button
                        disabled={busy || match.thinking || !resource.connected}
                        onClick={() => void action("resume")}
                      >
                        <RotateCcw size={14} /> Resume play
                      </Button>
                    </Panel>
                  )}
                  {match.result && (
                    <Panel className="match-result">
                      <p className="live-eyebrow">THANK YOU FOR THE GAME</p>
                      <h2>
                        {match.result.winner === color
                          ? "Well played."
                          : "A game to learn from."}
                      </h2>
                      <p>{status}.</p>
                      {match.result.rankChanges[session.player.id] && (
                        <p>
                          Your estimated rank is now{" "}
                          <strong>
                            {rankName(
                              match.result.rankChanges[session.player.id],
                            )}
                          </strong>
                          .
                        </p>
                      )}
                      {match.placement && match.result.rated && (
                        <p>
                          Placement progress is saved. Quick match now picks
                          the regular nearest your new level.
                        </p>
                      )}
                      {match.ranked && !match.result.rated && (
                        <p>
                          This game was too short to count toward rank. Play at
                          least {Math.min(20, match.size * 2)} stones between
                          both players for a rated result.
                        </p>
                      )}
                      <LinkButton variant="primary" href="#lobby">
                        Back to the hall
                      </LinkButton>
                    </Panel>
                  )}
                  <Panel className="match-history">
                    <p className="live-eyebrow">THE GAME SO FAR</p>
                    <ol>
                      {match.position.moves.slice(-12).map((move, index) => (
                        <li
                          key={
                            match.position.moves.length -
                            Math.min(12, match.position.moves.length) +
                            index
                          }
                        >
                          <span>
                            {match.position.moves.length -
                              Math.min(12, match.position.moves.length) +
                              index +
                              1}
                            .
                          </span>
                          <StoneDot color={move.color} />
                          <strong>
                            {move.point === null
                              ? "Pass"
                              : coordinate(move.point, match.size)}
                          </strong>
                          {move.captures > 0 && <span>+{move.captures}</span>}
                        </li>
                      ))}
                    </ol>
                    {!match.position.moves.length && (
                      <p className="live-muted">
                        An empty board. A new beginning.
                      </p>
                    )}
                  </Panel>
                </>
              )}
            </aside>
          </div>
        )}
        <Dialog
          ref={confirm}
          onCloseRequest={() => confirm.current?.close()}
          aria-labelledby="resign-title"
        >
          <h2 id="resign-title">Leave this game?</h2>
          <p>
            Your opponent wins by resignation.{" "}
            {match?.ranked
              ? "Substantial games update your rank; very short games do not."
              : "This is a practice game."}
          </p>
          <div className="match-actions">
            <Button onClick={() => confirm.current?.close()}>
              Keep playing
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                confirm.current?.close();
                void action("resign");
              }}
            >
              Resign
            </Button>
          </div>
        </Dialog>
      </main>
    </div>
  );
}
