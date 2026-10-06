import { useEffect, useState } from "react";
import { ArrowRight, Bot, ChevronLeft, Plus, Users } from "lucide-react";
import {
  Button,
  Input,
  LinkButton,
  Panel,
  Select,
} from "../components/ui";
import {
  CHARACTERS,
  PLACEMENT_GAMES,
  rankName,
  recommendedCharacter,
  type BoardSize,
  type Match,
} from "../../../../shared/lobby.ts";
import {
  enterLobby,
  openMatch,
  readSession,
  request,
  useLobby,
  useResource,
} from "./api";
import type { Lobby } from "../../../../shared/lobby.ts";
import { BoardGlyph, RankBadge } from "./LobbyParts";
import WalletButton from "../wallet/WalletButton";
import "./lobby.css";

export function LobbyHeader() {
  return (
    <header className="live-header">
      <a className="live-brand" href="#home">
        SURROUND<span>A GAME OF CONNECTION</span>
      </a>
      <nav aria-label="Main navigation">
        <LinkButton variant="text" href="#lobby">
          Play
        </LinkButton>
        <LinkButton variant="text" href="#study">
          Study
        </LinkButton>
        <LinkButton variant="text" href="#home">
          Home
        </LinkButton>
        <WalletButton />
      </nav>
    </header>
  );
}
export default function LobbyPage() {
  const [session, setSession] = useState(readSession);
  const resource = useLobby(Boolean(session));
  const publicStatus = useResource<{ humans: number; engine: Lobby["engine"] }>(
    "/status",
    !session,
    4000,
  );
  const lobby = resource.data;
  const [name, setName] = useState("");
  const [startRank, setStartRank] = useState("20k");
  const [size, setSize] = useState<BoardSize>(9);
  const [opponent, setOpponent] = useState("either");
  const [code, setCode] = useState(
    () =>
      new URLSearchParams(window.location.hash.split("?")[1]).get("invite") ??
      "",
  );
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    document.title = "Surround — The Dojo";
  }, []);
  useEffect(() => {
    if (lobby?.queued) setSearching(true);
    if (searching && lobby?.activeMatch)
      window.location.hash = `match/${lobby.activeMatch}`;
  }, [lobby, searching]);
  useEffect(() => {
    if (resource.error && !readSession()) setSession(null);
  }, [resource.error]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      resource.refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const player = lobby?.player ?? session?.player;
  const engine = lobby?.engine ?? publicStatus.data?.engine;
  const aiReady = engine?.state === "ready" && engine.human;
  const disabled =
    busy ||
    !resource.connected ||
    Boolean(lobby?.activeMatch) ||
    Boolean(lobby?.queued);
  const recommended = recommendedCharacter(player?.rank ?? "20k");
  return (
    <div className="live-page">
      <LobbyHeader />
      <main className="live-main" id="main-content">
        <div className="lobby-intro">
          <div>
            <p className="live-eyebrow">THE DOJO</p>
            <h1>A seat for everyone.</h1>
            <p>Meet a human rival, or find your level with a familiar face.</p>
          </div>
          <div className="lobby-census">
            <span>
              <Users size={16} />{" "}
              {lobby?.humans.length ?? publicStatus.data?.humans ?? 0} humans
              here
            </span>
            <span>
              <Bot size={16} /> {aiReady ? CHARACTERS.length : 0} AI opponents{" "}
              {engine?.state === "starting" ? "· warming up" : ""}
            </span>
          </div>
        </div>
        {(error || resource.error || (!session && publicStatus.error)) && (
          <div className="live-error" role="alert">
            {error || resource.error || (!session && publicStatus.error)}
            <Button
              size="sm"
              onClick={() => {
                setError("");
                resource.refresh();
                publicStatus.refresh();
              }}
            >
              Retry connection
            </Button>
          </div>
        )}
        {!session ? (
          <Panel className="lobby-welcome">
            <div>
              <p className="live-eyebrow">YOUR FIRST GAME STARTS HERE</p>
              <h2>Welcome to the Dojo.</h2>
              <p>
                Choose a name and a starting level. Five AI games establish your
                estimated rank; quick match picks the regular nearest your level.
              </p>
              <p className="live-muted">
                Your guest profile stays in this browser. Human games refine
                your rank after placement.
              </p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () =>
                  setSession(await enterLobby(name, startRank)),
                );
              }}
            >
              <label htmlFor="player-name">Your name</label>
              <Input
                id="player-name"
                autoComplete="nickname"
                minLength={2}
                maxLength={24}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                placeholder="How should we call you?"
              />
              <label htmlFor="start-rank">Starting level</label>
              <Select
                id="start-rank"
                value={startRank}
                onChange={(event) => setStartRank(event.target.value)}
              >
                <option value="20k">New to Go · 20 kyu</option>
                <option value="10k">Know the basics · 10 kyu</option>
                <option value="5k">Regular player · 5 kyu</option>
                <option value="1d">Experienced player · 1 dan</option>
              </Select>
              <Button variant="primary" size="lg" type="submit" disabled={busy}>
                {busy ? "Entering…" : "Enter the lobby"}
                <ArrowRight size={16} />
              </Button>
            </form>
          </Panel>
        ) : (
          <>
            <div className="lobby-top-grid">
              <Panel className="lobby-profile">
                <p className="live-eyebrow">YOUR PLACE IN THE DOJO</p>
                <div className="lobby-profile-name">
                  <h2>{player?.name}</h2>
                  <strong>
                    {rankName(player?.rank ?? "20k")}
                    <span>
                      {(player?.placementGames ?? 0) < PLACEMENT_GAMES
                        ? "provisional"
                        : "estimated rank"}
                    </span>
                  </strong>
                </div>
                <div
                  className="placement-dots"
                  aria-label={`${Math.min(player?.placementGames ?? 0, PLACEMENT_GAMES)} of ${PLACEMENT_GAMES} placement games completed`}
                >
                  {Array.from({ length: PLACEMENT_GAMES }, (_, i) => (
                    <i
                      key={i}
                      className={
                        i < (player?.placementGames ?? 0) ? "complete" : ""
                      }
                    />
                  ))}
                </div>
                <p>
                  {(player?.placementGames ?? 0) < PLACEMENT_GAMES
                    ? `${PLACEMENT_GAMES - (player?.placementGames ?? 0)} AI games to find your footing.`
                    : `${player?.wins} wins · ${player?.losses} losses · ${player?.games} games`}
                </p>
                {lobby?.activeMatch ? (
                  <LinkButton
                    variant="primary"
                    href={`#match/${lobby.activeMatch}`}
                  >
                    Return to your table <ArrowRight size={16} />
                  </LinkButton>
                ) : (
                  <Button
                    variant="primary"
                    disabled={disabled || !aiReady}
                    onClick={() =>
                      void run(async () =>
                        openMatch(
                          await request<Match>("/ai", {
                            size,
                            characterId: recommended.id,
                          }),
                        ),
                      )
                    }
                  >
                    {(player?.placementGames ?? 0) < PLACEMENT_GAMES
                      ? "Play a placement game"
                      : "Practice at my level"}
                    <ArrowRight size={16} />
                  </Button>
                )}
              </Panel>
              <Panel className="lobby-quick">
                <p className="live-eyebrow">FIND YOUR NEXT GAME</p>
                <h2>Pull up a chair.</h2>
                <div
                  className="lobby-size-options"
                  role="group"
                  aria-label="Board size"
                >
                  {([9, 13, 19] as const).map((value) => (
                    <Button
                      variant="tab"
                      key={value}
                      aria-pressed={size === value}
                      onClick={() => setSize(value)}
                      disabled={busy || Boolean(lobby?.queued)}
                    >
                      <BoardGlyph size={value} />
                      <span>
                        {value} × {value}
                      </span>
                    </Button>
                  ))}
                </div>
                <div className="lobby-quick-controls">
                  <label htmlFor="opponent-type" className="sr-only">
                    Opponent preference
                  </label>
                  <Select
                    id="opponent-type"
                    value={opponent}
                    onChange={(event) => setOpponent(event.target.value)}
                    disabled={Boolean(lobby?.queued)}
                  >
                    <option value="either">
                      Human or AI · first available
                    </option>
                    <option value="human">Human opponent</option>
                    <option value="ai">AI at my level</option>
                  </Select>
                  {lobby?.queued ? (
                    <Button
                      onClick={() =>
                        void run(async () => {
                          await request("/queue/cancel", {});
                          setSearching(false);
                        })
                      }
                      disabled={busy}
                    >
                      Cancel search
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      disabled={
                        disabled ||
                        (opponent !== "human" &&
                          !aiReady &&
                          !lobby?.tables.length)
                      }
                      onClick={() =>
                        void run(async () => {
                          if (opponent === "ai") {
                            openMatch(
                              await request<Match>("/ai", {
                                size,
                                characterId: recommended.id,
                              }),
                            );
                          } else {
                            const result = await request<{
                              match: Match | null;
                            }>("/queue", { size, opponent });
                            if (result.match) openMatch(result.match);
                            else setSearching(true);
                          }
                        })
                      }
                    >
                      Find a game <ArrowRight size={16} />
                    </Button>
                  )}
                </div>
                <p className="live-muted" role="status">
                  {lobby?.queued
                    ? "Looking for a human within three ranks of you…"
                    : "Untimed games · 6.5 komi · area scoring"}
                </p>
              </Panel>
            </div>
            <section className="lobby-roster" aria-labelledby="roster-title">
              <div className="lobby-section-heading">
                <div>
                  <p className="live-eyebrow">FAMILIAR FACES, NEW CHALLENGES</p>
                  <h2 id="roster-title">
                    The Dojo regulars <span className="lobby-badge">AI</span>
                  </h2>
                </div>
                <div className="lobby-roster-controls">
                  <LinkButton variant="text" size="sm" href="#characters">
                    Meet the cast
                  </LinkButton>
                </div>
              </div>
              <p className="live-muted">
                Each plays at a fixed level, so their ranks are the yardstick
                yours is measured against.{" "}
                {aiReady
                  ? "Always a game waiting for you."
                  : "AI tables are unavailable while the engine warms up."}
              </p>
              <div className="character-grid">
                {CHARACTERS.map((character) => (
                  <Panel
                    as="article"
                    className="character-card"
                    key={character.id}
                  >
                    <div className="character-art">
                      <img
                        src={character.portrait}
                        alt={character.name}
                        loading="lazy"
                      />
                      <RankBadge rank={character.rank} />
                    </div>
                    <div className="character-copy">
                      <span className="lobby-badge">AI OPPONENT</span>
                      <h3>{character.name}</h3>
                      <p>{character.style}</p>
                      <q>{character.greeting}</q>
                      <Button
                        disabled={disabled || !aiReady}
                        onClick={() =>
                          void run(async () =>
                            openMatch(
                              await request<Match>("/ai", {
                                characterId: character.id,
                                size,
                              }),
                            ),
                          )
                        }
                      >
                        Play {character.name.split(" ")[0]}
                        <ArrowRight size={14} />
                      </Button>
                    </div>
                  </Panel>
                ))}
              </div>
            </section>
            <div className="lobby-bottom-grid">
              <Panel className="lobby-human-tables">
                <div className="lobby-section-heading">
                  <div>
                    <p className="live-eyebrow">PLAY TOGETHER</p>
                    <h2>Open human tables</h2>
                  </div>
                  <Button
                    disabled={disabled}
                    onClick={() =>
                      void run(async () =>
                        openMatch(await request<Match>("/tables", { size })),
                      )
                    }
                  >
                    <Plus size={16} /> Open a table
                  </Button>
                </div>
                {!lobby?.tables.length ? (
                  <div className="lobby-empty">
                    <Users size={26} />
                    <p>
                      A quiet hall. Open a table for the next person who
                      arrives.
                    </p>
                  </div>
                ) : (
                  <ul className="live-table-list">
                    {lobby.tables.map((table) => (
                      <li key={table.id}>
                        <div>
                          <strong>{table.host.name}</strong>
                          <span>
                            {rankName(table.host.rank)} · {table.size} ×{" "}
                            {table.size} · Ranked
                          </span>
                        </div>
                        <Button
                          disabled={disabled || table.host.id === player?.id}
                          onClick={() =>
                            void run(async () =>
                              openMatch(
                                await request<Match>("/join", { id: table.id }),
                              ),
                            )
                          }
                        >
                          Join <ArrowRight size={14} />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="live-muted">
                  {lobby?.humans
                    .filter((human) => human.id !== player?.id)
                    .map(
                      (human) =>
                        `${human.name}${human.playing ? " (playing)" : ""}`,
                    )
                    .join(" · ") ||
                    "You're the first here. The AI regulars are happy to play."}
                </p>
              </Panel>
              <Panel className="lobby-private">
                <p className="live-eyebrow">A GAME BETWEEN FRIENDS</p>
                <h2>Your own table.</h2>
                <p>Create an invitation or enter a friend's code.</p>
                <Button
                  disabled={disabled}
                  onClick={() =>
                    void run(async () =>
                      openMatch(
                        await request<Match>("/tables", {
                          size,
                          private: true,
                        }),
                      ),
                    )
                  }
                >
                  Create private table <Plus size={16} />
                </Button>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () =>
                      openMatch(
                        await request<Match>("/join", {
                          code: code.replace(/[^a-z0-9]/gi, "").toUpperCase(),
                        }),
                      ),
                    );
                  }}
                >
                  <label className="sr-only" htmlFor="invite-code">
                    Invitation code
                  </label>
                  <Input
                    id="invite-code"
                    placeholder="Invitation code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    maxLength={16}
                    required
                  />
                  <Button type="submit" disabled={disabled}>
                    Join
                  </Button>
                </form>
              </Panel>
            </div>
          </>
        )}
        <footer className="live-footer">
          <LinkButton variant="text" href="#home">
            <ChevronLeft size={14} /> Back to the gardens
          </LinkButton>
          <span>Take your time. Every game is a beginning.</span>
        </footer>
      </main>
    </div>
  );
}
