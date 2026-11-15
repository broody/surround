import { useRef, useState } from "react";
import { rankLabel, type RankRun } from "../wallet/rated";
import "./RankChart.css";

/**
 * A point on the chart: a run of one or more rated games in a row, the rank
 * after the last (`shown`, tenths: 0 = 30k, 300 = 1d) and the lowest and
 * highest after any, when the first and last were played, and what to say
 * about it on hover.
 */
export type RankChartPoint = {
  shown: number;
  low: number;
  high: number;
  from: number;
  at: number;
  games: number;
  /** A single game's result, which colours its dot. */
  result?: "won" | "lost" | "drew";
  /** "Won vs yuna", or "Games 1,201–1,215 · 9 won · 6 lost". */
  detail: string;
};

/**
 * The chart's points from the matchmaker's runs (GET /profiles/:id/ranks):
 * `total` is the player's rated games, so a run says which games it covers;
 * `nameOf` names an opponent.
 */
export function chartPoints(runs: RankRun[], total: number, nameOf: (player: string) => string): RankChartPoint[] {
  let first = total - runs.reduce((n, r) => n + r.games, 0) + 1;
  return runs.map((run) => {
    const start = first;
    first += run.games;
    const base = {
      shown: run.shown,
      low: run.low,
      high: run.high,
      from: run.first_at,
      at: run.played_at,
      games: run.games,
    };
    if (run.games === 1 && run.score !== undefined) {
      const result = run.score === 2 ? "won" : run.score === 1 ? "drew" : "lost";
      const said = result === "won" ? "Won" : result === "lost" ? "Lost" : "Drew";
      return {
        ...base,
        result,
        detail: `${said} vs ${nameOf(run.opponent ?? "")}`,
      };
    }
    const record = [`${run.wins} won`, `${run.losses} lost`, ...(run.draws ? [`${run.draws} drawn`] : [])].join(" · ");
    return {
      ...base,
      detail: `Games ${start.toLocaleString()}–${(first - 1).toLocaleString()} · ${record}`,
    };
  });
}

/** A chart's size: the profile page's, or the lobby card's (no dates, fewer gridlines). */
const SIZES = {
  full: { W: 640, H: 220, LEFT: 44, RIGHT: 36, TOP: 16, BOTTOM: 28, LINES: 5 },
  compact: {
    W: 420,
    H: 150,
    LEFT: 40,
    RIGHT: 34,
    TOP: 12,
    BOTTOM: 12,
    LINES: 3,
  },
};
/** Gridline spacings to choose from, in tenths: one rank, two, five, ten, twenty. */
const STEPS = [10, 20, 50, 100, 200];
/** Up to this many single games, each gets a dot coloured by its result. */
const DOTS = 60;

const DAY = 86_400;
const dateOf = (at: number, year = false) =>
  new Date(at * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(year && { year: "numeric" }),
  });
const datesOf = (p: RankChartPoint) => (p.games > 1 ? `${dateOf(p.from)} – ${dateOf(p.at)}` : dateOf(p.at));

/**
 * A player's rank over their rated games, stronger upward, one point per
 * game, or per run of games for a long history (equally spaced: games, not
 * days), with the range each run passed through as a band. Hover shows each
 * point; a screen reader gets the same as a table.
 */
export default function RankChart({ points, compact = false }: { points: RankChartPoint[]; compact?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const { W, H, LEFT, RIGHT, TOP, BOTTOM, LINES } = SIZES[compact ? "compact" : "full"];

  if (points.length < 2)
    return compact ? (
      <div className="rank-chart-empty">
        <svg viewBox="0 0 420 60" aria-hidden="true">
          <path className="rank-chart-ghost" d="M12,36L70,28L130,42L190,22L250,32L310,16L380,26" />
        </svg>
        <p className="live-muted">Your rank line starts with your first rated games.</p>
      </div>
    ) : (
      <p className="live-muted">Your rank over time shows here after a few rated games.</p>
    );

  const runs = points.some((p) => p.games > 1);
  const dots = !runs && points.length <= DOTS;
  // A little room around the line, never below 30k (0): the scale's floor.
  const min = Math.max(0, Math.min(...points.map((p) => p.low)) - 5),
    max = Math.max(...points.map((p) => p.high)) + 5;
  const step = STEPS.find((s) => Math.ceil(max / s) - Math.floor(min / s) <= LINES - 1) ?? STEPS.at(-1)!;
  const lo = Math.floor(min / step) * step;
  const hi = Math.max(lo + step, Math.ceil(max / step) * step);
  const last = points.length - 1;
  const x = (i: number) => LEFT + (i * (W - LEFT - RIGHT)) / last;
  const y = (tenths: number) => TOP + ((hi - tenths) * (H - TOP - BOTTOM)) / (hi - lo);
  const pt = (i: number, tenths: number) => `${x(i).toFixed(1)},${y(tenths).toFixed(1)}`;
  const line = points.map((p, i) => `${i ? "L" : "M"}${pt(i, p.shown)}`).join("");
  const area = `${line}L${x(last).toFixed(1)},${H - BOTTOM}L${x(0).toFixed(1)},${H - BOTTOM}Z`;
  const band = `M${points.map((p, i) => pt(i, p.high)).join("L")}L${points
    .map((p, i) => pt(i, p.low))
    .reverse()
    .join("L")}Z`;
  const grid = Array.from({ length: (hi - lo) / step + 1 }, (_, i) => lo + i * step);
  const years = points[last].at - points[0].from > 300 * DAY;
  const at = hover;

  const track = (event: React.PointerEvent) => {
    const box = svg.current!.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - LEFT) / (W - LEFT - RIGHT)) * last);
    setHover(Math.max(0, Math.min(last, i)));
  };

  return (
    <div className="rank-chart">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Rank over ${points.reduce((n, p) => n + p.games, 0)} rated games, from ${rankLabel(points[0].shown)} to ${rankLabel(points[last].shown)}`}
        onPointerMove={track}
        onPointerLeave={() => setHover(null)}
      >
        {grid.map((tenths) => (
          <g key={tenths}>
            <line className="rank-chart-grid" x1={LEFT} x2={W - RIGHT} y1={y(tenths)} y2={y(tenths)} />
            <text className="rank-chart-axis" x={LEFT - 8} y={y(tenths) + 4} textAnchor="end">
              {rankLabel(tenths)}
            </text>
          </g>
        ))}
        {!compact && (
          <>
            <text className="rank-chart-axis" x={LEFT} y={H - 8}>
              {dateOf(points[0].from, years)}
            </text>
            <text className="rank-chart-axis" x={W - RIGHT} y={H - 8} textAnchor="end">
              {dateOf(points[last].at, years)}
            </text>
          </>
        )}
        {runs ? <path className="rank-chart-band" d={band} /> : <path className="rank-chart-area" d={area} />}
        <path className="rank-chart-line" d={line} />
        {at !== null && <line className="rank-chart-crosshair" x1={x(at)} x2={x(at)} y1={TOP} y2={H - BOTTOM} />}
        {dots &&
          points.map((p, i) =>
            i === last ? null : (
              <circle
                key={i}
                className={`rank-chart-game ${p.result ?? ""}`}
                cx={x(i)}
                cy={y(p.shown)}
                r={i === at ? 4.5 : 3}
              />
            ),
          )}
        <circle
          className="rank-chart-dot"
          cx={x(at ?? last)}
          cy={y(points[at ?? last].shown)}
          r={at === null || at === last ? 5 : 4}
        />
        {at === null && (
          <text className="rank-chart-label" x={x(last) + 8} y={y(points[last].shown) + 4}>
            {rankLabel(points[last].shown)}
          </text>
        )}
      </svg>
      {at !== null && (
        <div
          className="rank-chart-tip"
          style={{
            left: `${(x(at) / W) * 100}%`,
            top: `${(y(points[at].shown) / H) * 100}%`,
          }}
          role="status"
        >
          <strong>
            {points[at].games > 1 && points[at].low !== points[at].high
              ? `${rankLabel(points[at].shown)} · ${rankLabel(points[at].low)} to ${rankLabel(points[at].high)}`
              : rankLabel(points[at].shown)}
          </strong>
          <span>{points[at].detail}</span>
          <span>{datesOf(points[at])}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>Rank after each rated game{runs ? ", in runs of games" : ""}</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Games</th>
            <th>Rank after</th>
            {runs && <th>Lowest and highest</th>}
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td>{datesOf(p)}</td>
              <td>{p.detail}</td>
              <td>{rankLabel(p.shown)}</td>
              {runs && <td>{`${rankLabel(p.low)} to ${rankLabel(p.high)}`}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
