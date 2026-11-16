// Which rated players still want a rank card, and what became of each one's
// (`rank_cards`, db.mjs). The players are the indexer's (`rank_history`):
// anyone with a rated game that counted for them, except AI anchors, whose
// side the chain marks.
// A card is per player, not per world or channel: it reads SurroundRatings,
// which outlives worlds. matchmaker/rank-card.mjs mints them.
import * as p from '../sdk/src/index.mjs';

const hexOf = value => p.hex(p.felt(value));

export class RankCards {
  constructor(db) {
    this.db = db;
    this.dueQuery = db.prepare(`SELECT h.player FROM rank_history h
      LEFT JOIN rank_cards r ON r.player = h.player
      WHERE r.player IS NULL AND h.anchor = 0 AND h.applied = 1
      GROUP BY h.player ORDER BY MIN(h.block), h.player LIMIT ?`);
    this.insert = db.prepare('INSERT OR REPLACE INTO rank_cards (player, status, reason, tx, at) VALUES (?, ?, ?, ?, ?)');
  }

  /** Rated players, not AIs, whose card isn't settled yet, first rated first: `[player]`. */
  due(limit = 10) {
    return this.dueQuery.all(limit).map(r => r.player);
  }

  /** `player`'s card was minted (`tx` where this minter sent it). */
  minted(player, tx = null, at = Math.floor(Date.now() / 1000)) {
    this.insert.run(hexOf(player), 'minted', null, tx, at);
  }

  /** `player`'s card won't be minted, and why. */
  none(player, reason, at = Math.floor(Date.now() / 1000)) {
    this.insert.run(hexOf(player), 'none', reason, null, at);
  }

  /** What became of `player`'s card: `{ status, reason, tx, at }`, or null while it's due. */
  get(player) {
    return this.db.prepare('SELECT status, reason, tx, at FROM rank_cards WHERE player = ?').get(hexOf(player)) ?? null;
  }
}
