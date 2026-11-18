import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowLeft, Flag, RotateCcw } from "lucide-react";
import { Button, Dialog, LinkButton, Panel, StoneDot } from "../components/ui";
import BoardCanvas from "../game/BoardCanvas";
import { areaScore, colorName, groupAt, type Color, type Move } from "../game/rules";
import { CHARACTERS, levelName, type Character } from "../../../../shared/lobby.ts";
import { characterPortrait, type Emotion } from "../lobby/characterArt";
import CharacterPortrait from "../lobby/CharacterPortrait";
import { LobbyHeader } from "../lobby/LobbyPage";
import { useWallet } from "../wallet/WalletProvider";
import { MATCHMAKER_URL, RATINGS_ADDRESS, handleOf, useHandles, useRatedPlayer } from "../wallet/rated";
import { shortAddress } from "../wallet/WalletButton";
import { RatedFlow } from "./flow.ts";
import { MIN_RATED_STEPS, PLAYING, RatedGame, SCORING, browserStore } from "./game.ts";
import { readPointer, writePointer, type RatedPointer } from "./pointer.ts";
import { moodOf, useReportedMood, useSteadyMood } from "./mood.ts";
import { clockFace, clockNote } from "./clockFace.ts";
import "../lobby/lobby.css";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clockText = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * A game played from this browser: rated (settled and rated on Starknet) or
 * casual, against an AI anchor or a person.
 */
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
  const ratedGame = pointer?.rated !== false;
  const player = useRatedPlayer(game?.finished && ratedGame ? address : undefined);
  const handles = useHandles(pointer ? [pointer.anchor] : []);

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
        const flow = new RatedFlow(
          { address, signTypedData },
          { matchmaker: MATCHMAKER_URL, store, ratings: RATINGS_ADDRESS },
        );
        const ready = await flow.waitReady(digest, { signal: stop.signal });
        if (stop.signal.aborted) return;
        if (!ready) {
          // The matchmaker holds a pairing until its game is over: without it, this game is over
          // (or never began), and the Dojo must not keep sending this wallet back to it.
          writePointer(address, { ...found, finished: true });
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
  const opponentName = character?.name ?? handleOf(handles, pointer?.anchor) ??
    (pointer?.anchor ? shortAddress(pointer.anchor) : "Your opponent");
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
          <p>A game is played with the wallet that started it.</p>
        </Panel>
      </Shell>
    );
  if (!pointer)
    return (
      <Shell>
        <Panel className="match-waiting">
          <h1>This game isn't in this browser.</h1>
          <p>
            A game is played from the browser that started it: its session
            key never leaves it.
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
          <p>
            Both sides must sign the game's terms within a minute, and the referee must take the
            game. Try again from the Dojo.
          </p>
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
  const { views } = game.clock(now);
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
  const short = ratedGame && game.steps < MIN_RATED_STEPS;
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
  const due = game.due;
  const face = views && due !== null && due !== undefined && game.terms.clock ? clockFace(views[due], game.terms.clock.settings) : null;
  const low = Boolean(face?.low);
  const dueName = due === game.seat ? "YOUR" : `${opponentName.toUpperCase()}'S`;
  const note = proposing
    ? "Select the dead groups, then propose the count."
    : game.resumed && !finished
      ? "Play resumed: two passes now end the game counting every stone on the board as alive. Capture dead stones before passing."
      : null;
  return (
    <Shell error={error} onRetry={() => setError("")}>
      <div className="live-match-grid">
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
        {/* The board's keyboard help: shown only when it says something the page doesn't. */}
        <p id="board-instructions" className={note ? "match-note live-muted" : "sr-only"}>
          {note ??
            `${game.timed ? `${clockNote(game.terms.clock?.settings)} Leaving the game loses it on time. ` : ""}${
              ratedGame ? `Games under ${MIN_RATED_STEPS} moves don't count.` : ""
            }`}
        </p>
        <aside className="match-sidebar">
          {character && portrait ? (
            <Panel className="match-character">
              <OpponentPortrait
                character={character}
                digest={digest}
                base={emotion}
                final={finished || emotion === "serene"}
                moves={position.moves}
                ai={myColor === 1 ? 2 : 1}
                size={game.terms.config.size}
              />
              <span className="lobby-badge">
                {levelName(character.rank).toUpperCase()} · AI · {ratedGame ? "RATED" : "CASUAL"}
              </span>
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
          ) : (
            <Panel className="match-opponent">
              <p className="live-eyebrow">{ratedGame ? "RATED GAME" : "CASUAL GAME"}</p>
              <h2>{opponentName}</h2>
              <p>
                You play <StoneDot color={myColor === 1 ? "black" : "white"} /> {colorName(myColor)}
              </p>
            </Panel>
          )}
          {!finished && (
            <Panel className="match-clock">
              <p className="live-eyebrow">{dueName} TURN</p>
              {face && (
                <>
                  <div className="match-clock-time">
                    <span className={low ? "low" : undefined} role="timer" aria-label={`${clockText(face.ms)} left`}>
                      {clockText(face.ms)}
                    </span>
                    <span>
                      <StoneDot color={due === 0 ? "black" : "white"} /> {due === 0 ? "Black" : "White"}
                    </span>
                  </div>
                  {face.caption && <p className="match-clock-caption live-muted">{face.caption}</p>}
                  {face.span > 0 && (
                    <div className={low ? "match-clock-bar low" : "match-clock-bar"} aria-hidden="true">
                      <i style={{ width: `${Math.min(100, (face.ms / face.span) * 100)}%` }} />
                    </div>
                  )}
                </>
              )}
              <div className="match-clock-actions">
                {game.phase === PLAYING && (
                  <Button disabled={!myTurn || busy} onClick={() => void act(() => game.pass())}>
                    Pass
                  </Button>
                )}
                <Button disabled={busy} onClick={() => confirm.current?.showModal()}>
                  <Flag size={15} /> Resign
                </Button>
              </div>
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
              {!ratedGame ? (
                <p className="live-muted">A casual game: nothing onchain, and no rank changed.</p>
              ) : short ? (
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
        </aside>
      </div>
      <Dialog ref={confirm} onCloseRequest={() => confirm.current?.close()} aria-labelledby="resign-title">
        <h2 id="resign-title">Resign this game?</h2>
        <p>
          {opponentName} wins by resignation.{" "}
          {!ratedGame
            ? "A casual game: no rank changes."
            : short
              ? `Games under ${MIN_RATED_STEPS} moves don't count toward your rank.`
              : "It counts toward your rank."}
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

/**
 * The AI's face (./mood.ts): how the game is going (its own mood, as it tells
 * the matchmaker, and big captures) over whose turn it is, steadied so it
 * doesn't flicker with every turn; a game's end shows at once.
 */
function OpponentPortrait({
  character,
  digest,
  base,
  final,
  moves,
  ai,
  size,
}: {
  character: Character;
  digest: string;
  base: Emotion;
  final: boolean;
  moves: Move[];
  ai: Color;
  size: number;
}) {
  const reported = useReportedMood(MATCHMAKER_URL, digest, !final);
  const { emotion, urgent } = moodOf({ base, final, moves, ai, size, reported });
  const shown = useSteadyMood(emotion, urgent);
  return <CharacterPortrait src={characterPortrait(character, shown)} alt={`${character.name}, your AI opponent, ${shown}`} />;
}
