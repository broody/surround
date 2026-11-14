import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { BANDS } from "@surround/offchain/profile";
import { Button, LinkButton, Panel } from "../components/ui";
import { CHARACTERS } from "../../../../shared/lobby.ts";
import { LobbyHeader } from "../lobby/LobbyPage";
import { useWallet } from "../wallet/WalletProvider";
import { shortAddress } from "../wallet/WalletButton";
import {
  clockLabel,
  handleOf,
  rankLabel,
  useAnchors,
  useHandles,
  useProfileGames,
  useProfileRanks,
  useProfileView,
  type HistoryGame,
} from "../wallet/rated";
import RankChart from "./RankChart";
import PortraitDialog from "./PortraitDialog";
import "../lobby/lobby.css";
import "./profile-page.css";

const dateOf = (at: number) => new Date(at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const same = (a?: string | null, b?: string | null) => Boolean(a && b) && BigInt(a!) === BigInt(b!);

/** A game from `player`'s side: its opponent, and whether they won, lost or drew (null: not rated yet, or voided). */
function sideOf(game: HistoryGame, player: string) {
  const black = same(game.black, player);
  const opponent = (black ? game.white : game.black) ?? "";
  const mine = black ? 1 : 2;
  const result =
    game.voided !== null || game.winner === null ? null : game.winner === 0 ? "draw" : game.winner === mine ? "won" : "lost";
  return { opponent, result };
}

/**
 * A player's page (`#player/<handle or address>`): their portrait, handle and
 * rank, how their rank moved over their rated games, and their recent games,
 * rated and casual. On your own page you can change your portrait.
 */
export default function ProfilePage({ id }: { id: string }) {
  const { address } = useWallet();
  const view = useProfileView(id);
  const games = useProfileGames(id);
  const ranks = useProfileRanks(id);
  const anchors = useAnchors();
  const [portrait, setPortrait] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const data = view.data;
  const player = data?.profile.player ?? "";
  const mine = same(address, player);
  const list = games.data?.games ?? [];
  const history = ranks.data?.ranks ?? [];
  const handles = useHandles([...list.map((g) => sideOf(g, player).opponent), ...history.map((r) => r.opponent)]);
  useEffect(() => {
    document.title = data ? `Surround — ${data.profile.handle}` : "Surround — Player";
  }, [data]);
  useEffect(() => setPortrait(data?.profile.portrait ?? null), [data?.profile.portrait]);

  const character = (who: string) => {
    const anchor = anchors.data?.find((a) => same(a.player, who));
    return anchor?.id ? CHARACTERS.find((c) => c.id === anchor.id) : undefined;
  };
  const nameOf = (who: string) => character(who)?.name ?? handleOf(handles, who) ?? (who ? shortAddress(who) : "Someone");

  if (!data)
    return (
      <Shell>
        <Panel className="profile-hero">
          <p role="status">{view.error ? "No player goes by that name, or the matchmaker can't be reached." : "Reading the player…"}</p>
        </Panel>
      </Shell>
    );

  const account = data.account;
  // Each rated game's change of rank, in tenths, from the rank after the game before.
  const change = new Map(history.map((r, i) => [r.digest, i ? r.shown - history[i - 1].shown : null]));
  const best = history.length ? Math.max(...history.map((r) => r.shown)) : null;
  const decided = list.map((g) => sideOf(g, player).result).filter((r) => r !== null);
  const streakKind = decided[0];
  const streak = streakKind ? decided.findIndex((r) => r !== streakKind) : 0;
  const run = streak === -1 ? decided.length : streak;
  const points = history.map((r) => ({
    shown: r.shown,
    at: r.played_at,
    opponent: nameOf(r.opponent),
    result: r.score === 2 ? "Won" : r.score === 1 ? "Drew" : "Lost",
  }));

  return (
    <Shell>
      <Panel className="profile-hero">
        <div className="profile-portrait">
          {portrait ? (
            <img src={portrait} alt={`${data.profile.handle}'s portrait`} />
          ) : (
            <span className="profile-portrait-empty" aria-hidden="true">
              {data.profile.handle[0].toUpperCase()}
            </span>
          )}
        </div>
        <div className="profile-name">
          <p className="live-eyebrow">{mine ? "YOUR PROFILE" : "PLAYER"}</p>
          <h1>{data.profile.handle}</h1>
          <p className="live-muted">{shortAddress(player)}</p>
          {mine && (
            <div className="profile-actions">
              <Button size="sm" onClick={() => dialog.current?.showModal()}>
                {portrait ? "Change portrait" : "Add a portrait"}
              </Button>
              <LinkButton size="sm" variant="text" href="#lobby">
                Edit profile
              </LinkButton>
            </div>
          )}
        </div>
        <div className="profile-rank">
          {account.rated ? (
            <>
              <strong>
                {account.rank}
                {account.provisional && <span title="Provisional">?</span>}
              </strong>
              <span className="live-muted">Rank on Starknet</span>
            </>
          ) : (
            <>
              <strong>—</strong>
              <span className="live-muted">
                Unrated · starts at {BANDS[data.profile.band]?.replace("k", " kyu") ?? "a level of their choosing"}
              </span>
            </>
          )}
        </div>
      </Panel>

      <div className="profile-stats">
        <Stat label="Rated games" value={String(account.games)} />
        <Stat
          label="Won"
          value={account.games ? `${Math.round((100 * account.wins) / account.games)}%` : "—"}
          detail={`${account.wins} won · ${account.losses} lost${account.draws ? ` · ${account.draws} drawn` : ""}`}
        />
        <Stat label="Best rank" value={best === null ? "—" : rankLabel(best)} />
        <Stat
          label="Streak"
          value={run ? `${run} ${streakKind === "won" ? "won" : streakKind === "lost" ? "lost" : "drawn"}` : "—"}
          detail="Rated and casual"
        />
      </div>

      <div className="profile-grid">
        <Panel className="profile-panel">
          <p className="live-eyebrow">RANK OVER TIME</p>
          <h2>{history.length} rated games</h2>
          <RankChart points={points} />
        </Panel>
        <Panel className="profile-panel">
          <p className="live-eyebrow">RECENT GAMES</p>
          {!list.length ? (
            <p className="live-muted">No games yet.</p>
          ) : (
            <ul className="profile-games">
              {list.map((game) => {
                const { opponent, result } = sideOf(game, player);
                const ai = character(opponent);
                const moved = change.get(game.id);
                return (
                  <li key={game.id}>
                    <span className={`profile-result ${result ?? "none"}`}>
                      {result === "won" ? "Won" : result === "lost" ? "Lost" : result === "draw" ? "Drew" : game.voided !== null ? "Void" : "…"}
                    </span>
                    <span className="profile-opponent">
                      {ai && <img src={ai.portrait} alt="" />}
                      <span>
                        <span>
                          vs{" "}
                          {ai ? (
                            ai.name
                          ) : (
                            <a href={`#player/${handleOf(handles, opponent) ?? opponent}`}>{nameOf(opponent)}</a>
                          )}
                        </span>
                        <small className="live-muted">
                          {game.kind === "rated" ? "Rated" : "Casual"}
                          {game.size ? ` · ${game.size} × ${game.size}` : ""}
                          {game.clock ? ` · ${clockLabel(game.clock)}` : ""}
                        </small>
                      </span>
                    </span>
                    <span className="profile-change">
                      {moved ? `${moved > 0 ? "+" : "−"}${(Math.abs(moved) / 10).toFixed(1)}` : ""}
                    </span>
                    <span className="live-muted">{dateOf(game.at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
      {mine && <PortraitDialog ref={dialog} onClose={() => dialog.current?.close()} onUse={setPortrait} />}
    </Shell>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Panel className="profile-stat">
      <span className="live-muted">{label}</span>
      <strong>{value}</strong>
      {detail && <small className="live-muted">{detail}</small>}
    </Panel>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="live-page">
      <LobbyHeader />
      <main className="live-main" id="main-content">
        <div className="lobby-section-heading">
          <LinkButton variant="text" href="#lobby">
            <ArrowLeft size={15} /> The Dojo
          </LinkButton>
        </div>
        {children}
      </main>
    </div>
  );
}
