// Minting each rated game's kifu (README.md, "Kifu"): the ERC-721 of a settled
// ranked game, owned by its winner, whose record lives onchain. Anyone may
// send `mint`; nothing else does, so the matchmaker sends it, from its own
// account, as it rates games.
//
// - Which games: the indexer's rated games (db/kifus.mjs) won by a seat and
//   not voided. A draw has no kifu; a voided game (an abort, too short to
//   rate) gets none here, though the contract would mint it.
// - A kifu minted already (elsewhere: anyone may mint it) is only recorded,
//   whether or not a keeper has the game: its token has an owner.
// - The record: every step from the opening, from the keeper that refereed
//   the game (its `GET /games/:channel/:game`, kept on its disk once closed).
//   The chain checks it against the settled state; nothing here is trusted.
// - Each mint is estimated first, and the estimate says what the chain would
//   do: mint it, or refuse it for good ('Kifu already minted': minted
//   meanwhile; a wrong record: none). Anything else (no keeper has the record,
//   a fee over `max_fee_fri`, a send that failed) is tried again next round;
//   after `max_attempts` in a row, alerted, and tried again `retry_seconds`
//   later (a mint has no deadline: a keeper or node that was down comes back).
// - One mint at a time, on its own loop (server.mjs): a slow mint never holds
//   up pairing or rating, and never rides in a `rate` multicall (chain.mjs).
// - Off unless a kifu contract is configured (`kifu.address`).
import { parse } from '../sdk/node_modules/@arbiter/sdk/sdk/src/store.mjs';
import * as p from '../sdk/src/index.mjs';
import * as c from '../sdk/src/client.mjs';

/** What the contract refuses a mint for that no retry changes: the game's kifu is minted already, or never will be. */
const MINTED = 'Kifu already minted';
const REFUSED = ['Wrong anchor state', 'Noncanonical record', 'Wrong final position', 'Wrong move record', 'No winner', 'Not a ranked game'];

/**
 * `config`: `{ max_fee_fri, max_attempts = 5, retry_seconds = 3600, per_round = 5 }` (`kifu` in the
 * matchmaker's config; `max_fee_fri` defaults to the matchmaker's own).
 * `chain` needs `kifuMinted`, `estimateMint` and `mint` (chain.mjs); `kifus` is db/kifus.mjs;
 * `keepers` the matchmaker's (`[{ url }]`), asked in order for a game's record.
 */
export class KifuMinter {
  constructor(config, chain, kifus, { channel, keepers, fetch = globalThis.fetch, log = () => {}, now = Date.now }) {
    this.maxFee = config?.max_fee_fri == null ? null : BigInt(config.max_fee_fri);
    this.maxAttempts = Number(config?.max_attempts ?? 5);
    this.retryMs = Number(config?.retry_seconds ?? 3600) * 1000;
    this.perRound = Number(config?.per_round ?? 5);
    this.chain = chain;
    this.kifus = kifus;
    this.channel = p.hex(p.felt(channel));
    this.keepers = keepers;
    this.fetch = fetch;
    this.log = log;
    this.now = now;
    /** Failed attempts in a row, by game: `{ n, until }`, `until` when a game that reached `maxAttempts` is tried again. */
    this.attempts = new Map();
  }

  /** One round: mint the due kifus, one at a time. Returns `{ minted, none, failed }`, game ids each. */
  async tick() {
    const round = { minted: [], none: [], failed: [] };
    const now = this.now(), resting = id => (this.attempts.get(id)?.until ?? 0) > now;
    const stuck = [...this.attempts.keys()].filter(resting).length;
    for (const game of this.kifus.due(this.channel, this.perRound + stuck)) {
      if (resting(game.game_id)) continue;
      if (round.minted.length + round.none.length + round.failed.length >= this.perRound) break;
      round[await this.#mint(game)].push(game.game_id);
    }
    return round;
  }

  /** Mint `game`'s kifu: 'minted', 'none' (never will be), or 'failed' (tried again next round). */
  async #mint({ game_id }) {
    const at = () => Math.floor(this.now() / 1000);
    let mint;
    try {
      if (await this.chain.kifuMinted(p.felt(game_id))) {
        this.kifus.minted(game_id, null, at());
        this.attempts.delete(game_id);
        return 'minted';
      }
      mint = await this.#record(game_id);
    } catch (e) {
      return this.#failed(game_id, e.message);
    }
    let estimate;
    try {
      estimate = await this.chain.estimateMint(mint);
    } catch (e) {
      if (c.reverted(e, MINTED)) {
        this.kifus.minted(game_id, null, at());
        this.attempts.delete(game_id);
        return 'minted';
      }
      const refused = REFUSED.find(reason => c.reverted(e, reason));
      if (refused) {
        this.kifus.none(game_id, refused, at());
        this.attempts.delete(game_id);
        this.log(`kifu of ${game_id} refused by the chain: ${refused}`);
        return 'none';
      }
      return this.#failed(game_id, `estimate: ${e.message}`);
    }
    if (this.maxFee !== null && estimate.fee > this.maxFee) return this.#failed(game_id, `fee ${estimate.fee} over max_fee_fri ${this.maxFee}`);
    let tx;
    try {
      tx = await this.chain.mint(mint, estimate);
    } catch (e) {
      return this.#failed(game_id, `mint: ${e.message}`);
    }
    this.kifus.minted(game_id, tx, at());
    this.attempts.delete(game_id);
    this.log(`kifu of ${game_id} minted in ${tx}`);
    return 'minted';
  }

  /**
   * What `mint` takes for `game_id`: `{ game_id, anchor, record }`, from the
   * first keeper holding its record from the opening. Throws where none does.
   */
  async #record(game_id) {
    const missing = [];
    for (const { url } of this.keepers) {
      let res;
      try {
        res = await this.fetch(`${url}/games/${this.channel}/${p.hex(p.felt(game_id))}`);
      } catch (e) {
        missing.push(`${url}: ${e.message}`);
        continue;
      }
      if (!res.ok) {
        missing.push(`${url}: ${res.status}`);
        continue;
      }
      const view = parse(await res.text());
      // A record that starts after the opening can't make a kifu, which records every step.
      if (Number(view.start) !== 0) {
        missing.push(`${url}: its record starts at step ${view.start}`);
        continue;
      }
      const session = p.importSession(view.record);
      return { game_id: p.felt(game_id), anchor: session.env, record: c.kifuRecord(session) };
    }
    throw Error(`no keeper has its record (${missing.join('; ') || 'no keepers'})`);
  }

  /** An attempt that minted nothing. After `max_attempts` in a row, alert, and rest the game `retry_seconds`. */
  #failed(game_id, why) {
    const n = (this.attempts.get(game_id)?.n ?? 0) + 1;
    if (n < this.maxAttempts) {
      this.attempts.set(game_id, { n, until: 0 });
      return 'failed';
    }
    this.attempts.set(game_id, { n: 0, until: this.now() + this.retryMs });
    this.log(`ALERT: kifu of ${game_id} still not minted after ${n} attempts (${why}); trying again in ${this.retryMs / 1000} s`);
    return 'failed';
  }
}
