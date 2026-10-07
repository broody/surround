// Starting a rated game on Starknet, from the player's side: ask the
// matchmaker for a game, check the terms it offers as the protocol requires,
// sign them (the game's one signature), and wait until the keeper holds the
// game. Signed in (`signIn`, one wallet signature a week), this browser's key
// signs the terms instead, and the wallet signs nothing per game.
// No React here: the page uses it, and so do Node tests against the real
// matchmaker (offchain/anchors/browser-*.test.ts).
import * as p from "@surround/offchain";
import * as c from "@surround/offchain/client";
import type { BrowserKey, SignInStore } from "./signin.ts";

/** The clock preset rated games use: 60 seconds a move (the matchmaker's `turn`). */
export const CLOCK = "turn";
/** How long a sign-in lasts: a week, which the channel takes with an hour's slack for this clock. */
export const SIGN_IN_SECONDS = 7 * 24 * 3600;

/** The connected wallet, as far as rated play needs it. */
export type Signer = {
  address: string;
  /** The account's SNIP-12 signature, as its account contract checks it. */
  signTypedData(typedData: unknown): Promise<string[]>;
};

/**
 * A pairing, as the matchmaker reports it (GET /queue/:player while it
 * lasts), or an AI game's `offer`, which becomes one once its terms are signed.
 */
export type Pairing = {
  status: "paired" | "offer";
  color: "black" | "white";
  digest: string;
  game_id: string;
  ticket: Record<string, unknown>;
  terms: Record<string, unknown> & { config: Record<string, unknown> };
  keeper: string;
  sign_by: number;
  signed: { black: boolean; white: boolean };
  ready: boolean;
  anchor?: string;
};

export type FlowOptions = {
  matchmaker: string;
  /** `SessionStore` (src/rated/game.ts): it keeps the session keys and every game. */
  store: any;
  fetch?: typeof globalThis.fetch;
  newKey?: () => bigint;
  /** The wall clock in milliseconds, which dates sign-ins and signed requests. */
  now?: () => number;
  /** Where this browser keeps its sign-ins (`browserSignIns`); none, and every game takes the wallet's signature. */
  signIns?: SignInStore | null;
};

type LobbyInfo = { chain_id: string; channel: string; delegation_seconds: number };

const STARK_ORDER =
  0x800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2fn;
/** A uniformly random Stark private key: a game's session key. */
export function newSessionKey(): bigint {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const k =
      BigInt(`0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`) >> 4n;
    if (k > 0n && k < STARK_ORDER) return k;
  }
}

/** Terms as the matchmaker sends them (felts as hex), revived. */
export const reviveTerms = (terms: Pairing["terms"]) =>
  p.goTerms({ ...terms, ...terms.config });

export class MatchmakerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class RatedFlow {
  readonly player: string;
  private signer: Signer;
  private options: Required<FlowOptions>;
  private info: Promise<LobbyInfo> | null = null;

  constructor(signer: Signer, options: FlowOptions) {
    this.signer = signer;
    this.player = p.hex(BigInt(signer.address));
    this.options = {
      fetch: globalThis.fetch.bind(globalThis),
      newKey: newSessionKey,
      now: Date.now,
      signIns: null,
      ...options,
    };
  }

  /** The matchmaker's chain, channel, and how long a sign-in may run there (0: no signing in). */
  private lobby(): Promise<LobbyInfo> {
    this.info ??= this.call<LobbyInfo>("/info").catch((e) => {
      this.info = null;
      throw e;
    });
    return this.info;
  }

  /** This browser's key for this player, decrypted, while its sign-in runs; else null. */
  async signedIn(): Promise<BrowserKey | null> {
    return (await this.options.signIns?.key(this.player)) ?? null;
  }

  /**
   * Sign in: the wallet signs one delegation (`delegationTypedData`) letting a
   * fresh browser key, kept encrypted on this browser, sign this player's
   * lobby requests and agree to their rated games for SIGN_IN_SECONDS.
   * Returns false where the matchmaker takes no sign-ins.
   */
  async signIn(): Promise<boolean> {
    const signIns = this.options.signIns;
    if (!signIns) throw new Error("This flow keeps no sign-ins");
    const { chain_id, channel, delegation_seconds } = await this.lobby();
    if (!delegation_seconds) return false;
    const privateKey = this.options.newKey();
    const key = p.hex(p.publicKey(privateKey));
    const expires_at = Math.floor(this.options.now() / 1000) + Math.min(SIGN_IN_SECONDS, delegation_seconds);
    const delegation = { chain_id: BigInt(chain_id), channel: BigInt(channel), key, expires_at };
    const signature = await this.signer.signTypedData(p.delegationTypedData(p.go, delegation));
    await this.call("/delegates", { player: this.player, key, expires_at, signature });
    await signIns.save(this.player, { privateKey, key, expires_at });
    return true;
  }

  /** Sign out: this browser's key revokes itself at the matchmaker, with no wallet prompt, and the browser forgets it. */
  async signOut() {
    const signedIn = await this.signedIn();
    if (!signedIn) return;
    try {
      await this.call("/delegates/revoke", await this.signed("revoke", signedIn, { key: signedIn.key }));
    } finally {
      await this.options.signIns!.forget(this.player);
    }
  }

  /** A lobby request signed by this browser's key (`matchmakerRequest`, naming the key as `delegate`). */
  private async signed(action: string, signedIn: BrowserKey, fields: Record<string, unknown>) {
    const { chain_id } = await this.lobby();
    const body = { player: this.player, at: Math.floor(this.options.now() / 1000), nonce: p.hex(this.options.newKey()),
      delegate: signedIn.key, ...fields };
    const typed = c.matchmakerRequest({ chainId: BigInt(chain_id), action, ...body });
    return { ...body, signature: c.signRequest(typed, this.player, signedIn.privateKey) };
  }

  private async call<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.options.fetch(`${this.options.matchmaker}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new MatchmakerError(response.status, json.error ?? `The matchmaker answered ${response.status}`);
    return json as T;
  }

  /** This player's pairing, while it lasts, or null. */
  async current(): Promise<Pairing | null> {
    const status = await this.call<{ status: string }>(`/queue/${this.player}`);
    return status.status === "paired" ? (status as Pairing) : null;
  }

  /**
   * Play the AI anchor `anchor` now: a fresh session key (kept in the store
   * before the matchmaker sees it), and the terms the matchmaker offers,
   * checked and signed. The request is unsigned: the matchmaker holds nothing
   * for it until the terms are. `band` is the starting band of an unrated
   * player (none once rated).
   */
  async playAnchor({ anchor, size, band }: { anchor: string; size: number; band?: number | null }) {
    const key = this.options.newKey();
    await this.options.store.saveKey(key, { player: this.player });
    const offer = await this.call<Pairing>("/ai", {
      player: this.player,
      key: p.hex(p.publicKey(key)),
      size,
      clock: CLOCK,
      band: band ?? 0,
      anchor: p.hex(BigInt(anchor)),
    });
    return this.accept(offer, { anchor, size });
  }

  /**
   * Check a pairing's terms as the protocol requires, then sign them: the
   * ticket's own terms, our session key (one we kept) at our seat, the
   * opponent we asked for, and the keeper's own referee on the clock.
   */
  async accept(pairing: Pairing, expect: { anchor?: string; size?: number } = {}) {
    const terms = reviveTerms(pairing.terms);
    const ticket = c.reviveTicket(pairing.ticket);
    const seat = pairing.color === "black" ? 0 : 1;
    const check = (ok: boolean, what: string) => {
      if (!ok) throw new Error(`These game terms are not safe to sign: ${what}.`);
    };
    check(
      p.contextHash(p.go, terms) === p.contextHash(p.go, c.ratedTerms(ticket, terms.keys)),
      "they are not the ticket's",
    );
    check(BigInt(ticket[pairing.color]) === BigInt(this.player), "the seat is not yours");
    const stored = await this.options.store.keyFor(terms);
    check(stored?.seat === seat, "the session key is not one this browser made");
    if (expect.anchor)
      check(BigInt(ticket[pairing.color === "black" ? "white" : "black"]) === BigInt(expect.anchor), "another opponent");
    if (expect.size) check(ticket.size === expect.size, "another board size");
    const info = await (await this.options.fetch(`${pairing.keeper}/info`)).json();
    check(BigInt(info.referee) === ticket.clock.referee, "the clock names another referee than the keeper's");
    // The game is opened from these terms later, by the keeper: keep them.
    await this.options.store.open(p.go, terms);
    const signedIn = await this.signedIn();
    if (signedIn) {
      // Signed in: the browser key agrees in the wallet's place.
      const { r, s } = p.sign(p.termsMessageHash(p.go, terms, this.player), signedIn.privateKey);
      try {
        return await this.call<Pairing>(`/games/${pairing.digest}/sign`, {
          player: this.player,
          approval: { key: signedIn.key, signature: { r: p.hex(r), s: p.hex(s) } },
        });
      } catch (e) {
        // Revoked or expired there, or too near its expiry for a game: the wallet signs this one.
        if (!(e instanceof MatchmakerError) || !/sign in again|too soon/.test(e.message)) throw e;
        if (/sign in again/.test(e.message)) await this.options.signIns!.forget(this.player);
      }
    }
    return this.call<Pairing>(`/games/${pairing.digest}/sign`, {
      player: this.player,
      signature: await this.signer.signTypedData(c.goTermsTypedData(terms)),
    });
  }

  /** Wait until the keeper holds the game; null if the pairing ended first (the other side never signed). */
  async waitReady(digest: string, { signal, everyMs = 1000 }: { signal?: AbortSignal; everyMs?: number } = {}) {
    for (;;) {
      const pairing = await this.current();
      if (!pairing || pairing.digest !== digest) return null;
      if (pairing.ready) return pairing;
      await new Promise((resolve) => setTimeout(resolve, everyMs));
      if (signal?.aborted) return null;
    }
  }
}
