// Which rated games still want a kifu, and what became of each one's
// (`kifus`, db.mjs). The games are the indexer's (`rated_games`): rated, not
// voided, and won by a seat. A draw has no kifu, and a voided game (too short
// to rate, an abort) gets none from Surround, though the contract would mint
// it. matchmaker/kifu.mjs mints them.
import * as p from '../sdk/src/index.mjs';

const hexOf = value => p.hex(p.felt(value));

export class Kifus {
  constructor(db) {
    this.db = db;
    this.dueQuery = db.prepare(`SELECT r.game_id, r.winner, r.steps FROM rated_games r
      LEFT JOIN kifus k ON k.game_id = r.game_id
      WHERE r.channel = ? AND k.game_id IS NULL AND r.winner IN (1, 2) AND r.voided IS NULL
      ORDER BY r.block, r.rowid LIMIT ?`);
    this.insert = db.prepare('INSERT OR REPLACE INTO kifus (game_id, status, reason, tx, at) VALUES (?, ?, ?, ?, ?)');
  }

  /** `channel`'s rated games won by a seat whose kifu isn't settled yet, oldest first: `[{ game_id, winner, steps }]`. */
  due(channel, limit = 10) {
    return this.dueQuery.all(hexOf(channel), limit).map(r => ({ game_id: r.game_id, winner: r.winner, steps: r.steps }));
  }

  /** `game_id`'s kifu was minted (`tx` where this minter sent it). */
  minted(game_id, tx = null, at = Math.floor(Date.now() / 1000)) {
    this.insert.run(hexOf(game_id), 'minted', null, tx, at);
  }

  /** `game_id`'s kifu won't be minted, and why. */
  none(game_id, reason, at = Math.floor(Date.now() / 1000)) {
    this.insert.run(hexOf(game_id), 'none', reason, null, at);
  }

  /** What became of `game_id`'s kifu: `{ status, reason, tx, at }`, or null while it's due. */
  get(game_id) {
    return this.db.prepare('SELECT status, reason, tx, at FROM kifus WHERE game_id = ?').get(hexOf(game_id)) ?? null;
  }
}
