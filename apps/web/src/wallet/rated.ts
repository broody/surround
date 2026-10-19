import { useCallback, useEffect, useState } from "react";
import { profileTypedData } from "@surround/offchain/profile";
import { COMING_SOON } from "../launch";

/**
 * The matchmaker for rated play on Starknet (offchain/matchmaker). In dev,
 * Vite proxies /api/matchmaker to it (MATCHMAKER_URL); a build can name
 * another with VITE_MATCHMAKER_URL.
 */
export const MATCHMAKER_URL: string =
  import.meta.env?.VITE_MATCHMAKER_URL ?? "/api/matchmaker";
/**
 * The ratings contract a build trusts (VITE_RATINGS_ADDRESS): the browser
 * refuses tickets for another. Unset, it takes the matchmaker's.
 */
export const RATINGS_ADDRESS: string | null =
  import.meta.env?.VITE_RATINGS_ADDRESS ?? null;
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
  /** The rank shown, in tenths (0 = 30k, 300 = 1d), with SurroundRatings' offset; null if unrated. */
  shown: number | null;
  /** The rank shown, e.g. "17k" or "2d". */
  rank: string | null;
  /** "?": too few games, or idle too long, for a firm rank. */
  provisional: boolean;
  established: boolean;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** The starting band SurroundRatings recorded with the first rated game; null before it. */
  band: number | null;
  /**
   * The wallet's profile, kept by the matchmaker (offchain/db): its handle, and
   * the band its first rated game starts from (0 once rated: the contract's
   * `band` is the one). Null until it makes one; it needs one to play.
   */
  profile: { handle: string; band: number } | null;
};

/** The starting bands a new player may choose, from the matchmaker (its GET /info `bands`). */
export type Bands = Record<string, string>;

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${MATCHMAKER_URL}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error ?? `The matchmaker answered ${response.status}`);
  return body as T;
}

/**
 * Claim a profile: go by `handle` and start rated play from `band` (0 once
 * rated). The handle is checked with the matchmaker first, so the wallet
 * signs only a claim that can land, then the claim is signed
 * (`profileTypedData`) and sent. Nothing goes onchain.
 */
export async function claimProfile(
  signer: { address: string; signTypedData(typedData: unknown): Promise<string[]> },
  { handle, band }: { handle: string; band: number },
) {
  const query = new URLSearchParams({ player: signer.address, handle });
  const [{ chain_id }] = await Promise.all([
    get<{ chain_id: string }>("/info"),
    get(`/handles/check?${query}`),
  ]);
  const at = Math.floor(Date.now() / 1000);
  const signature = await signer.signTypedData(
    profileTypedData({ chainId: chain_id, player: signer.address, handle, band, at }),
  );
  await get("/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player: signer.address, handle, band, at, signature }),
  }).catch((e: Error) => {
    throw e.message === "Stale request"
      ? new Error("That took too long to sign, or this computer's clock is off. Try again.")
      : e;
  });
}

type Resource<T> = {
  data?: T;
  error?: string;
  loading: boolean;
  refresh: () => void;
};

// Reads nothing while play is coming soon: the live site has no matchmaker.
function useMatchmaker<T>(wanted: string | null, everyMs = 0): Resource<T> {
  const path = COMING_SOON ? null : wanted;
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

/** The AI anchors the matchmaker offers: each one's account, character id, pinned rank and whether it has keys free. */
export type Anchor = { player: string; id: string | null; shown: number | null; keys: number };
export const useAnchors = () => useMatchmaker<Anchor[]>("/anchors", 30_000);

/** Plain words for each starting band. */
export const BAND_LABELS: Record<string, string> = {
  "23k": "New to Go",
  "17k": "Know the rules",
  "6k": "Club player",
  "1k": "Strong player",
};
