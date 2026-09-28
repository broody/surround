import {
  boardSize,
  coordinate,
  pointFromCoordinate,
  type Color,
  type Position,
} from "./rules";

// Client for the dev server's KataGo bridge (katago/bridge.ts). The bridge
// exists only under `npm run dev` on a machine with KataGo configured; builds
// and other machines report KataGo as unavailable.

export const KOMI = 6.5;

/**
 * Ranks KataGo can imitate with its human SL network. Past a few dan the
 * network plays below the rank it imitates, since it doesn't read ahead.
 */
export const RANKS = [
  ...Array.from({ length: 20 }, (_, i) => `${20 - i}k`),
  ...Array.from({ length: 5 }, (_, i) => `${i + 1}d`),
];
export const rankName = (rank: string) =>
  `${rank.slice(0, -1)} ${rank.endsWith("k") ? "kyu" : "dan"}`;

async function request<T>(path: string, body?: object, signal?: AbortSignal) {
  const response = await fetch(
    `/api/katago${path}`,
    body && {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
  );
  const reply = await response.json().catch(() => null);
  if (!response.ok || !reply)
    throw new Error(reply?.error ?? "KataGo isn't running on this dev server.");
  return reply as T;
}

const game = (position: Position) => {
  const size = boardSize(position.board);
  return {
    size,
    komi: KOMI,
    moves: position.moves.map(
      ({ color, point }) =>
        `${color === 1 ? "B" : "W"} ${point === null ? "pass" : coordinate(point, size)}`,
    ),
  };
};

/**
 * Starts KataGo if needed; rejects when this server can't run it. `human`
 * means KataGo imitates a player of the rank passed to `katagoMove`.
 */
export const katagoReady = () =>
  request<{ name: string; human: boolean }>("/");

/** KataGo's move for `color`: a point, null to pass, or "resign". */
export async function katagoMove(
  position: Position,
  color: Color,
  rank: string,
  signal?: AbortSignal,
) {
  const { move } = await request<{ move: string }>(
    "/move",
    { ...game(position), color: color === 1 ? "B" : "W", rank },
    signal,
  );
  if (move === "pass") return null;
  if (move === "resign") return "resign" as const;
  return pointFromCoordinate(move, boardSize(position.board));
}

/** KataGo's count of a finished game, such as "B+3.5", with dead stones removed. */
export async function katagoScore(position: Position, signal?: AbortSignal) {
  const { score } = await request<{ score: string }>(
    "/score",
    game(position),
    signal,
  );
  if (score === "0") return "A draw by KataGo’s count.";
  const [winner, margin] = score.split("+");
  return `${winner === "B" ? "Black" : "White"} wins by ${margin} by KataGo’s count.`;
}
