import { useRef, useState } from "react";
import { rankLabel } from "../wallet/rated";

/** A rank after one rated game: `shown` in tenths (0 = 30k, 300 = 1d), and what to say about the game on hover. */
export type RankChartPoint = { shown: number; at: number; opponent: string; result: string };

const W = 640,
  H = 220,
  LEFT = 44,
  RIGHT = 36,
  TOP = 16,
  BOTTOM = 28;
/** Gridlines every five ranks. */
const STEP = 50;
const dateOf = (at: number) => new Date(at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * A player's rank over their rated games, one point per game (equally
 * spaced: games, not days), stronger upward. Hover shows each game; a
 * screen reader gets the same as a table.
 */
export default function RankChart({ points }: { points: RankChartPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  if (points.length < 2)
    return <p className="live-muted">Your rank over time shows here after a few rated games.</p>;

  const shown = points.map((p) => p.shown);
  const lo = Math.floor((Math.min(...shown) - 10) / STEP) * STEP;
  const hi = Math.ceil((Math.max(...shown) + 10) / STEP) * STEP;
  const x = (i: number) => LEFT + (i * (W - LEFT - RIGHT)) / (points.length - 1);
  const y = (tenths: number) => TOP + ((hi - tenths) * (H - TOP - BOTTOM)) / (hi - lo);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.shown).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)},${H - BOTTOM}L${x(0).toFixed(1)},${H - BOTTOM}Z`;
  const grid = Array.from({ length: (hi - lo) / STEP + 1 }, (_, i) => lo + i * STEP);
  const last = points.length - 1;
  const at = hover ?? null;

  const track = (event: React.PointerEvent) => {
    const box = svg.current!.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - LEFT) / (W - LEFT - RIGHT)) * (points.length - 1));
    setHover(Math.max(0, Math.min(last, i)));
  };

  return (
    <div className="rank-chart">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Rank over ${points.length} rated games, from ${rankLabel(points[0].shown)} to ${rankLabel(points[last].shown)}`}
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
        <text className="rank-chart-axis" x={LEFT} y={H - 8}>
          {dateOf(points[0].at)}
        </text>
        <text className="rank-chart-axis" x={W - RIGHT} y={H - 8} textAnchor="end">
          {dateOf(points[last].at)}
        </text>
        <path className="rank-chart-area" d={area} />
        <path className="rank-chart-line" d={line} />
        {at !== null && <line className="rank-chart-crosshair" x1={x(at)} x2={x(at)} y1={TOP} y2={H - BOTTOM} />}
        <circle className="rank-chart-dot" cx={x(at ?? last)} cy={y(points[at ?? last].shown)} r={4} />
        {at === null && (
          <text className="rank-chart-label" x={x(last) + 8} y={y(points[last].shown) + 4}>
            {rankLabel(points[last].shown)}
          </text>
        )}
      </svg>
      {at !== null && (
        <div
          className="rank-chart-tip"
          style={{ left: `${(x(at) / W) * 100}%`, top: `${(y(points[at].shown) / H) * 100}%` }}
          role="status"
        >
          <strong>{rankLabel(points[at].shown)}</strong>
          <span>
            {points[at].result} vs {points[at].opponent}
          </span>
          <span>{dateOf(points[at].at)}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>Rank after each rated game</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Opponent</th>
            <th>Result</th>
            <th>Rank after</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td>{dateOf(p.at)}</td>
              <td>{p.opponent}</td>
              <td>{p.result}</td>
              <td>{rankLabel(p.shown)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
