// Surround's AI anchors: fixed-strength opponents whose ratings are pinned in
// SurroundRatings (RANKING_PLAN.md, AI anchors). Each anchor is an ordinary
// account; this daemon holds its wallet key and, for each one:
// - offers the matchmaker fresh session keys for its next games, keeping each
//   private key in a session store first;
// - checks every pairing's terms as any player's client does, and signs them
//   with the anchor's wallet;
// - plays each game through its keeper: KataGo's human SL profile for the
//   anchor's rank picks the moves; at scoring, KataGo's ownership picks the
//   dead stones, and a proposal that gives the same winner is accepted.
import { randomBytes } from "node:crypto";
import * as p from "../sdk/src/index.mjs";
import * as c from "../sdk/src/client.mjs";
import {
  emptyPosition,
  play,
  type Position,
} from "../../apps/web/src/game/rules.ts";
import type { EngineAPI } from "../lobby/engine.ts";
import { deadStones } from "../lobby/scoring.ts";

/** A wallet that signs SNIP-12 typed data as its account checks it (starknet.js `Account`). */
export type Wallet = {
  address: string;
  signMessage(typed: unknown): Promise<unknown>;
};
export type Anchor = {
  /** The character's id in shared/lobby.ts. */
  id: string;
  /** The KataGo human SL profile it plays: `rank_<rank>`. */
  rank: string;
  wallet: Wallet;
};
type Fetch = typeof globalThis.fetch;
export type Options = {
  matchmaker: string;
  chainId: bigint;
  engine: EngineAPI;
  /** `SessionStore`: session keys and transcripts, kept across restarts. */
  store: any;
  /** Keys each anchor keeps offered (the matchmaker holds at most 16). */
  keys?: number;
  /**
   * Most games an anchor has at once, offered keys included: its keeper's
   * `max_open_per_player` must allow as many games nobody opened yet.
   */
  max_games?: number;
  /** Seconds a keeper long-polls for the other seat's step. */
  wait?: number;
  fetch?: Fetch;
  log?: (message: string) => void;
  newKey?: () => bigint;
  /** The wall clock in milliseconds, which dates requests. */
  now?: () => number;
};

const SEATS = ["black", "white"] as const;
const STARK_ORDER =
  0x800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2fn;
/** A uniformly random Stark private key. */
export function newSessionKey(): bigint {
  for (;;) {
    const k = BigInt(`0x${randomBytes(32).toString("hex")}`) >> 4n;
    if (k > 0n && k < STARK_ORDER) return k;
  }
}

/**
 * A wallet's signature as the account checks it: an array of hex felts. A
 * Stark signature object (starknet.js returns one for a plain key) is [r, s].
 */
function signatureJson(signature: any) {
  if (Array.isArray(signature)) return signature.map((x) => p.hex(BigInt(x)));
  if (signature?.r != null) return [p.hex(BigInt(signature.r)), p.hex(BigInt(signature.s))];
  throw Error("The wallet returned no signature");
}

/**
 * The Go position a session's steps reached, for the engine: plays and passes
 * in order; resuming after a scoring proposal clears the passes.
 */
export function positionOf(session: any): Position {
  let position = emptyPosition(session.terms.config.size);
  for (const record of session.steps) {
    const step = record.step;
    if (step.kind !== 0) continue; // the referee's, or a resignation
    const action = step.action;
    if (action.kind === p.PLAY) position = play(position, action.point);
    else if (action.kind === p.PASS) position = play(position, null);
    else if (action.kind === p.RESUME)
      position = { ...position, passes: 0, paused: false };
  }
  return position;
}

/** Points as the bitmask a scoring proposal carries. */
const maskOf = (points: Iterable<number>) =>
  [...points].reduce((m, point) => m | (1n << BigInt(point)), 0n);

/** The winner (1 black, 2 white, 3 a draw) with `dead` removed, as the rules score it. */
function winnerWith(state: any, size: number, komiHalf: number, dead: bigint) {
  const { black_half, white_half } = p.score(state.board, size, dead, komiHalf);
  return black_half > white_half ? 1 : white_half > black_half ? 2 : 3;
}

export class AnchorDaemon {
  anchors: Map<string, Anchor>;
  options: Required<Omit<Options, "log" | "fetch" | "newKey" | "now">> & {
    log: (m: string) => void;
    fetch: Fetch;
    newKey: () => bigint;
    now: () => number;
  };
  /** Games being played, by ticket digest. */
  playing = new Map<string, Promise<void>>();
  /** Pairings signed, by ticket digest (so a slow round doesn't sign twice). */
  signed = new Set<string>();
  /** Games played to the end, by ticket digest: the matchmaker lists them until it sees them over. */
  done = new Set<string>();
  referees = new Map<string, bigint>();

  constructor(anchors: Anchor[], options: Options) {
    this.anchors = new Map(
      anchors.map((a) => [p.hex(BigInt(a.wallet.address)), a]),
    );
    this.options = {
      keys: 4,
      max_games: 16,
      wait: 20,
      fetch: globalThis.fetch,
      log: () => {},
      newKey: newSessionKey,
      now: Date.now,
      ...options,
    } as AnchorDaemon["options"];
  }

  async #call(method: string, path: string, body?: unknown) {
    const response = await this.options.fetch(
      `${this.options.matchmaker}${path}`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    const json: any = await response.json();
    if (!response.ok)
      throw Object.assign(Error(json.error ?? `HTTP ${response.status}`), {
        status: response.status,
      });
    return json;
  }

  /** One round for every anchor: offer keys, sign new pairings, play the games that are ready. */
  async tick() {
    await Promise.all(
      [...this.anchors.entries()].map(([address, anchor]) =>
        this.#round(address, anchor).catch((e) =>
          this.options.log(`${anchor.id}: ${e.message}`),
        ),
      ),
    );
  }

  async #round(address: string, anchor: Anchor) {
    const view = await this.#call("GET", `/anchors/${address}`);
    const room = this.options.max_games - view.games.length;
    for (let n = view.keys; n < Math.min(this.options.keys, room); n++)
      await this.#offer(address, anchor);
    for (const game of view.games) {
      const color = game.color as (typeof SEATS)[number];
      if (!game.signed[color] && !this.signed.has(game.digest))
        await this.#sign(anchor, game);
      if (game.ready && !this.playing.has(game.digest) && !this.done.has(game.digest)) {
        const run = this.#play(anchor, game)
          .catch((e) =>
            this.options.log(`${anchor.id} game ${game.game_id}: ${e.message}`),
          )
          .finally(() => this.playing.delete(game.digest));
        this.playing.set(game.digest, run);
      }
    }
  }

  /** Offer a fresh session key, stored before the matchmaker sees it. */
  async #offer(address: string, anchor: Anchor) {
    const privateKey = this.options.newKey();
    await this.options.store.saveKey(privateKey, { anchor: address });
    const body = {
      player: address,
      key: p.hex(p.publicKey(privateKey)),
      at: Math.floor(this.options.now() / 1000),
      nonce: p.hex(this.options.newKey()),
    };
    const typed = c.matchmakerRequest({
      chainId: this.options.chainId,
      action: "anchor_key",
      ...body,
    });
    const signature = signatureJson(await anchor.wallet.signMessage(typed));
    await this.#call("POST", `/anchors/${address}/keys`, {
      ...body,
      signature,
    });
  }

  /** The referee key of the keeper at `url` (its `GET /info`). */
  async #referee(url: string) {
    if (!this.referees.has(url)) {
      const response = await this.options.fetch(`${url}/info`);
      const info: any = await response.json();
      this.referees.set(url, BigInt(info.referee));
    }
    return this.referees.get(url)!;
  }

  /**
   * Check a pairing's terms as a player's client does, then sign them with the
   * anchor's wallet: the ticket's own terms, our session key (one we offered)
   * at our seat, no band for us, and the keeper's referee on the clock.
   */
  async #sign(anchor: Anchor, game: any) {
    const terms = p.goTerms({ ...game.terms, ...game.terms.config });
    const ticket = c.reviveTicket(game.ticket);
    const seat = game.color === "black" ? 0 : 1;
    const address = p.hex(BigInt(anchor.wallet.address));
    const check = (ok: boolean, what: string) => {
      if (!ok) throw Error(`refusing to sign game ${game.game_id}: ${what}`);
    };
    check(
      p.contextHash(p.go, terms) ===
        p.contextHash(p.go, c.ratedTerms(ticket, terms.keys)),
      "not its ticket's terms",
    );
    check(p.hex(ticket[game.color]) === address, "not our seat");
    check(ticket[`${game.color}_band`] === 0, "a band for an anchor");
    check(p.hex(terms.keys[seat]) === p.hex(BigInt(game.key)), "not our key");
    const stored = await this.options.store.keyFor(terms);
    check(stored?.seat === seat, "a session key we never offered");
    check(
      ticket.clock.referee === (await this.#referee(game.keeper)),
      "another referee than its keeper's",
    );
    const signature = signatureJson(
      await anchor.wallet.signMessage(c.goTermsTypedData(terms)),
    );
    await this.#call("POST", `/games/${game.digest}/sign`, {
      player: address,
      signature,
    });
    this.signed.add(game.digest);
    this.options.log(
      `${anchor.id} signed game ${game.game_id} as ${game.color}`,
    );
  }

  /** Play a game the keeper holds until it is over. */
  async #play(anchor: Anchor, game: any) {
    const { store, wait } = this.options;
    const terms = p.goTerms({ ...game.terms, ...game.terms.config });
    const keeper = new c.KeeperClient(game.keeper, {
      fetch: this.options.fetch,
    });
    const { seat, privateKey } = await store.keyFor(terms);
    const session = await store.open(p.go, terms);
    await keeper.pull(session, { store });
    while (!session.env.outcome.finished) {
      if (session.pending.length) {
        await keeper.submit(session, { store });
        continue;
      }
      if (session.due() !== seat) {
        await keeper.pull(session, { wait, store });
        continue;
      }
      const step = await this.#choose(anchor, session);
      try {
        await store.move(session, step, privateKey);
      } catch (e) {
        // The engine's move broke a rule the session knows better: pass.
        this.options.log(`${anchor.id}: ${(e as Error).message}; passing`);
        await store.move(session, p.goStep(p.PASS), privateKey);
      }
      await keeper.submit(session, { store });
    }
    this.done.add(game.digest);
    const { winner } = session.env.outcome;
    this.options.log(
      `${anchor.id} game ${game.game_id} over: ${winner === seat + 1 ? "won" : winner === 0 ? "drew" : "lost"}`,
    );
  }

  /** Our next step: a move, or at scoring a proposal, acceptance or resumption. */
  async #choose(anchor: Anchor, session: any) {
    const state = session.env.game;
    const { size, komi_half } = session.terms.config;
    const komi = komi_half / 2;
    const position = positionOf(session);
    if (state.phase === p.PLAYING) {
      // After a resumption the stones on the board are what counts: play it
      // out at full strength, capturing what's dead.
      const { point } = await this.options.engine.move(
        position,
        komi,
        state.resumed_at === 0 ? anchor.rank : (undefined as any),
      );
      return point === null
        ? p.goStep(p.PASS)
        : p.goStep(p.PLAY, point);
    }
    const analysis = await this.options.engine.analyze(position, komi);
    const ours = maskOf(deadStones(position, analysis.ownership));
    if (!state.proposed) return p.goStep(p.PROPOSE, p.NO_POINT, ours);
    // Theirs: accepted if it decides the game as our estimate does.
    const same =
      winnerWith(state, size, komi_half, BigInt(state.dead)) ===
      winnerWith(state, size, komi_half, ours);
    return p.goStep(same ? p.ACCEPT : p.RESUME);
  }
}
