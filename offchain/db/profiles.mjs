// Players' profiles: the handle each wallet goes by in Surround and the level
// it starts rated play from, kept in the Surround database (db.mjs), whose
// `profiles`, `released` and `reserved` tables these are. Nothing else holds
// them: they outlive new worlds, and are backed up (admin.mjs). See README.md.
//
// A wallet claims its profile by signing `profileTypedData`
// (sdk/src/profile.mjs). Each claim is kept with its signature, so anyone can
// check every profile against its account, and replay them all into another
// store.
import * as p from '../sdk/src/index.mjs';
import { BANDS, PROFILE_VERSION, handleError, handleKey, profileTypedData } from '../sdk/src/profile.mjs';

const DAY = 24 * 3600;
export const DEFAULTS = {
  /** How long a player keeps a handle before choosing another. */
  rename_seconds: 7 * DAY,
  /** How long a handle let go of stays its old owner's to take back, and no one else's. */
  hold_seconds: 30 * DAY,
};
/** Largest distance a claim's `at` may be from the clock, in seconds: the matchmaker's request skew. */
const CLAIM_SKEW = 120;
/** The most players one lookup names. */
export const MAX_LOOKUP = 100;

/**
 * Names nobody may take: the service's own, and the AI regulars' (each
 * character in shared/lobby.ts, by first name and full name), so no one
 * passes for them. Moderators reserve more (`reserve`), and so can a config.
 */
export const RESERVED = [
  'surround', 'admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'official', 'system', 'root',
  'matchmaker', 'keeper', 'referee', 'arbiter', 'anchor', 'dojo', 'bot', 'guest', 'anonymous', 'player', 'opponent',
  'you', 'null', 'undefined', 'starknet', 'cartridge', 'controller', 'outis',
  'yuna', 'yuna_seki', 'malik', 'malik_diop', 'nanami', 'nanami_ueda', 'luc', 'luc_moreau', 'ryo', 'ryo_kanzaki',
];

export class ProfileError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** An account address as profiles are keyed: what the matchmaker's `GET /players/:player` names. */
export const playerOf = value => {
  try { return p.hex(p.felt(value)); } catch { throw new ProfileError(400, 'Invalid player'); }
};
const signatureOf = signature => {
  try {
    // Any length, as the matchmaker takes a wallet's: a passkey's runs long. Its body limit bounds it.
    if (Array.isArray(signature) && signature.length > 0) return signature.map(x => p.hex(p.felt(x)));
  } catch { /* refused below */ }
  throw new ProfileError(400, 'Invalid signature');
};
const claimOf = row => row && ({ player: row.player, handle: row.handle, band: row.band, at: row.at,
  signature: JSON.parse(row.signature), version: row.version });
const bandList = mask => Object.entries(BANDS).filter(([b]) => mask & (1 << Number(b))).map(([, name]) => name).join(', ');
/** Why an account can't sign yet: what every refusal of an undeployed one says. */
export const UNDEPLOYED = 'Activate your account first: it can sign once it is deployed';
const dateOf = seconds => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * Surround's players' profiles, in the database `db` (`openDatabase`).
 * `chain` checks a claim's signature through the player's account (`verify`,
 * `deployed`) and its starting level against SurroundRatings (`startBands`,
 * `player`): the matchmaker's chain.mjs. `chain_id` is the chain claims are
 * signed for; `now()` is the wall clock in milliseconds; `reserved` adds names
 * to RESERVED.
 */
export class Profiles {
  constructor(db, { chain, chain_id, now = Date.now, rename_seconds = DEFAULTS.rename_seconds,
    hold_seconds = DEFAULTS.hold_seconds, reserved = [] }) {
    this.db = db;
    this.chain = chain;
    this.chainId = BigInt(chain_id);
    this.now = () => Math.floor(now() / 1000);
    this.renameSeconds = rename_seconds;
    this.holdSeconds = hold_seconds;
    this.reserved = new Set([...RESERVED, ...reserved].map(handleKey));
    this.byPlayer = db.prepare('SELECT * FROM profiles WHERE player = ?');
    this.byKey = db.prepare('SELECT player FROM profiles WHERE key = ?');
    this.held = db.prepare('SELECT 1 FROM released WHERE key = ? AND until > ? AND player != ? LIMIT 1');
    this.isReserved = db.prepare('SELECT 1 FROM reserved WHERE key = ?');
  }

  /** `player`'s claim, `{ player, handle, band, at, signature, version }`, or null. */
  get(player) {
    return claimOf(this.byPlayer.get(playerOf(player))) ?? null;
  }

  /**
   * `player`'s profile, which it needs to ask for any game: the matchmaker's
   * `admit`. Refuses a player without one.
   */
  admit(player) {
    const profile = this.get(player);
    if (!profile) throw new ProfileError(403, 'Make your profile first: a handle and a starting level');
    return profile;
  }

  /** The claims of those of `players` with a profile. */
  many(players) {
    if (players.length > MAX_LOOKUP) throw new ProfileError(400, `Ask for at most ${MAX_LOOKUP} players at once`);
    const list = JSON.stringify([...new Set(players.map(playerOf))]);
    return this.db.prepare('SELECT * FROM profiles WHERE player IN (SELECT value FROM json_each(?)) ORDER BY player')
      .all(list).map(claimOf);
  }

  /** Every claim, with its signature: the export anyone can check and replay. */
  all() {
    return this.db.prepare('SELECT * FROM profiles ORDER BY player').all().map(claimOf);
  }

  /**
   * Claim a profile: `{ player, handle, band, at, signature }`, the player's
   * wallet signature over `profileTypedData` at `at` (Unix seconds). A claim
   * is taken fresh, newer than the player's last, from a deployed account; the
   * handle must be free (not anyone else's, nor held for its old owner), and
   * not reserved. A player renames once every `rename_seconds`, but may change
   * a handle's case or separators, or its starting level, any time. `band` is
   * a starting level SurroundRatings allows (`start_bands`); a rated player,
   * whose level the contract holds, may send 0. Returns the claim.
   */
  async claim(body) {
    const player = playerOf(body.player);
    const handle = body.handle;
    const key = this.#key(handle);
    const band = Number(body.band);
    if (!Number.isInteger(band) || !(band >= 0 && band <= 4)) throw new ProfileError(400, 'Invalid starting level');
    const at = Number(body.at);
    if (!Number.isSafeInteger(at) || Math.abs(at - this.now()) > CLAIM_SKEW) throw new ProfileError(401, 'Stale request');
    const signature = signatureOf(body.signature);
    // Refuse what would be refused anyway before asking the chain; checked
    // again once it answers, since another claim may land meanwhile.
    this.#check(player, key, at);
    if (!(await this.chain.deployed(player))) throw new ProfileError(403, UNDEPLOYED);
    await this.#band(player, band);
    let ok = false;
    try {
      ok = await this.chain.verify(player, profileTypedData({ chainId: this.chainId, player, handle, band, at }), signature);
    } catch { ok = false; }
    if (!ok) throw new ProfileError(401, 'Bad signature');
    const now = this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.#check(player, key, at);
      const same = current?.key === key;
      if (current && !same)
        this.db.prepare('INSERT INTO released (player, handle, key, reason, at, until) VALUES (?, ?, ?, ?, ?, ?)')
          .run(player, current.handle, current.key, 'renamed', now, now + this.holdSeconds);
      this.db.prepare(`INSERT INTO profiles (player, handle, key, band, at, since, signature, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (player) DO UPDATE SET handle = excluded.handle, key = excluded.key, band = excluded.band,
          at = excluded.at, since = excluded.since, signature = excluded.signature, version = excluded.version`)
        .run(player, handle, key, band, at, same ? current.since : now, JSON.stringify(signature), PROFILE_VERSION);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      if (/UNIQUE/.test(e.message)) throw new ProfileError(409, 'That handle is taken');
      throw e;
    }
    return this.get(player);
  }

  /** Refuse now what a claim of `handle` by `player` would be refused for, before their wallet signs it. */
  check(player, handle) {
    // No claim yet, so none to be stale.
    this.#check(playerOf(player), this.#key(handle), Infinity);
  }

  /** Refuse a starting level SurroundRatings doesn't allow now; 0 only from a rated player. */
  async #band(player, band) {
    if (band === 0) {
      if ((await this.chain.player(player)).phi !== 0n) return;
    } else if ((await this.chain.startBands()) & (1 << band)) return;
    throw new ProfileError(400, `Choose a starting level: ${bandList(await this.chain.startBands())}`);
  }

  /** `handle`'s key, if it may be a handle and isn't reserved. */
  #key(handle) {
    const problem = handleError(handle);
    if (problem) throw new ProfileError(400, problem);
    const key = handleKey(handle);
    if (this.reserved.has(key) || this.isReserved.get(key)) throw new ProfileError(409, 'That handle is reserved');
    return key;
  }

  /** Refuse a claim of `key` by `player` signed at `at`; their current row otherwise. */
  #check(player, key, at) {
    const now = this.now();
    const current = this.byPlayer.get(player);
    // A claim no newer than the one kept is an old one sent again.
    if (current && at <= current.at) throw new ProfileError(401, 'Stale request');
    if (current && current.key !== key && now - current.since < this.renameSeconds)
      throw new ProfileError(429, `You can choose another handle from ${dateOf(current.since + this.renameSeconds)}`);
    const owner = this.byKey.get(key);
    if ((owner && owner.player !== player) || this.held.get(key, now, player)) throw new ProfileError(409, 'That handle is taken');
    return current;
  }

  /**
   * Moderation: take `player`'s handle away, held for no one, and reserve it
   * unless `reserve` is false. Returns the claim taken, or null.
   */
  clear(player, { reserve = true, reason = '' } = {}) {
    const current = this.byPlayer.get(playerOf(player));
    if (!current) return null;
    const now = this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM profiles WHERE player = ?').run(current.player);
      this.db.prepare('INSERT INTO released (player, handle, key, reason, at, until) VALUES (?, ?, ?, ?, ?, ?)')
        .run(current.player, current.handle, current.key, 'cleared', now, 0);
      if (reserve) this.reserve(current.handle, reason || `cleared from ${current.player}`);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return claimOf(current);
  }

  /** Moderation: no one may claim `name` (in any case or with any separators). A player who has it keeps it. */
  reserve(name, reason = '') {
    this.db.prepare('INSERT INTO reserved (key, reason) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET reason = excluded.reason')
      .run(handleKey(name), reason);
  }

  /** Moderation: let `name` be claimed again, unless RESERVED or the config holds it. */
  unreserve(name) {
    return this.db.prepare('DELETE FROM reserved WHERE key = ?').run(handleKey(name)).changes > 0;
  }
}
