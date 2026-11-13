import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SEPOLIA, useWallet } from "../wallet/WalletProvider";
import {
  MATCHMAKER_URL,
  RATINGS_ADDRESS,
  useAnchors,
  useCensus,
  useRatedPlayer,
  useTables,
  type Anchor,
  type Census,
  type RatedPlayer,
  type Table,
} from "../wallet/rated";
import { readPointer, writePointer, type RatedPointer } from "./pointer.ts";
import type { GameAsk, Pairing, SignInRequest } from "./flow.ts";

type Resource<T> = { data?: T; error?: string; loading: boolean; refresh: () => void };

/** A table this wallet hosts: its id (a private one's is the invite), and whether it's rated. */
export type Hosting = { table: string; private: boolean; rated: boolean };

type PlayState = {
  /** The connected wallet's account, rating and profile, from the matchmaker. */
  player: Resource<RatedPlayer>;
  anchors: Resource<Anchor[]>;
  tables: Resource<Table[]>;
  census: Resource<Census>;
  /** The band an unrated player's first rated game starts from: its profile's. */
  band: number | null;
  /** Whether this wallet can ask for a game now, and if not, why. */
  ready: boolean;
  reason?: string;
  /** The game this wallet has going in this browser, if any. */
  pointer: RatedPointer | null;
  anchorFor(characterId: string): Anchor | undefined;
  /** This browser's sign-in for the wallet (a week, one signature), if any. */
  signedIn: { expires_at: number } | null;
  signIn(): Promise<void>;
  /**
   * A sign-in for the wallet to sign beside something else (a profile claim,
   * which the Outis window then asks about once, together): null where this
   * browser is signed in already, or the matchmaker takes no sign-ins.
   */
  signInRequest(): Promise<SignInRequest | null>;
  signOut(): Promise<void>;
  /** Waiting in the rated or the casual queue. */
  waiting: { rated: boolean } | null;
  hosting: Hosting | null;
  /** Play a character's AI anchor now, rated or casual (untimed). */
  /** Play an AI: `color` and `handicap` (no komi) are the player's choice in a casual game, and ignored in a rated one. */
  start(characterId: string, size: number, rated?: boolean, color?: "black" | "white", handicap?: boolean): Promise<void>;
  queue(ask: GameAsk): Promise<void>;
  leave(): Promise<void>;
  host(ask: GameAsk & { private?: boolean }): Promise<void>;
  closeTable(): Promise<void>;
  /** Sit at an open table, or take an invite. */
  join(table: string): Promise<void>;
  /** What's in progress: a character's id, or "queue", "table", "join", "sign-in". */
  starting: string | null;
  error?: string;
  clearError(): void;
};

const PlayContext = createContext<PlayState | null>(null);

const hostingKey = (address: string) => `surround-table:${BigInt(address)}`;
function readHosting(address: string): Hosting | null {
  try {
    const raw = window.localStorage.getItem(hostingKey(address));
    return raw ? (JSON.parse(raw) as Hosting) : null;
  } catch {
    return null;
  }
}
function writeHosting(address: string, hosting: Hosting | null) {
  try {
    if (hosting) window.localStorage.setItem(hostingKey(address), JSON.stringify(hosting));
    else window.localStorage.removeItem(hostingKey(address));
  } catch {
    /* Storage may be unavailable: the table is still the matchmaker's. */
  }
}

/**
 * Play for the connected wallet, rated and casual: one read of its account
 * and the lobby, shared by the Dojo and the game page. The protocol SDK (the
 * game flow) loads only when the wallet first asks for something.
 */
export function RatedProvider({ children }: { children: ReactNode }) {
  const { address, chainId, signTypedData, outis } = useWallet();
  // The Outis window signs the sign-in and nothing after it (flow.ts `signInOnly`).
  const signInOnly = Boolean(outis);
  const player = useRatedPlayer(address);
  const anchors = useAnchors();
  const tables = useTables();
  const census = useCensus();
  const [pointer, setPointer] = useState<RatedPointer | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [waiting, setWaiting] = useState<{ rated: boolean } | null>(null);
  const [hosting, setHostingState] = useState<Hosting | null>(null);
  const [signedIn, setSignedIn] = useState<{ expires_at: number } | null>(null);
  const flows = useRef<{ address: string; sign: unknown; signInOnly: boolean; flow: Promise<any> } | null>(null);
  const taking = useRef<string | null>(null);

  /** The game flow for this wallet, loaded once (its own chunk). */
  const flow = useCallback(() => {
    if (!address) throw new Error("Connect a wallet first");
    if (flows.current?.address !== address || flows.current.sign !== signTypedData || flows.current.signInOnly !== signInOnly) {
      const loading = (async () => {
        const [{ RatedFlow }, { browserStore }, { browserSignIns }] = await Promise.all([
          import("./flow.ts"),
          import("./game.ts"),
          import("./signin.ts"),
        ]);
        return new RatedFlow(
          { address, signTypedData, signInOnly },
          { matchmaker: MATCHMAKER_URL, store: browserStore(), ratings: RATINGS_ADDRESS, signIns: browserSignIns() },
        );
      })();
      loading.catch(() => (flows.current = null));
      flows.current = { address, sign: signTypedData, signInOnly, flow: loading };
    }
    return flows.current.flow;
  }, [address, signTypedData, signInOnly]);

  const setHosting = useCallback(
    (next: Hosting | null) => {
      setHostingState(next);
      if (address) writeHosting(address, next);
    },
    [address],
  );

  useEffect(() => {
    setPointer(address ? readPointer(address) : null);
    setHostingState(address ? readHosting(address) : null);
    setWaiting(null);
    setSignedIn(null);
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
    ? "Connect a wallet to play."
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
                ? "Finish your game first."
                : undefined;

  // Signed in on this browser? Asked once the wallet has a profile.
  const hasProfile = Boolean(data?.profile);
  useEffect(() => {
    if (!address || !hasProfile) return;
    let live = true;
    flow()
      .then((f) => f.signedIn())
      .then((key) => live && setSignedIn(key ? { expires_at: key.expires_at } : null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [address, hasProfile, flow]);

  const anchorFor = useCallback(
    (characterId: string) => anchors.data?.find((a) => a.id === characterId),
    [anchors.data],
  );

  /** Run one action at a time, as `what`, with its error shown. */
  const run = useCallback(async (what: string, action: () => Promise<void>) => {
    setStarting(what);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(null);
    }
  }, []);

  /** A pairing for us: check and sign its terms (unless signed already), remember it, and open its page. */
  const take = useCallback(
    async (pairing: Pairing, expect: { anchor?: string } = {}) => {
      if (!address || taking.current === pairing.digest) return;
      taking.current = pairing.digest;
      try {
        const f = await flow();
        const seat = pairing.color;
        const signed = pairing.signed?.[seat] ? pairing : await f.accept(pairing, { ...expect, rated: pairing.rated });
        const opponent = seat === "black" ? pairing.white : pairing.black;
        const character = anchors.data?.find((a) => BigInt(a.player) === BigInt(opponent))?.id ?? null;
        writePointer(address, {
          digest: pairing.digest,
          rated: pairing.rated,
          characterId: character,
          anchor: opponent,
          pairing: signed,
          gamesBefore: data?.games ?? 0,
          finished: false,
        });
        setPointer(readPointer(address));
        setWaiting(null);
        setHosting(null);
        window.location.hash = `rated/${pairing.digest}`;
      } finally {
        taking.current = null;
      }
    },
    [address, flow, anchors.data, data?.games, setHosting],
  );

  // While waiting in a queue or hosting a table, look for our pairing.
  const watching = Boolean(address && (waiting || hosting) && !playing);
  useEffect(() => {
    if (!watching || !address) return;
    let live = true;
    const look = async () => {
      try {
        const status = await (await fetch(`${MATCHMAKER_URL}/queue/${address}`)).json();
        if (!live) return;
        if (status.status === "paired") await take(status as Pairing);
        else if (status.status === "waiting") setWaiting({ rated: status.rated !== false });
        else setWaiting(null);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    };
    void look();
    const timer = setInterval(look, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [watching, address, take]);

  /**
   * The flow, signed in: a game is when the wallet is first asked, so a
   * browser not signed in yet signs in here (one signature for the week) and
   * its games ask nothing more. Where the matchmaker takes no sign-ins, the
   * wallet signs each game as before.
   */
  const signedFlow = useCallback(async () => {
    const f = await flow();
    if (!(await f.signedIn()) && (await f.signIn())) {
      const key = await f.signedIn();
      setSignedIn(key ? { expires_at: key.expires_at } : null);
    }
    return f;
  }, [flow]);

  /**
   * In the click that may lead to a sign-in: the Outis window opens now. The
   * sign-in follows fetches, and a browser blocks a window opened that long
   * after the click. Blocked even so, the sign-in says so when it comes.
   */
  const ahead = useCallback(() => {
    if (!outis || signedIn) return;
    try {
      outis.open();
    } catch {
      /* The sign-in reports it. */
    }
  }, [outis, signedIn]);

  const signIn = useCallback(
    () => {
      ahead();
      return run("sign-in", async () => {
        const f = await flow();
        if (!(await f.signIn())) throw new Error("Signing in isn't open on this matchmaker.");
        const key = await f.signedIn();
        setSignedIn(key ? { expires_at: key.expires_at } : null);
      });
    },
    [run, flow, ahead],
  );
  const signInRequest = useCallback(async () => {
    const f = await flow();
    if (await f.signedIn()) return null;
    const asked: SignInRequest | null = await f.signInRequest();
    if (!asked) return null;
    return {
      typedData: asked.typedData,
      finish: async (signature: string[]) => {
        await asked.finish(signature);
        const key = await f.signedIn();
        setSignedIn(key ? { expires_at: key.expires_at } : null);
      },
    };
  }, [flow]);
  const signOut = useCallback(
    () =>
      run("sign-in", async () => {
        await (await flow()).signOut();
        setSignedIn(null);
      }),
    [run, flow],
  );

  const start = useCallback(
    async (characterId: string, size: number, rated = true, color?: "black" | "white", handicap = false) => {
      const anchor = anchorFor(characterId);
      if (!address || !anchor || reason) return;
      ahead();
      await run(characterId, async () => {
        const signed = await (await signedFlow()).playAnchor({ anchor: anchor.player, size, band: data?.rated ? null : band, rated, color, handicap });
        await take(signed as Pairing, { anchor: anchor.player });
      }).finally(() => anchors.refresh());
    },
    [address, anchorFor, reason, run, signedFlow, data?.rated, band, take, anchors, ahead],
  );

  const queue = useCallback(
    (ask: GameAsk) => {
      ahead();
      return run("queue", async () => {
        const status = await (await signedFlow()).queue({ ...ask, band: data?.rated ? null : band });
        if (status.status === "paired") await take(status as Pairing);
        else setWaiting({ rated: ask.rated });
      });
    },
    [run, signedFlow, data?.rated, band, take, ahead],
  );
  const leave = useCallback(
    () =>
      run("queue", async () => {
        await (await flow()).leave();
        setWaiting(null);
      }),
    [run, flow],
  );
  const host = useCallback(
    ({ private: hidden = false, ...ask }: GameAsk & { private?: boolean }) => {
      ahead();
      return run("table", async () => {
        const { table } = await (await signedFlow()).host({ ...ask, band: data?.rated ? null : band, private: hidden });
        setHosting({ table, private: hidden, rated: ask.rated });
      });
    },
    [run, signedFlow, data?.rated, band, setHosting, ahead],
  );
  const closeTable = useCallback(
    () =>
      run("table", async () => {
        if (hosting) await (await flow()).close(hosting.table).catch(() => {});
        setHosting(null);
      }),
    [run, flow, hosting, setHosting],
  );
  const join = useCallback(
    (table: string) => {
      ahead();
      return run("join", async () => {
        const pairing = await (await signedFlow()).join(table, { band: data?.rated ? null : band });
        await take(pairing);
      });
    },
    [run, signedFlow, data?.rated, band, take, ahead],
  );

  const clearError = useCallback(() => setError(undefined), []);
  const value = useMemo<PlayState>(
    () => ({
      player, anchors, tables, census, band, ready: !reason, reason, pointer, anchorFor, signedIn, signIn, signInRequest, signOut,
      waiting, hosting, start, queue, leave, host, closeTable, join, starting, error, clearError,
    }),
    [player, anchors, tables, census, band, reason, pointer, anchorFor, signedIn, signIn, signInRequest, signOut, waiting, hosting,
      start, queue, leave, host, closeTable, join, starting, error, clearError],
  );
  return <PlayContext.Provider value={value}>{children}</PlayContext.Provider>;
}

export function useRated() {
  const context = useContext(PlayContext);
  if (!context) throw new Error("useRated must be used within a RatedProvider");
  return context;
}
