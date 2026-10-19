// The Surround database: one SQLite file (`node:sqlite`, WAL) for what the
// chain doesn't hold or can't be queried for, shared by the matchmaker and,
// once it exists, the indexer. Its tables are of two kinds:
// - irreplaceable: written from what only Surround saw (profiles), and backed
//   up (`backup`);
// - rebuildable: written from the chain, and rebuilt by replaying it.
// Each part adds its tables as a migration, in order; a file's `user_version`
// is how many it has. See README.md.
import { DatabaseSync } from 'node:sqlite';

/** Each migration's SQL, in order, with whose tables it adds and of which kind. */
export const MIGRATIONS = [
  // 1. Profiles (profiles.mjs), irreplaceable: each player's handle and
  //    claim, the handles let go of, and reserved names.
  `
  CREATE TABLE profiles (
    player TEXT PRIMARY KEY,   -- the account, as 0x hex without leading zeros
    handle TEXT NOT NULL,      -- as the player typed it
    key TEXT NOT NULL UNIQUE,  -- handleKey(handle): what two handles can't share
    at INTEGER NOT NULL,       -- the claim's signed time (Unix seconds)
    since INTEGER NOT NULL,    -- when the player took this key, for renaming
    signature TEXT NOT NULL,   -- the wallet's signature, a JSON array of hex felts
    version TEXT NOT NULL      -- the domain version of the typed data it signed
  );
  -- Handles let go of: renamed (held for their old owner until \`until\`) or
  -- cleared by a moderator (held for no one: \`until\` 0).
  CREATE TABLE released (
    player TEXT NOT NULL,
    handle TEXT NOT NULL,
    key TEXT NOT NULL,
    reason TEXT NOT NULL,      -- 'renamed' or 'cleared'
    at INTEGER NOT NULL,
    until INTEGER NOT NULL
  );
  CREATE INDEX released_key ON released (key, until);
  CREATE TABLE reserved (
    key TEXT PRIMARY KEY,
    reason TEXT NOT NULL DEFAULT ''
  );
  `,
  // 2. Profiles, irreplaceable: the starting level each claim signs
  //    (profileTypedData's band; 0, none, for a rated player).
  `ALTER TABLE profiles ADD COLUMN band INTEGER NOT NULL DEFAULT 0;`,
  // 3. Casual games (history.mjs), irreplaceable: each one finished, as its
  //    keeper held it. Nothing of a casual game is onchain.
  `
  CREATE TABLE casual_games (
    id TEXT PRIMARY KEY,         -- the pairing's digest: its terms' context hash
    game_id TEXT NOT NULL,
    black TEXT NOT NULL,
    white TEXT NOT NULL,
    size INTEGER NOT NULL,
    komi_half INTEGER NOT NULL,
    clock TEXT NOT NULL,         -- a clock preset's name, or 'untimed'
    keeper TEXT NOT NULL,
    started_at INTEGER NOT NULL, -- when its players were paired (Unix seconds)
    ended_at INTEGER NOT NULL,   -- when the matchmaker saw it over
    winner INTEGER NOT NULL,     -- 1 black, 2 white, 0 a draw
    reason INTEGER NOT NULL,     -- how it ended: the protocol's outcome reason
    steps INTEGER NOT NULL,
    record TEXT NOT NULL         -- the keeper's signed record (Session.export()), JSON, felts as hex
  );
  CREATE INDEX casual_black ON casual_games (black, ended_at);
  CREATE INDEX casual_white ON casual_games (white, ended_at);
  `,
  // 4. The indexer (indexer/indexer.mjs), rebuildable: rated games and each
  //    player's rank after each, from SurroundRatings' events, and how far it read.
  `
  CREATE TABLE rated_games (
    digest TEXT PRIMARY KEY,     -- the ticket's
    channel TEXT NOT NULL,
    game_id TEXT NOT NULL,
    black TEXT,                  -- the ticket's seats (TicketUsed); null if it was missed
    white TEXT,
    size INTEGER,                -- the board and clock preset the ticket names by hash; null if not configured here
    clock TEXT,
    winner INTEGER,              -- 1 black, 2 white, 0 a draw; null until rated
    steps INTEGER,
    played_at INTEGER,
    voided INTEGER,              -- GameVoided's reason; null unless voided
    block INTEGER NOT NULL
  );
  CREATE INDEX rated_black ON rated_games (black, played_at);
  CREATE INDEX rated_white ON rated_games (white, played_at);
  CREATE TABLE rank_history (
    player TEXT NOT NULL,
    digest TEXT NOT NULL,
    game_id TEXT NOT NULL,
    opponent TEXT NOT NULL,
    score INTEGER NOT NULL,      -- half points: 2 won, 1 drew, 0 lost
    shown INTEGER NOT NULL,      -- the rank after, in tenths (0 = 30k, 300 = 1d)
    applied INTEGER NOT NULL,    -- whether the game changed the rating
    anchor INTEGER NOT NULL,     -- an AI anchor's side, pinned
    played_at INTEGER NOT NULL,
    block INTEGER NOT NULL,
    PRIMARY KEY (player, digest)
  );
  CREATE INDEX rank_player ON rank_history (player, played_at);
  CREATE TABLE indexer_cursor (
    name TEXT PRIMARY KEY,
    block INTEGER NOT NULL,      -- the last block read
    hash TEXT NOT NULL           -- its hash, to notice it was replaced
  );
  `,
];
/** The tables the indexer writes, which a rebuild empties and refills from the chain. */
export const REBUILDABLE = ['rated_games', 'rank_history', 'indexer_cursor'];

/**
 * Open (or create) the database at `file` and bring it up to date. Every
 * process that writes it may open it at once: each migration runs in its own
 * write transaction, so only the first to get there applies it. A file from
 * newer code is refused.
 */
export function openDatabase(file, migrations = MIGRATIONS) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const version = () => db.prepare('PRAGMA user_version').get().user_version;
  for (;;) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const at = version();
      if (at > migrations.length) throw Error(`The database at ${file} is at version ${at}, newer than this code's ${migrations.length}`);
      if (at === migrations.length) {
        db.exec('COMMIT');
        return db;
      }
      db.exec(migrations[at]);
      db.exec(`PRAGMA user_version = ${at + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      db.close();
      throw e;
    }
  }
}

/** Copy the database to `file`, consistent even while others write it. */
export function backup(db, file) {
  db.prepare('VACUUM INTO ?').run(file);
}
