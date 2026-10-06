import { useCallback, useEffect, useState } from "react";

/**
 * The matchmaker for rated play on Starknet (offchain/matchmaker). In dev,
 * Vite proxies /api/matchmaker to it (MATCHMAKER_URL); a build can name
 * another with VITE_MATCHMAKER_URL.
 */
export const MATCHMAKER_URL: string =
  import.meta.env?.VITE_MATCHMAKER_URL ?? "/api/matchmaker";
/** Starknet Sepolia's STRK token: the zero allowance that activates an account. */
export const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** A player's account and rating, as the matchmaker reads them (GET /players/:player). */
export type RatedPlayer = {
  player: string;
  /** An account's contract is deployed with its first transaction; until then it can't sign for rated games. */
  deployed: boolean;
  rated: boolean;
  anchor: boolean;
  rank_tenths: number | null;
  /** The rank shown, e.g. "17k" or "2d". */
  rank: string | null;
  /** "?": too few games, or idle too long, for a firm rank. */
  provisional: boolean;
  established: boolean;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  band: number | null;
};

/** The starting bands a new player may choose, from the matchmaker (its GET /info `bands`). */
export type Bands = Record<string, string>;

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${MATCHMAKER_URL}${path}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error ?? `The matchmaker answered ${response.status}`);
  return body as T;
}

type Resource<T> = {
  data?: T;
  error?: string;
  loading: boolean;
  refresh: () => void;
};

function useMatchmaker<T>(path: string | null, everyMs = 0): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    setData(undefined);
    setError(undefined);
  }, [path]);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    get<T>(path)
      .then((value) => live && (setData(value), setError(undefined)))
      .catch(
        () =>
          live &&
          setError("Rated play is offline: the matchmaker can't be reached."),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, tick]);
  useEffect(() => {
    if (!path || !everyMs) return;
    const timer = setInterval(refresh, everyMs);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [path, everyMs, refresh]);
  return { data, error, loading, refresh };
}

/**
 * The connected player's account and rating. Ratings change when the keeper
 * settles a game, minutes after it ends: read again every minute and when
 * the window regains focus.
 */
export const useRatedPlayer = (address?: string) =>
  useMatchmaker<RatedPlayer>(address ? `/players/${address}` : null, 60_000);

export const useBands = () =>
  useMatchmaker<{ bands: Bands }>("/info");

/** Plain words for each starting band. */
export const BAND_LABELS: Record<string, string> = {
  "23k": "New to Go",
  "17k": "Know the rules",
  "6k": "Club player",
  "1k": "Strong player",
};

const bandKey = (address: string) => `surround-band:${BigInt(address)}`;

/**
 * The starting band an unrated player chose (1 = 23k, 2 = 17k, 3 = 6k,
 * 4 = 1k), kept in this browser: it goes on the player's first ticket, and
 * SurroundRatings records it with their first rated game.
 */
export function readBand(address: string): number | null {
  try {
    const band = Number(window.localStorage.getItem(bandKey(address)));
    return band >= 1 && band <= 4 ? band : null;
  } catch {
    return null;
  }
}

export function writeBand(address: string, band: number) {
  try {
    window.localStorage.setItem(bandKey(address), String(band));
  } catch {
    /* Storage may be unavailable: the player chooses again. */
  }
}
