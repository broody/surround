// Minting each rated player's rank card (README.md, "Rank cards"): a
// soulbound ERC-721 whose image shows the player's rank, games, wins and
// losses, read from SurroundRatings each time it is shown. Minted once, at the
// player's first rated game; after that it follows every rated game with no
// transaction of its own. Anyone may send `mint`; the matchmaker does, from its
// own account.
//
// - Which players: the indexer's (db/rank-cards.mjs), anyone with a rated game
//   but AI anchors.
// - A card minted already (anyone may mint it) is only recorded.
// - Each mint is estimated first. 'Card already minted' is recorded as
//   minted, 'No card for an AI' as none, for good. Anything else ('No rated
//   game yet': the indexer read the game before the node it estimates on, a
//   fee over `max_fee_fri`, a send that failed) is tried again next round;
//   after `max_attempts` in a row, alerted, and tried again `retry_seconds`
//   later.
// - One mint at a time, each alone, on a loop of its own (server.mjs).
// - Off unless a rank card contract is configured (`rank_card.address`).
import * as c from '../sdk/src/client.mjs';

const MINTED = 'Card already minted';
const REFUSED = ['No card for an AI'];

/**
 * `config`: `{ max_fee_fri, max_attempts = 5, retry_seconds = 3600, per_round = 5 }` (`rank_card`
 * in the matchmaker's config; `max_fee_fri` defaults to the matchmaker's own).
 * `chain` needs `cardMinted`, `estimateCard` and `mintCard` (chain.mjs); `cards` is db/rank-cards.mjs.
 */
export class RankCardMinter {
  constructor(config, chain, cards, { log = () => {}, now = Date.now } = {}) {
    this.maxFee = config?.max_fee_fri == null ? null : BigInt(config.max_fee_fri);
    this.maxAttempts = Number(config?.max_attempts ?? 5);
    this.retryMs = Number(config?.retry_seconds ?? 3600) * 1000;
    this.perRound = Number(config?.per_round ?? 5);
    this.chain = chain;
    this.cards = cards;
    this.log = log;
    this.now = now;
    /** Failed attempts in a row, by player: `{ n, until }`, `until` when a player that reached `maxAttempts` is tried again. */
    this.attempts = new Map();
  }

  /** One round: mint the due cards, one at a time. Returns `{ minted, none, failed }`, players each. */
  async tick() {
    const round = { minted: [], none: [], failed: [] };
    const now = this.now(), resting = player => (this.attempts.get(player)?.until ?? 0) > now;
    const stuck = [...this.attempts.keys()].filter(resting).length;
    for (const player of this.cards.due(this.perRound + stuck)) {
      if (resting(player)) continue;
      if (round.minted.length + round.none.length + round.failed.length >= this.perRound) break;
      round[await this.#mint(player)].push(player);
    }
    return round;
  }

  /** Mint `player`'s card: 'minted', 'none' (never will be), or 'failed' (tried again next round). */
  async #mint(player) {
    const settle = (status, tx = null, reason = null) => {
      const at = Math.floor(this.now() / 1000);
      if (status === 'minted') this.cards.minted(player, tx, at);
      else this.cards.none(player, reason, at);
      this.attempts.delete(player);
      return status;
    };
    let estimate;
    try {
      if (await this.chain.cardMinted(player)) return settle('minted');
      estimate = await this.chain.estimateCard(player);
    } catch (e) {
      if (c.reverted(e, MINTED)) return settle('minted');
      const refused = REFUSED.find(reason => c.reverted(e, reason));
      if (refused) {
        this.log(`rank card of ${player} refused by the chain: ${refused}`);
        return settle('none', null, refused);
      }
      return this.#failed(player, e.message);
    }
    if (this.maxFee !== null && estimate.fee > this.maxFee) return this.#failed(player, `fee ${estimate.fee} over max_fee_fri ${this.maxFee}`);
    let tx;
    try {
      tx = await this.chain.mintCard(player, estimate);
    } catch (e) {
      return this.#failed(player, `mint: ${e.message}`);
    }
    this.log(`rank card of ${player} minted in ${tx}`);
    return settle('minted', tx);
  }

  /** An attempt that minted nothing. After `max_attempts` in a row, alert, and rest the player `retry_seconds`. */
  #failed(player, why) {
    const n = (this.attempts.get(player)?.n ?? 0) + 1;
    if (n < this.maxAttempts) {
      this.attempts.set(player, { n, until: 0 });
      return 'failed';
    }
    this.attempts.set(player, { n: 0, until: this.now() + this.retryMs });
    this.log(`ALERT: rank card of ${player} still not minted after ${n} attempts (${why}); trying again in ${this.retryMs / 1000} s`);
    return 'failed';
  }
}
