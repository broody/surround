// Who plays whom in rated games: the quick-match queue and brokered open
// tables. Pure bookkeeping with no I/O; the server feeds it ranks and times
// (milliseconds) and turns its pairings into signed tickets.
//
// Rules, from RANKING_PLAN.md and HARDENING_PLAN.md (O1):
// - a pairing has one board size and one clock preset;
// - the rank gap starts at `gap_tenths` and widens with the longer wait by
//   `widen_tenths` per `widen_ms`, up to `max_gap_tenths` (tables use the maximum);
// - the same two players are paired at most `max_repeats` times per `repeat_ms`;
// - a player holds at most `max_open` unfinished rated games;
// - a player who didn't sign a game's terms in time waits `cooldown_ms`;
// - a player who aborts `abort_limit` games (too short to rate) within
//   `abort_window_ms` waits `abort_cooldown_ms`;
// - players in `banned` (e.g. caught using an engine) get no rated games.
// The weaker player takes black; at equal rank, the longer waiter does.
import { randomBytes } from 'node:crypto';

export const DEFAULT_RULES = {
  gap_tenths: 30, widen_tenths: 10, widen_ms: 30_000, max_gap_tenths: 90,
  max_repeats: 2, repeat_ms: 24 * 3600_000, max_open: 1, cooldown_ms: 15 * 60_000,
  abort_limit: 3, abort_window_ms: 24 * 3600_000, abort_cooldown_ms: 60 * 60_000,
};

export const QUEUE = 1, TABLE = 2;

/** Finished pairings remembered, so a late second `finished` changes nothing. */
const DONE_KEPT = 10_000;

/** A player's address in one spelling (hex case and zero padding vary). */
const spelling = player => { try { return BigInt(player).toString(16); } catch { return String(player); } };

export class Lobby {
  constructor(rules = {}) {
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.banned = new Set((rules.banned ?? []).map(spelling));
    this.queue = new Map();     // player -> { player, key, size, clock, band, rank, since }
    this.tables = new Map();    // id -> { id, host, key, size, clock, band, rank, since }
    this.open = new Map();      // player -> unfinished rated games
    this.done = new Set();      // digests of finished pairings, oldest first
    this.cooldowns = new Map(); // player -> until
    this.aborts = new Map();    // player -> times of recent aborted games
    this.history = [];          // { a, b, at } pairings, oldest first
  }

  /** What survives a restart (the queue and tables don't). */
  snapshot() {
    return { open: [...this.open], done: [...this.done], cooldowns: [...this.cooldowns], aborts: [...this.aborts], history: this.history };
  }

  restore(state) {
    this.open = new Map(state.open ?? []);
    this.done = new Set(state.done ?? []);
    this.cooldowns = new Map(state.cooldowns ?? []);
    this.aborts = new Map(state.aborts ?? []);
    this.history = state.history ?? [];
  }

  /** Why `player` can't be paired now, or null. */
  blocked(player, now) {
    if (this.banned.has(spelling(player))) return 'Not allowed rated games';
    if ((this.cooldowns.get(player) ?? 0) > now) return 'Cooling down after a missed or aborted game';
    if ((this.open.get(player) ?? 0) >= this.rules.max_open) return 'Finish your rated game first';
    return null;
  }

  /** Join the queue. `rank` is in tenths (0 = 30k, 300 = 1d); `key` is the session key the player will play with. */
  enqueue({ player, key, size, clock, band, rank }, now) {
    const reason = this.blocked(player, now);
    if (reason) throw new LobbyError(409, reason);
    if (this.hosting(player)) throw new LobbyError(409, 'Close your table first');
    this.queue.set(player, { player, key, size, clock, band, rank, since: this.queue.get(player)?.since ?? now });
  }

  leave(player) { return this.queue.delete(player); }

  /** Pair the queue, oldest first, each with its closest allowed opponent; at most `limit` pairings. */
  pair(now, limit = Infinity) {
    // A player whose game or cooldown began after they queued leaves the queue.
    for (const { player } of [...this.queue.values()]) if (this.blocked(player, now)) this.queue.delete(player);
    const pairings = [];
    const waiting = [...this.queue.values()].sort((x, y) => x.since - y.since);
    const taken = new Set();
    for (const a of waiting) {
      if (pairings.length >= limit) break;
      if (taken.has(a.player)) continue;
      let best = null;
      for (const b of waiting) {
        if (b === a || taken.has(b.player) || b.size !== a.size || b.clock !== a.clock) continue;
        const gap = Math.abs(a.rank - b.rank);
        if (gap > this.allowedGap(Math.min(a.since, b.since), now) || !this.allowed(a.player, b.player, now)) continue;
        if (!best || gap < best.gap) best = { b, gap };
      }
      if (!best) continue;
      taken.add(a.player); taken.add(best.b.player);
      pairings.push(this.#pairing(a, best.b, QUEUE, now));
    }
    for (const p of pairings) { this.queue.delete(p.black); this.queue.delete(p.white); }
    return pairings;
  }

  /** Open a table: the host will play black against whoever the lobby lets join. Its id is random. */
  host({ player, key, size, clock, band, rank }, now) {
    const reason = this.blocked(player, now);
    if (reason) throw new LobbyError(409, reason);
    if (this.queue.has(player)) throw new LobbyError(409, 'Leave the queue first');
    if (this.hosting(player)) throw new LobbyError(409, 'You already host a table');
    const id = randomBytes(8).toString('hex');
    this.tables.set(id, { id, host: player, key, size, clock, band, rank, since: now });
    return id;
  }

  hosting(player) { return [...this.tables.values()].some(t => t.host === player); }

  close(id, player) {
    const table = this.tables.get(id);
    if (!table) throw new LobbyError(404, 'No such table');
    if (table.host !== player) throw new LobbyError(403, 'Not your table');
    this.tables.delete(id);
  }

  /** Join an open table; returns the pairing, host as black. */
  join(id, { player, key, band, rank }, now) {
    const table = this.tables.get(id);
    if (!table) throw new LobbyError(404, 'No such table');
    if (table.host === player) throw new LobbyError(409, 'That is your table');
    const reason = this.blocked(player, now) ?? (this.blocked(table.host, now) && 'The host is busy');
    if (reason) throw new LobbyError(409, reason);
    if (Math.abs(table.rank - rank) > this.rules.max_gap_tenths) throw new LobbyError(409, 'Ranks too far apart');
    if (!this.allowed(table.host, player, now)) throw new LobbyError(409, 'You have played this host enough today');
    this.tables.delete(id);
    this.queue.delete(player);
    return this.#pairing({ ...table, player: table.host }, { player, key, size: table.size, clock: table.clock, band, rank, since: now },
      TABLE, now, true);
  }

  /** A pairing's game is open though the lobby lost it (a matchmaker rebuilt from the chain). */
  adopt(pairing) {
    if (this.done.has(pairing.digest)) return;
    for (const p of [pairing.black, pairing.white]) this.open.set(p, (this.open.get(p) ?? 0) + 1);
  }

  /**
   * A pairing ended: its game finished or settled, or it never got going (a
   * seat didn't sign its terms, or no keeper took it). Counted once per
   * `pairing.digest`; returns false if it already was.
   */
  finished(pairing) {
    if (pairing.digest !== undefined) {
      if (this.done.has(pairing.digest)) return false;
      this.done.add(pairing.digest);
      if (this.done.size > DONE_KEPT) this.done.delete(this.done.values().next().value);
    }
    for (const player of [pairing.black, pairing.white]) {
      const n = (this.open.get(player) ?? 0) - 1;
      if (n > 0) this.open.set(player, n); else this.open.delete(player);
    }
    return true;
  }

  /** `player` didn't sign its game's terms in time. */
  missed(player, now) { this.#cool(player, now + this.rules.cooldown_ms); }

  /** `player` ended a game too short to rate; returns whether that earned a cooldown. */
  aborted(player, now) {
    const r = this.rules;
    const recent = [...(this.aborts.get(player) ?? []).filter(at => now - at < r.abort_window_ms), now];
    this.aborts.set(player, recent);
    if (recent.length < r.abort_limit) return false;
    this.#cool(player, now + r.abort_cooldown_ms);
    this.aborts.delete(player);
    return true;
  }

  #cool(player, until) { this.cooldowns.set(player, Math.max(until, this.cooldowns.get(player) ?? 0)); }

  allowedGap(since, now) {
    const r = this.rules;
    return Math.min(r.max_gap_tenths, r.gap_tenths + Math.floor((now - since) / r.widen_ms) * r.widen_tenths);
  }

  allowed(a, b, now) {
    const recent = this.history.filter(h => now - h.at < this.rules.repeat_ms);
    this.history = recent;
    return recent.filter(h => (h.a === a && h.b === b) || (h.a === b && h.b === a)).length < this.rules.max_repeats;
  }

  #pairing(a, b, source, now, hostIsBlack = false) {
    // The weaker player takes black; at equal rank, the longer waiter does.
    const aBlack = hostIsBlack || a.rank < b.rank || (a.rank === b.rank && a.since <= b.since);
    const [black, white] = aBlack ? [a, b] : [b, a];
    this.history.push({ a: black.player, b: white.player, at: now });
    for (const p of [black.player, white.player]) this.open.set(p, (this.open.get(p) ?? 0) + 1);
    return { black: black.player, white: white.player, size: a.size, clock: a.clock, source,
      black_band: black.band, white_band: white.band, black_key: black.key, white_key: white.key, at: now };
  }
}

export class LobbyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
