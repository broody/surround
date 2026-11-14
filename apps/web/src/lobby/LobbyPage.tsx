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
import { clockLabel, handleOf, rankLabel, useBands, useHandles } from "../wallet/rated";
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


/** Games between people (the quick match, tables, invites) are hidden for now: play is against the AI regulars only. */
const PVP: boolean = false;

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
          </div>
          <div className="lobby-census">
            <span>
              <Users size={16} /> {census.data?.playing ?? 0} games in play
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
              <h2>Welcome to the Dojo.</h2>
              <p>Connect a wallet to play.</p>
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
            {PVP && (
            <div className="lobby-top-grid">
              <Panel className="lobby-quick">
                <h2>Find a game</h2>
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
                    ? `Looking for a ${waiting.rated ? "rated" : "casual"} game…`
                    : hosting
                      ? hosting.private
                        ? "Send the link to a friend."
                        : "Waiting for someone to sit down."
                      : null}
                </p>
              </Panel>
              <Panel className="lobby-private">
                <h2>Join an invitation</h2>
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
            )}
            <section className="lobby-roster" aria-labelledby="roster-title">
              <div className="lobby-section-heading">
                <div>
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
              <div className="character-grid">
                {CHARACTERS.map((character) => (
                  <Panel as="article" className="character-card" key={character.id}>
                    <div className="character-art">
                      <img src={character.portrait} alt={character.name} loading="lazy" />
                      <RankBadge rank={character.rank} />
                    </div>
                    <div className="character-copy">
                      <h3>{character.name}</h3>
                      <q>{character.greeting}</q>
                      <AnchorButtons characterId={character.id} />
                    </div>
                  </Panel>
                ))}
              </div>
            </section>
            {PVP && (
            <div className="lobby-bottom-grid">
              <Panel className="lobby-human-tables">
                <div className="lobby-section-heading">
                  <div>
                    <h2>Open tables</h2>
                  </div>
                </div>
                {!open.length ? (
                  <div className="lobby-empty">
                    <Users size={26} />
                    <p>No open tables.</p>
                  </div>
                ) : (
                  <ul className="live-table-list">
                    {open.map((table) => (
                      <li key={table.id}>
                        <div>
                          <strong>
                            <a href={`#player/${handleOf(hosts, table.host) ?? table.host}`}>
                              {handleOf(hosts, table.host) ?? shortAddress(table.host)}
                            </a>
                          </strong>
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
            )}
          </>
        )}
        <footer className="live-footer">
          <LinkButton variant="text" href="#home">
            <ChevronLeft size={14} /> Back to the gardens
          </LinkButton>
        </footer>
      </main>
    </div>
  );
}
