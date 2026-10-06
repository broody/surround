import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowLeft, Flag, RotateCcw } from "lucide-react";
import { Button, Dialog, LinkButton, Panel, StoneDot } from "../components/ui";
import BoardCanvas from "../game/BoardCanvas";
import { areaScore, colorName, coordinate, groupAt, type Color } from "../game/rules";
import { CHARACTERS, levelName, type Character } from "../../../../shared/lobby.ts";
import { characterPortrait, type Emotion } from "../lobby/characterArt";
import CharacterPortrait from "../lobby/CharacterPortrait";
import { LobbyHeader } from "../lobby/LobbyPage";
import { useWallet } from "../wallet/WalletProvider";
import { MATCHMAKER_URL, useRatedPlayer } from "../wallet/rated";
import { shortAddress } from "../wallet/WalletButton";
import { RatedFlow } from "./flow.ts";
import { MIN_RATED_STEPS, PLAYING, RatedGame, SCORING, browserStore } from "./game.ts";
import { readPointer, writePointer, type RatedPointer } from "./pointer.ts";
import "../lobby/lobby.css";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clockText = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** A rated game on Starknet against an AI anchor, played from this browser. */
export default function RatedMatchPage({ digest }: { digest: string }) {
  const { address, signTypedData } = useWallet();
  const [pointer, setPointer] = useState<RatedPointer | null>(null);
  const [game, setGame] = useState<RatedGame | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const confirm = useRef<HTMLDialogElement>(null);
  const player = useRatedPlayer(game?.finished ? address : undefined);

  // Load the game this wallet started here, wait for the keeper to hold it,
  // then follow it until it is over.
  useEffect(() => {
    if (!address) return;
    const found = readPointer(address);
    if (!found || found.digest !== digest) {
      setPointer(null);
      return;
    }
    setPointer(found);
    const stop = new AbortController();
    (async () => {
      const store = browserStore();
      let pairing = found.pairing;
      if (!pairing.ready) {
        const flow = new RatedFlow({ address, signTypedData }, { matchmaker: MATCHMAKER_URL, store });
        const ready = await flow.waitReady(digest, { signal: stop.signal });
        if (stop.signal.aborted) return;
        if (!ready) {
          setGone(true);
          return;
        }
        pairing = ready;
        writePointer(address, { ...found, pairing });
      }
      const opened = await RatedGame.open(pairing, store);
      if (stop.signal.aborted) return;
      setGame(opened);
      while (!stop.signal.aborted && !opened.finished) {
        try {
          await opened.sync({ wait: 20, signal: stop.signal });
          setError("");
        } catch (e) {
          if (stop.signal.aborted) return;
          setError(`The keeper can't be reached: ${(e as Error).message}`);
          await pause(2000);
        }
        rerender();
      }
      if (opened.finished) writePointer(address, { ...found, pairing, finished: true });
      rerender();
    })().catch((e) => setError((e as Error).message));
    return () => stop.abort();
  }, [address, digest, signTypedData]);

  // The clock ticks while the game is on.
  useEffect(() => {
    if (!game || game.finished) return;
    const timer = setInterval(rerender, 250);
    return () => clearInterval(timer);
  }, [game, game?.finished]);

  const act = useCallback(
    async (step: () => Promise<unknown>) => {
      if (!game || busy) return;
      setBusy(true);
      setError("");
      try {
        await step();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
        rerender();
      }
    },
    [game, busy],
  );

  const character: Character | undefined = CHARACTERS.find((c) => c.id === pointer?.characterId);
  const opponentName = character?.name ?? "Your opponent";
  const position = game?.position;
  const myColor: Color = game?.seat === 1 ? 2 : 1;
  const scoring = game?.phase === SCORING;
  const proposal = game?.proposal;
  const theirProposal = Boolean(scoring && proposal?.proposed && game?.due === game?.seat);
  const proposing = Boolean(scoring && !proposal?.proposed && game?.due === game?.seat);
  const dead = theirProposal ? proposal!.dead : proposing ? selected : new Set<number>();
  const count = useMemo(() => {
    if (!position || !game || !scoring) return null;
    const area = areaScore(position.board, dead);
    return { black: area.black, white: area.white + game.komi };
  }, [position, game, scoring, dead]);

  if (!address)
    return (
      <Shell>
        <Panel className="match-waiting">
          <h1>Connect your wallet to return to this game.</h1>
          <p>Rated games are played with the wallet that started them.</p>
        </Panel>
      </Shell>
    );
  if (!pointer)
    return (
      <Shell>
        <Panel className="match-waiting">
          <h1>This game isn't in this browser.</h1>
          <p>
            A rated game is played from the browser that started it: its
            session key never leaves it.
          </p>
          <LinkButton variant="primary" href="#lobby">
            Back to the Dojo
          </LinkButton>
        </Panel>
      </Shell>
    );
  if (gone)
    return (
      <Shell>
        <Panel className="match-waiting">
          <h1>The game didn't start.</h1>
          <p>Both sides must sign the game's terms within a minute. Try again from the Dojo.</p>
          <LinkButton variant="primary" href="#lobby">
            Back to the Dojo
          </LinkButton>
        </Panel>
      </Shell>
    );
  if (!game || !position)
    return (
      <Shell error={error}>
        <p role="status">{error ? "" : `Waiting for ${opponentName} to sign and the referee to take the game…`}</p>
      </Shell>
    );

  const now = Date.now();
  const { left, flagAt } = game.clock(now);
  const myTurn = game.myTurn;
  const finished = game.finished;
  const won = finished && game.winner === myColor;
  const emotion: Emotion = finished
    ? game.winner === myColor
      ? "defeated"
      : "excited"
    : scoring || position.moves.at(-1)?.point === null
      ? "serene"
      : !myTurn && !game.pending
        ? "thinking"
        : "normal";
  const portrait = character && characterPortrait(character, emotion);
  const short = game.steps < MIN_RATED_STEPS;
  const rated = player.data && pointer.gamesBefore < player.data.games;
  const status = finished
    ? `${game.winner === 0 ? "A draw" : `${colorName(game.winner as Color)} wins`} ${game.reason}`
    : scoring
      ? theirProposal
        ? `${opponentName} proposed the final count`
        : proposing
          ? "Mark the dead stones, then propose the count"
          : `${opponentName} is counting…`
      : myTurn
        ? `${colorName(myColor)} to play · your turn`
        : game.pending
          ? "The referee is stamping your move…"
          : `${opponentName} is thinking…`;
  const seats = [0, 1].map((seat) => ({
    seat,
    mine: seat === game.seat,
    name: seat === game.seat ? `${shortAddress(address)} · you` : opponentName,
    detail: seat === game.seat ? "Your wallet" : character ? `${levelName(character.rank)} · AI` : "AI",
    clock: left ? clockText(left[seat]) : null,
  }));
  return (
    <Shell error={error} onRetry={() => setError("")}>
      <div className="live-match-grid">
        <div>
          <div className="match-seats">
            {seats.map((s) => (
              <Panel key={s.seat} className="match-seat">
                <StoneDot color={s.seat === 0 ? "black" : "white"} />
                <div>
                  <strong>{s.name}</strong>
                  <span>
                    {s.detail}
                    {s.clock && !finished ? ` · ${s.clock}${game.due === s.seat && flagAt ? " ⏱" : ""}` : ""}
                  </span>
                </div>
                {!s.mine && portrait && <CharacterPortrait src={portrait} alt="" />}
              </Panel>
            ))}
          </div>
          <div className="match-status" aria-live="polite">
            <h1>{status}</h1>
            <span>Move {position.moves.length}</span>
          </div>
          <div className="match-board">
            <BoardCanvas
              position={position}
              coordinates
              readOnly={busy || !(myTurn && (game.phase === PLAYING || proposing))}
              dead={dead}
              onPlay={(point) => {
                if (point === null) return;
                if (proposing) {
                  if (!position.board[point]) return;
                  const group = groupAt(position.board, point).stones;
                  setSelected((current) => {
                    const next = new Set(current);
                    const marking = !next.has(point);
                    for (const stone of group) marking ? next.add(stone) : next.delete(stone);
                    return next;
                  });
                } else void act(() => game.play(point));
              }}
              onHover={() => {}}
              description={status}
              interactionLabel={
                proposing ? "Scoring. Use arrow keys and Enter to mark dead groups." : undefined
              }
            />
          </div>
          <p id="board-instructions" className="live-muted">
            {proposing
              ? "Select the dead groups, then propose the count."
              : game.resumed && !finished
                ? "Play resumed: two passes now end the game counting every stone on the board as alive. Capture dead stones before passing."
                : `60 seconds a move, timed by the referee. Leaving the game loses it on time. Games under ${MIN_RATED_STEPS} moves don't count.`}
          </p>
          <div className="match-actions">
            {!finished && game.phase === PLAYING && (
              <Button disabled={!myTurn || busy} onClick={() => void act(() => game.pass())}>
                Pass
              </Button>
            )}
            {!finished && (
              <Button disabled={busy} onClick={() => confirm.current?.showModal()}>
                <Flag size={15} /> Resign
              </Button>
            )}
            {finished && (
              <LinkButton variant="primary" href="#lobby">
                Back to the Dojo <ArrowLeft size={15} />
              </LinkButton>
            )}
          </div>
        </div>
        <aside className="match-sidebar">
          {character && portrait && (
            <Panel className="match-character">
              <CharacterPortrait src={portrait} alt={`${character.name}, your AI opponent, ${emotion}`} />
              <span className="lobby-badge">AI · RATED ON STARKNET</span>
              <h2>{character.name}</h2>
              <p>{character.style}</p>
              <blockquote>
                {finished
                  ? won
                    ? "Well played. There's always another game, and something new to learn."
                    : "Thank you for the game. Shall we try again sometime?"
                  : character.greeting}
              </blockquote>
            </Panel>
          )}
          {scoring && count && (
            <Panel className="match-count">
              <p className="live-eyebrow">THE FINAL COUNT</p>
              <h2>
                {count.black} — {count.white}
              </h2>
              <p>Black area · White area + {game.komi} komi</p>
              {theirProposal && (
                <>
                  <p>{opponentName} marked the dead stones shown. Accept to end the game, or resume to play it out.</p>
                  <Button variant="primary" disabled={busy} onClick={() => void act(() => game.accept())}>
                    Accept the count
                  </Button>
                  <Button disabled={busy || game.resumed} onClick={() => void act(() => game.resume())}>
                    <RotateCcw size={14} /> Resume play
                  </Button>
                </>
              )}
              {proposing && (
                <Button variant="primary" disabled={busy} onClick={() => void act(() => game.propose(selected))}>
                  Propose this count
                </Button>
              )}
            </Panel>
          )}
          {finished && (
            <Panel className="match-result">
              <p className="live-eyebrow">THANK YOU FOR THE GAME</p>
              <h2>{won ? "Well played." : "A game to learn from."}</h2>
              <p>{status}.</p>
              {short ? (
                <p>This game was too short to count: rated games need {MIN_RATED_STEPS} moves.</p>
              ) : rated ? (
                <p>
                  Rated onchain. Your rank is now{" "}
                  <strong>
                    {player.data!.rank}
                    {player.data!.provisional ? "?" : ""}
                  </strong>
                  .
                </p>
              ) : (
                <p className="live-muted" role="status">
                  The keeper settles the game onchain and SurroundRatings rates it, about five minutes from the
                  end. Your new rank shows here then.
                </p>
              )}
              <LinkButton variant="primary" href="#lobby">
                Back to the Dojo
              </LinkButton>
            </Panel>
          )}
          <Panel className="match-history">
            <p className="live-eyebrow">THE GAME SO FAR</p>
            <ol>
              {position.moves.slice(-12).map((move, index) => {
                const n = position.moves.length - Math.min(12, position.moves.length) + index;
                return (
                  <li key={n}>
                    <span>{n + 1}.</span>
                    <StoneDot color={move.color} />
                    <strong>{move.point === null ? "Pass" : coordinate(move.point, game.size)}</strong>
                    {move.captures > 0 && <span>+{move.captures}</span>}
                  </li>
                );
              })}
            </ol>
            {!position.moves.length && <p className="live-muted">An empty board. A new beginning.</p>}
          </Panel>
        </aside>
      </div>
      <Dialog ref={confirm} onCloseRequest={() => confirm.current?.close()} aria-labelledby="resign-title">
        <h2 id="resign-title">Resign this game?</h2>
        <p>
          {opponentName} wins by resignation.{" "}
          {short ? `Games under ${MIN_RATED_STEPS} moves don't count toward your rank.` : "It counts toward your rank."}
        </p>
        <div className="match-actions">
          <Button onClick={() => confirm.current?.close()}>Keep playing</Button>
          <Button
            variant="primary"
            onClick={() => {
              confirm.current?.close();
              void act(() => game.resign());
            }}
          >
            Resign
          </Button>
        </div>
      </Dialog>
    </Shell>
  );
}

function Shell({ children, error, onRetry }: { children: React.ReactNode; error?: string; onRetry?: () => void }) {
  return (
    <div className="live-page">
      <LobbyHeader />
      <main className="live-main live-match" id="main-content">
        <div className="lobby-section-heading">
          <LinkButton variant="text" href="#lobby">
            <ArrowLeft size={15} /> The Dojo
          </LinkButton>
          <span className="live-muted">Rated on Starknet Sepolia · 60 s a move</span>
        </div>
        {error && (
          <div className="live-error" role="alert">
            {error}
            {onRetry && (
              <Button size="sm" onClick={onRetry}>
                Dismiss
              </Button>
            )}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
