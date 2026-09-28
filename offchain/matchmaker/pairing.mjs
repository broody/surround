// Who plays whom in rated games: the quick-match queue and brokered open
// tables. Pure bookkeeping with no I/O; the server feeds it ranks and times
// (milliseconds) and turns its pairings into signed tickets.
//
// Rules, from RANKING_PLAN.md:
// - a pairing has one board size and one clock preset;
// - the rank gap starts at `gap_tenths` and widens with the longer wait by
//   `widen_tenths` per `widen_ms`, up to `max_gap_tenths` (tables use the maximum);
// - the same two players are paired at most `max_repeats` times per `repeat_ms`;
// - a player holds at most `max_open` unfinished rated games;
// - a player who didn't create or join a game in time waits `cooldown_ms`;
// - players in `banned` (e.g. caught using an engine) get no rated games.
// The weaker player takes black; at equal rank, the longer waiter does.

export const DEFAULT_RULES = {
  gap_tenths: 30, widen_tenths: 10, widen_ms: 30_000, max_gap_tenths: 90,
  max_repeats: 2, repeat_ms: 24 * 3600_000, max_open: 1, cooldown_ms: 15 * 60_000,
};

export const QUEUE = 1, TABLE = 2;

/** A player's address in one spelling (hex case and zero padding vary). */
const key = player => { try { return BigInt(player).toString(16); } catch { return String(player); } };

export class Lobby {
  constructor(rules = {}) {
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.banned = new Set((rules.banned ?? []).map(key));
    this.queue = new Map();     // player -> { player, size, clock, band, rank, since }
    this.tables = new Map();    // id -> { id, host, size, clock, band, rank, since }
    this.open = new Map();      // player -> unfinished rated games
    this.cooldowns = new Map(); // player -> until
    this.history = [];          // { a, b, at } pairings, oldest first
    this.nextTable = 1;
  }

  /** Why `player` can't be paired now, or null. */
  blocked(player, now) {
    if (this.banned.has(key(player))) return 'Not allowed rated games';
    if ((this.cooldowns.get(player) ?? 0) > now) return 'Cooling down after a missed game';
    if ((this.open.get(player) ?? 0) >= this.rules.max_open) return 'Finish your rated game first';
    return null;
  }

  /** Join the queue. `rank` is in tenths (0 = 30k, 300 = 1d). */
  enqueue({ player, size, clock, band, rank }, now) {
    const reason = this.blocked(player, now);
    if (reason) throw new LobbyError(409, reason);
    if (this.hosting(player)) throw new LobbyError(409, 'Close your table first');
    this.queue.set(player, { player, size, clock, band, rank, since: this.queue.get(player)?.since ?? now });
  }

  leave(player) { return this.queue.delete(player); }

  /** Pair the queue, oldest first, each with its closest allowed opponent. */
  pair(now) {
    const pairings = [];
    const waiting = [...this.queue.values()].sort((x, y) => x.since - y.since);
    const taken = new Set();
    for (const a of waiting) {
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

  /** Open a table: the host will play black against whoever the lobby lets join. */
  host({ player, size, clock, band, rank }, now) {
    const reason = this.blocked(player, now);
    if (reason) throw new LobbyError(409, reason);
    if (this.queue.has(player)) throw new LobbyError(409, 'Leave the queue first');
    if (this.hosting(player)) throw new LobbyError(409, 'You already host a table');
    const id = String(this.nextTable++);
    this.tables.set(id, { id, host: player, size, clock, band, rank, since: now });
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
  join(id, { player, band, rank }, now) {
    const table = this.tables.get(id);
    if (!table) throw new LobbyError(404, 'No such table');
    if (table.host === player) throw new LobbyError(409, 'That is your table');
    const reason = this.blocked(player, now) ?? (this.blocked(table.host, now) && 'The host is busy');
    if (reason) throw new LobbyError(409, reason);
    if (Math.abs(table.rank - rank) > this.rules.max_gap_tenths) throw new LobbyError(409, 'Ranks too far apart');
    if (!this.allowed(table.host, player, now)) throw new LobbyError(409, 'You have played this host enough today');
    this.tables.delete(id);
    this.queue.delete(player);
    return this.#pairing({ ...table, player: table.host }, { player, size: table.size, clock: table.clock, band, rank, since: now }, TABLE, now, true);
  }

  /** A paired game ended (settled or cancelled) or its ticket went unused. */
  finished(pairing) {
    for (const player of [pairing.black, pairing.white]) {
      const n = (this.open.get(player) ?? 0) - 1;
      if (n > 0) this.open.set(player, n); else this.open.delete(player);
    }
  }

  /** `player` didn't create (black) or join (white) in time. */
  missed(player, now) { this.cooldowns.set(player, now + this.rules.cooldown_ms); }

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
      black_band: black.band, white_band: white.band, at: now };
  }
}

export class LobbyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
