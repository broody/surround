import { CHARACTERS } from "../../../../shared/lobby.ts";
import { handleOf, useAnchors, useHandles, useProfileRanks } from "../wallet/rated";
import { shortAddress } from "../wallet/WalletButton";
import RankChart, { chartPoints } from "./RankChart";

/** How many of a player's newest rated games the lobby card charts, each with its own dot. */
const RECENT = 20;
const same = (a: string, b: string) => Boolean(a && b) && BigInt(a) === BigInt(b);

/**
 * The lobby card's rank chart: how `player`'s rank moved over their newest
 * rated games, how far it moved, and a link to their page for all of them.
 */
export default function RankTrend({ player, handle }: { player: string; handle?: string | null }) {
  const ranks = useProfileRanks(player, RECENT);
  const anchors = useAnchors();
  const runs = ranks.data?.ranks ?? [];
  const handles = useHandles(runs.map((r) => r.opponent ?? ""));
  if (!ranks.data) return null;

  const nameOf = (who: string) => {
    const anchor = anchors.data?.find((a) => same(a.player, who));
    const character = anchor?.id ? CHARACTERS.find((c) => c.id === anchor.id) : undefined;
    return character?.name ?? handleOf(handles, who) ?? (who ? shortAddress(who) : "someone");
  };
  const points = chartPoints(runs, ranks.data.total, nameOf);
  const moved = points.length > 1 ? points[points.length - 1].shown - points[0].shown : 0;

  return (
    <div className="rank-trend">
      {points.length > 1 && (
        <div className="rank-trend-row">
          <span className="live-muted">Rank · last {points.length} rated games</span>
          <span className={`rank-trend-moved ${moved > 0 ? "up" : moved < 0 ? "down" : ""}`}>
            {moved ? `${moved > 0 ? "▲ +" : "▼ −"}${(Math.abs(moved) / 10).toFixed(1)}` : "Level"}
          </span>
        </div>
      )}
      <RankChart points={points} compact />
      {points.length > 1 && (
        <div className="rank-trend-row">
          <span className="live-muted rank-trend-key">
            <span className="won">●</span> won <span className="lost">●</span> lost
          </span>
          <a href={`#player/${handle ?? player}`}>
            {ranks.data.total > points.length ? `All ${ranks.data.total.toLocaleString()} games →` : "Full history →"}
          </a>
        </div>
      )}
    </div>
  );
}
