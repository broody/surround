// Starting a rated game on Starknet, from the player's side: ask the
// matchmaker for a game, check the terms it offers as the protocol requires,
// sign them with the wallet (the game's one signature), and wait until the
// keeper holds the game.
// No React here: the page uses it, and so does a Node test against the real
// matchmaker (src/rated/flow.test.ts).
import * as p from "@surround/offchain";
import * as c from "@surround/offchain/client";

/** The clock preset rated games use: 60 seconds a move (the matchmaker's `turn`). */
export const CLOCK = "turn";

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
};

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

  constructor(signer: Signer, options: FlowOptions) {
    this.signer = signer;
    this.player = p.hex(BigInt(signer.address));
    this.options = {
      fetch: globalThis.fetch.bind(globalThis),
      newKey: newSessionKey,
      ...options,
    };
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
