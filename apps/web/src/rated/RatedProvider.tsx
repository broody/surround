import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SEPOLIA, useWallet } from "../wallet/WalletProvider";
import { useAnchors, useRatedPlayer, type Anchor, type RatedPlayer } from "../wallet/rated";
import { readPointer, type RatedPointer } from "./pointer.ts";

type Resource<T> = { data?: T; error?: string; loading: boolean; refresh: () => void };

type RatedState = {
  /** The connected wallet's account and rating, from the matchmaker. */
  player: Resource<RatedPlayer>;
  anchors: Resource<Anchor[]>;
  /** The band an unrated player's first rated game starts from: its profile's. */
  band: number | null;
  /** Whether this wallet can start a rated game now, and if not, why. */
  ready: boolean;
  reason?: string;
  /** The rated game this wallet has going in this browser, if any. */
  pointer: RatedPointer | null;
  anchorFor(characterId: string): Anchor | undefined;
  /** Start a rated game against a character's anchor; opens its page. */
  start(characterId: string, size: number): Promise<void>;
  starting: string | null;
  error?: string;
};

const RatedContext = createContext<RatedState | null>(null);

/** Rated play on Starknet for the connected wallet: one read of its rating and the anchors, shared by the Dojo. */
export function RatedProvider({ children }: { children: ReactNode }) {
  const { address, chainId, signTypedData } = useWallet();
  const player = useRatedPlayer(address);
  const anchors = useAnchors();
  const [pointer, setPointer] = useState<RatedPointer | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setPointer(address ? readPointer(address) : null);
    setError(undefined);
  }, [address]);
  // The game page records when a game finishes: read the pointer again on return.
  useEffect(() => {
    const refresh = () => setPointer(address ? readPointer(address) : null);
    window.addEventListener("hashchange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("hashchange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [address]);

  const onSepolia = chainId !== undefined && BigInt(chainId) === BigInt(SEPOLIA);
  const data = player.data;
  const band = data?.profile?.band || null;
  const playing = Boolean(pointer && !pointer.finished);
  const reason = !address
    ? "Connect a wallet to play rated games."
    : !onSepolia
      ? "Switch your wallet to Sepolia."
      : !data
        ? player.error ?? "Reading your account…"
        : !data.deployed
          ? "Activate your account first."
          : data.anchor
            ? "This is an AI's account."
            : !data.profile
              ? "Make your profile first."
              : playing
                ? "Finish your rated game first."
                : undefined;

  const anchorFor = useCallback(
    (characterId: string) => anchors.data?.find((a) => a.id === characterId),
    [anchors.data],
  );

  const start = useCallback(
    async (characterId: string, size: number) => {
      const anchor = anchorFor(characterId);
      if (!address || !anchor || reason) return;
      setStarting(characterId);
      setError(undefined);
      try {
        const { startRatedGame } = await import("./start.ts");
        await startRatedGame({
          signer: { address, signTypedData },
          anchor: anchor.player,
          characterId,
          size,
          band: data?.rated ? null : band,
          gamesBefore: data?.games ?? 0,
        });
        setPointer(readPointer(address));
      } catch (e) {
        setError((e as Error).message);
        anchors.refresh();
      } finally {
        setStarting(null);
      }
    },
    [address, anchorFor, reason, signTypedData, data, band, anchors],
  );

  const value = useMemo<RatedState>(
    () => ({ player, anchors, band, ready: !reason, reason, pointer, anchorFor, start, starting, error }),
    [player, anchors, band, reason, pointer, anchorFor, start, starting, error],
  );
  return <RatedContext.Provider value={value}>{children}</RatedContext.Provider>;
}

export function useRated() {
  const context = useContext(RatedContext);
  if (!context) throw new Error("useRated must be used within a RatedProvider");
  return context;
}
