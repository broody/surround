// Playing a rated game from the player's side. The session (every step,
// signed, and our session key) lives in this browser's store, so a reload or
// another tab picks the game up where it was. Our steps are signed with the
// session key and stamped by the keeper that referees the game; the other
// side's arrive from the keeper, each verified before it is applied.
import * as p from "@surround/offchain";
import * as c from "@surround/offchain/client";
import type { Position } from "../game/rules.ts";
import { maskOf, pointsOf, positionOf } from "../../../../shared/go.ts";
import { reviveTerms, type Pairing } from "./flow.ts";

/** The store rated games keep their sessions and keys in (IndexedDB). */
export const browserStore = () => new c.SessionStore(c.indexedDbBackend("surround-rated"));

/** Go's phases, and how a game ended (offchain/sdk). */
export const PLAYING = 0,
  SCORING = 1,
  FINISHED = 2;
const REASONS: Record<number, string> = {
  1: "by agreement",
  2: "with the board played out",
  3: "at the move limit",
  128: "by resignation",
  129: "on time",
  130: "by abandonment",
};
/** Fewer steps than this and a game doesn't count: SurroundRatings voids it. */
export const MIN_RATED_STEPS = 20;

export type Clock = { seat: number; ms: number }[];

export class RatedGame {
  readonly pairing: Pairing;
  readonly terms: any;
  readonly seat: 0 | 1;
  readonly size: number;
  readonly komi: number;
  private session: any;
  private store: any;
  private keeper: any;
  private privateKey: bigint;

  private constructor(pairing: Pairing, terms: any, session: any, store: any, keeper: any, privateKey: bigint) {
    this.pairing = pairing;
    this.terms = terms;
    this.session = session;
    this.store = store;
    this.keeper = keeper;
    this.privateKey = privateKey;
    this.seat = pairing.color === "black" ? 0 : 1;
    this.size = terms.config.size;
    this.komi = terms.config.komi_half / 2;
  }

  /** Open a pairing's game from the store, with the session key kept for it. */
  static async open(pairing: Pairing, store: any, fetch = globalThis.fetch.bind(globalThis)) {
    const terms = reviveTerms(pairing.terms);
    const key = await store.keyFor(terms);
    if (!key) throw new Error("This browser doesn't hold the session key for this game.");
    const session = await store.open(p.go, terms);
    const keeper = new c.KeeperClient(pairing.keeper, { fetch });
    const game = new RatedGame(pairing, terms, session, store, keeper, BigInt(key.privateKey));
    return game;
  }

  /** Go's state: board, phase, whose turn, the proposal at scoring. */
  private get state() {
    return this.session.env.game;
  }
  get position(): Position {
    return positionOf(this.session.steps, this.size);
  }
  get steps(): number {
    return this.session.env.seq;
  }
  get phase(): number {
    return this.state.phase;
  }
  get finished(): boolean {
    return this.session.env.outcome.finished;
  }
  /** 1 black won, 2 white won, 0 a draw, as the protocol reports it. */
  get winner(): number {
    return this.session.env.outcome.winner;
  }
  get reason(): string {
    return REASONS[this.session.env.outcome.reason] ?? "";
  }
  /** Final area counts, with komi in White's. */
  get score() {
    return { black: this.state.black_half / 2, white: this.state.white_half / 2 };
  }
  /** Whose step is next: 0 black, 1 white. */
  get due(): number {
    return this.session.due();
  }
  /** Our step is waiting for the referee's stamp. */
  get pending(): boolean {
    return this.session.pending.length > 0;
  }
  get myTurn(): boolean {
    return !this.finished && !this.pending && this.due === this.seat;
  }
  /** The dead stones proposed at scoring, and whether a proposal is on the table. */
  get proposal() {
    return { proposed: Boolean(this.state.proposed), dead: new Set(pointsOf(BigInt(this.state.dead), this.size)) };
  }
  /** The game was resumed after a scoring proposal: two passes now end it with every stone alive. */
  get resumed(): boolean {
    return this.state.resumed_at !== 0;
  }
  /** Each seat's time left at referee time `at` (ms), and when the side to play can be flagged. */
  clock(at: number) {
    const left = p.timeLeft(p.go, this.terms, this.session.env, at);
    return {
      // `standardTime`'s view: the turn's time, then the bank.
      left: left?.map((view: any) => Number(view.turn ?? 0) + Number(view.bank ?? 0)) ?? null,
      flagAt: p.flagAt(p.go, this.terms, this.session.env) as number | null,
    };
  }

  /** Bring the game up to the keeper's copy; with `wait`, wait up to that many seconds for a new step. */
  async sync({ wait = 0, signal }: { wait?: number; signal?: AbortSignal } = {}) {
    return this.keeper.pull(this.session, { wait, store: this.store, signal });
  }

  private async step(step: unknown) {
    await this.store.move(this.session, step, this.privateKey);
    await this.keeper.submit(this.session, { store: this.store });
  }
  play(point: number) {
    return this.step(p.goStep(p.PLAY, point));
  }
  pass() {
    return this.step(p.goStep(p.PASS));
  }
  resign() {
    return this.step(p.resignStep(this.seat));
  }
  /** Propose the final count with these stones dead (whole groups). */
  propose(dead: Iterable<number>) {
    return this.step(p.goStep(p.PROPOSE, p.NO_POINT, maskOf(dead)));
  }
  accept() {
    return this.step(p.goStep(p.ACCEPT));
  }
  resume() {
    return this.step(p.goStep(p.RESUME));
  }
}
