// Players' game history, from the Surround database (db.mjs): casual games,
// which the matchmaker records as each ends (`casual_games`: nothing else
// holds them), and rated ones, which the indexer reads from the chain
// (`rated_games`, `rank_history`: rebuildable). What a profile page shows.
import * as p from '../sdk/src/index.mjs';

/** The most games one page of history lists. */
export const MAX_PAGE = 100;

const hexOf = value => p.hex(p.felt(value));

export class History {
  constructor(db) {
    this.db = db;
    this.insertCasual = db.prepare(`INSERT OR IGNORE INTO casual_games (id, game_id, black, white, size, komi_half, clock,
      keeper, started_at, ended_at, winner, reason, steps, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  }

  /**
   * Keep a finished casual game: `{ id, game_id, black, white, size,
   * komi_half, clock, keeper, started_at, ended_at, winner, reason, steps,
   * record }` (times in Unix seconds, `record` the keeper's signed record as
   * JSON). A game kept already is kept as it was.
   */
  recordCasual(g) {
    this.insertCasual.run(hexOf(g.id), hexOf(g.game_id), hexOf(g.black), hexOf(g.white), g.size, g.komi_half, g.clock,
      g.keeper, g.started_at, g.ended_at, g.winner, g.reason, g.steps, g.record);
  }

  /**
   * `player`'s games, rated and casual, newest first: at most `limit` that
   * ended before `before` (Unix seconds). Each is `{ kind, id, game_id, black,
   * white, size, clock, winner, steps, at, reason?, voided? }`: a casual game's
   * `reason` is how it ended; a rated one's `voided` why it didn't count.
   */
  games(player, { before = Number.MAX_SAFE_INTEGER, limit = 20 } = {}) {
    const who = hexOf(player);
    const n = Math.max(1, Math.min(MAX_PAGE, Number(limit) || 20));
    return this.db.prepare(`
      SELECT 'casual' AS kind, id, game_id, black, white, size, clock, winner, steps, ended_at AS at, reason, NULL AS voided
        FROM casual_games WHERE (black = ?1 OR white = ?1) AND ended_at < ?2
      UNION ALL
      SELECT 'rated', digest, game_id, black, white, size, clock, winner, steps, played_at, NULL, voided
        FROM rated_games WHERE (black = ?1 OR white = ?1) AND played_at IS NOT NULL AND played_at < ?2
      ORDER BY at DESC LIMIT ?3`).all(who, Number(before), n).map(row => ({ ...row }));
  }

  /** `player`'s rank after each rated game, oldest first: `{ digest, game_id, opponent, score, shown, applied, played_at }`. */
  ranks(player, { limit = 500 } = {}) {
    return this.db.prepare(`SELECT digest, game_id, opponent, score, shown, applied, played_at FROM rank_history
      WHERE player = ? ORDER BY played_at, block LIMIT ?`).all(hexOf(player), Math.min(5000, Number(limit) || 500))
      .map(r => ({ ...r, applied: Boolean(r.applied) }));
  }

  /** A casual game's signed record (the keeper's `Session.export()`, JSON), for a replay; null if not kept. */
  record(id) {
    return this.db.prepare('SELECT record FROM casual_games WHERE id = ?').get(hexOf(id))?.record ?? null;
  }
}
