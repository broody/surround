// Players' game history, from the Surround database (db.mjs): casual games,
// which the matchmaker records as each ends (`casual_games`: nothing else
// holds them), and rated ones, which the indexer reads from the chain
// (`rated_games`, `rank_history`: rebuildable). What a profile page shows.
import * as p from '../sdk/src/index.mjs';

/** The most games one page of history lists. */
export const MAX_PAGE = 100;
/** How many entries a rank chart gets by default, and at most (`ranks`). */
export const DEFAULT_POINTS = 200;
export const MAX_POINTS = 1000;
/** A player's rated games in the order they were played: by time, then block, then as the indexer read them. */
const ORDER = 'played_at, block, rowid';

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
   * white, size, clock, winner, steps, at, reason, voided, moved }`: a casual
   * game's `reason` is how it ended; a rated one's `voided` why it didn't
   * count, and `moved` how the player's rank moved with it, in tenths (null
   * for its first rated game, and for a game not rated).
   */
  games(player, { before = Number.MAX_SAFE_INTEGER, limit = 20 } = {}) {
    const who = hexOf(player);
    const n = Math.max(1, Math.min(MAX_PAGE, Number(limit) || 20));
    return this.db.prepare(`
      WITH moves AS (SELECT digest, shown - LAG(shown) OVER (ORDER BY ${ORDER}) AS moved FROM rank_history WHERE player = ?1)
      SELECT 'casual' AS kind, id, game_id, black, white, size, clock, winner, steps, ended_at AS at, reason,
          NULL AS voided, NULL AS moved
        FROM casual_games WHERE (black = ?1 OR white = ?1) AND ended_at < ?2
      UNION ALL
      SELECT 'rated', g.digest, g.game_id, black, white, size, clock, winner, steps, g.played_at, NULL, voided, m.moved
        FROM rated_games g LEFT JOIN moves m ON m.digest = g.digest
        WHERE (black = ?1 OR white = ?1) AND g.played_at IS NOT NULL AND g.played_at < ?2
      ORDER BY at DESC LIMIT ?3`).all(who, Number(before), n).map(row => ({ ...row }));
  }

  /**
   * How `player`'s rank moved over its rated games, for a chart: `{ total,
   * ranks }`, `total` its rated games and `ranks` at most `points` entries,
   * oldest first, over its newest `last` games (all of them by default).
   * Each entry is a run of `games` games in a row, with the rank after the
   * last (`shown`, in tenths), the lowest and highest rank after any of them
   * (`low`, `high`), their `wins`, `draws` and `losses`, and when the first
   * and last were played (`first_at`, `played_at`). Where the games fit in
   * `points`, each entry is one game and also has its `digest`, `game_id`,
   * `opponent`, `score` (2 won, 1 drew, 0 lost) and `applied`; otherwise
   * they're shared out evenly, so a player with thousands of games still
   * gets `points` entries.
   */
  ranks(player, { points = DEFAULT_POINTS, last } = {}) {
    const who = hexOf(player);
    const n = Math.max(2, Math.min(MAX_POINTS, Math.floor(Number(points)) || DEFAULT_POINTS));
    const { total } = this.db.prepare('SELECT COUNT(*) AS total FROM rank_history WHERE player = ?').get(who);
    const wanted = Math.floor(Number(last));
    const take = last === undefined || last === null || !(wanted > 0) ? total : Math.min(total, wanted);
    const skip = total - take;
    if (take <= n)
      return { total, ranks: this.db.prepare(`SELECT digest, game_id, opponent, score, shown, applied, played_at
        FROM rank_history WHERE player = ? ORDER BY ${ORDER} LIMIT ? OFFSET ?`).all(who, take, skip).map(r => ({
        ...r, applied: Boolean(r.applied), games: 1, low: r.shown, high: r.shown,
        wins: +(r.score === 2), draws: +(r.score === 1), losses: +(r.score === 0), first_at: r.played_at,
      })) };
    // Only the columns a run needs, for every game: a few small numbers each, however many there are.
    const rows = this.db.prepare(`SELECT score, shown, played_at FROM rank_history WHERE player = ?
      ORDER BY ${ORDER} LIMIT -1 OFFSET ?`).all(who, skip);
    const ranks = [];
    for (let b = 0; b < n; b++) {
      const from = Math.floor((b * take) / n), to = Math.floor(((b + 1) * take) / n);
      const run = { games: to - from, shown: rows[to - 1].shown, low: Infinity, high: -Infinity,
        wins: 0, draws: 0, losses: 0, first_at: rows[from].played_at, played_at: rows[to - 1].played_at };
      for (let i = from; i < to; i++) {
        const { score, shown } = rows[i];
        run.low = Math.min(run.low, shown);
        run.high = Math.max(run.high, shown);
        if (score === 2) run.wins++; else if (score === 1) run.draws++; else run.losses++;
      }
      ranks.push(run);
    }
    return { total, ranks };
  }

  /** A casual game's signed record (the keeper's `Session.export()`, JSON), for a replay; null if not kept. */
  record(id) {
    return this.db.prepare('SELECT record FROM casual_games WHERE id = ?').get(hexOf(id))?.record ?? null;
  }
}
