import { useEffect, useState } from "react";
import { ArrowRight, Bot, ChevronLeft, Copy, Plus, Users } from "lucide-react";
import { Button, Input, LinkButton, Panel, Select } from "../components/ui";
import { CHARACTERS, type BoardSize } from "../../../../shared/lobby.ts";
import { BoardGlyph, RankBadge } from "./LobbyParts";
import BrandLogo from "../components/BrandLogo";
import WalletButton, { shortAddress } from "../wallet/WalletButton";
import RatedProfile from "../wallet/RatedProfile";
import AnchorButtons from "../rated/AnchorButtons";
import { useRated } from "../rated/RatedProvider";
import { useWallet } from "../wallet/WalletProvider";
import { clockLabel, handleOf, useBands, useHandles } from "../wallet/rated";
import "./lobby.css";

export function LobbyHeader() {
  return (
    <header className="live-header">
      <a className="live-brand" href="#home" aria-label="Surround home">
        <BrandLogo compact />
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

/** A rank in tenths (0 = 30k, 300 = 1d), as SurroundRatings shows it. */
const rankLabel = (tenths: number) => {
  const r = Math.floor(tenths / 10);
  return r < 30 ? `${30 - r}k` : `${r - 29}d`;
};

/** The invite in this page's address (`#lobby?invite=…`), if any. */
const inviteInHash = () => new URLSearchParams(window.location.hash.split("?")[1]).get("invite") ?? "";

/**
 * The Dojo: one way in (a wallet, an activated account, a profile, a week's
 * sign-in), then every game through the matchmaker: the quick match, open
 * tables and invites, rated or casual, and the AI regulars.
 */
export default function LobbyPage() {
  const { address } = useWallet();
  const {
    ready, census, anchors, tables, waiting, hosting, starting, error, clearError,
    queue, leave, host, closeTable, join,
  } = useRated();
  const info = useBands();
  const [rated, setRated] = useState(true);
  const [size, setSize] = useState<BoardSize>(9);
  const [clock, setClock] = useState("turn");
  const [code, setCode] = useState(inviteInHash);
  const [copied, setCopied] = useState(false);
  const clocks = rated ? Object.keys(info.data?.clocks ?? { turn: null }) : (info.data?.casual?.clocks ?? ["untimed", "turn"]);
  const hosts = useHandles(tables.data?.map((t) => t.host) ?? []);
  useEffect(() => {
    document.title = "Surround — The Dojo";
  }, []);
  useEffect(() => {
    if (!clocks.includes(clock)) setClock(clocks[0]);
  }, [clocks, clock]);

  const busy = starting !== null;
  const waitingHere = Boolean(waiting || hosting);
  const ask = { rated, size, clock };
  const invite = hosting?.private
    ? `${window.location.origin}${window.location.pathname}#lobby?invite=${hosting.table}`
    : null;
  const open = (tables.data ?? []).filter((t) => !address || BigInt(t.host) !== BigInt(address));

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
              <Users size={16} /> {census.data?.waiting ?? 0} waiting · {census.data?.playing ?? 0} games in play
            </span>
            <span>
              <Bot size={16} /> {anchors.data?.length ?? 0} AI opponents
            </span>
          </div>
        </div>
        {error && (
          <div className="live-error" role="alert">
            {error}
            <Button size="sm" onClick={clearError}>
              Dismiss
            </Button>
          </div>
        )}
        {!address ? (
          <Panel className="lobby-welcome">
            <div>
              <p className="live-eyebrow">YOUR FIRST GAME STARTS HERE</p>
              <h2>Welcome to the Dojo.</h2>
              <p>
                Connect a wallet to play. You'll choose a handle and a
                starting level once, and every game you play, rated or
                casual, is yours to come back to.
              </p>
            </div>
            <div>
              <WalletButton />
            </div>
          </Panel>
        ) : (
          <RatedProfile />
        )}
        {ready && (
          <>
            <div className="lobby-top-grid">
              <Panel className="lobby-quick">
                <p className="live-eyebrow">FIND YOUR NEXT GAME</p>
                <h2>Pull up a chair.</h2>
                <div className="lobby-size-options" role="group" aria-label="Rated or casual">
                  {[true, false].map((value) => (
                    <Button
                      variant="tab"
                      key={String(value)}
                      aria-pressed={rated === value}
                      onClick={() => setRated(value)}
                      disabled={busy || waitingHere}
                    >
                      {value ? "Rated" : "Casual"}
                    </Button>
                  ))}
                </div>
                <div className="lobby-size-options" role="group" aria-label="Board size">
                  {([9, 13, 19] as const).map((value) => (
                    <Button
                      variant="tab"
                      key={value}
                      aria-pressed={size === value}
                      onClick={() => setSize(value)}
                      disabled={busy || waitingHere}
                    >
                      <BoardGlyph size={value} />
                      <span>
                        {value} × {value}
                      </span>
                    </Button>
                  ))}
                </div>
                <div className="lobby-quick-controls">
                  <label htmlFor="game-clock" className="sr-only">
                    Clock
                  </label>
                  <Select
                    id="game-clock"
                    value={clock}
                    onChange={(event) => setClock(event.target.value)}
                    disabled={busy || waitingHere}
                  >
                    {clocks.map((name) => (
                      <option key={name} value={name}>
                        {clockLabel(name)}
                      </option>
                    ))}
                  </Select>
                  {waiting ? (
                    <Button onClick={() => void leave()} disabled={busy}>
                      Cancel search
                    </Button>
                  ) : (
                    <Button variant="primary" disabled={busy || Boolean(hosting)} onClick={() => void queue(ask)}>
                      {starting === "queue" ? "Signing…" : "Find a game"} <ArrowRight size={16} />
                    </Button>
                  )}
                </div>
                <div className="lobby-quick-controls">
                  {hosting ? (
                    <Button onClick={() => void closeTable()} disabled={busy}>
                      Close your table
                    </Button>
                  ) : (
                    <>
                      <Button disabled={busy || Boolean(waiting)} onClick={() => void host(ask)}>
                        <Plus size={16} /> Open a table
                      </Button>
                      {!rated && (
                        <Button disabled={busy || Boolean(waiting)} onClick={() => void host({ ...ask, private: true })}>
                          <Plus size={16} /> Invite a friend
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {invite && (
                  <div className="lobby-quick-controls">
                    <Input readOnly value={invite} aria-label="Invitation link" onFocus={(e) => e.target.select()} />
                    <Button
                      onClick={() =>
                        void navigator.clipboard?.writeText(invite).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        })
                      }
                    >
                      <Copy size={14} /> {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                )}
                <p className="live-muted" role="status">
                  {waiting
                    ? `Looking for a ${waiting.rated ? "rated" : "casual"} game near your rank…`
                    : hosting
                      ? hosting.private
                        ? "Your private table is open: send the link to a friend."
                        : `Your ${hosting.rated ? "rated" : "casual"} table is open: waiting for someone to sit down.`
                      : rated
                        ? "Rated games are settled on Starknet and count toward your rank."
                        : "Casual games count for nothing: no rank, nothing onchain."}
                </p>
              </Panel>
              <Panel className="lobby-private">
                <p className="live-eyebrow">A GAME BETWEEN FRIENDS</p>
                <h2>Join an invitation.</h2>
                <p>Paste the link or the code a friend sent you.</p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const id = code.trim().split("invite=").pop()!.replace(/[^a-f0-9]/gi, "").toLowerCase();
                    void join(id);
                  }}
                >
                  <label className="sr-only" htmlFor="invite-code">
                    Invitation code
                  </label>
                  <Input
                    id="invite-code"
                    placeholder="Invitation code or link"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    required
                  />
                  <Button type="submit" disabled={busy || waitingHere}>
                    {starting === "join" ? "Signing…" : "Join"}
                  </Button>
                </form>
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
                Each plays at a fixed level, so their ranks are the yardstick yours is measured against. A rated
                game counts toward your rank; a casual one is untimed and counts for nothing.
              </p>
              <div className="character-grid">
                {CHARACTERS.map((character) => (
                  <Panel as="article" className="character-card" key={character.id}>
                    <div className="character-art">
                      <img src={character.portrait} alt={character.name} loading="lazy" />
                      <RankBadge rank={character.rank} />
                    </div>
                    <div className="character-copy">
                      <span className="lobby-badge">AI OPPONENT</span>
                      <h3>{character.name}</h3>
                      <p>{character.style}</p>
                      <q>{character.greeting}</q>
                      <AnchorButtons characterId={character.id} size={size} />
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
                    <h2>Open tables</h2>
                  </div>
                </div>
                {!open.length ? (
                  <div className="lobby-empty">
                    <Users size={26} />
                    <p>A quiet hall. Open a table for the next person who arrives.</p>
                  </div>
                ) : (
                  <ul className="live-table-list">
                    {open.map((table) => (
                      <li key={table.id}>
                        <div>
                          <strong>{handleOf(hosts, table.host) ?? shortAddress(table.host)}</strong>
                          <span>
                            {rankLabel(table.shown)} · {table.size} × {table.size} · {clockLabel(table.clock)} ·{" "}
                            {table.rated ? "Rated" : "Casual"}
                          </span>
                        </div>
                        <Button disabled={busy || waitingHere} onClick={() => void join(table.id)}>
                          Join <ArrowRight size={14} />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
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
