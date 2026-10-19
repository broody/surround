// The indexer: SurroundRatings' events, read into the Surround database's
// rebuildable tables (db.mjs: `rated_games`, `rank_history`), for players'
// history and profile pages. The chain stays the source of truth: a rebuild
// empties those tables and reads them again from the deploy block.
//
// It reads up to `confirmations` blocks behind the tip and remembers the last
// block's hash; if that block was replaced, it rewinds `rewind` blocks and
// reads them again. Each round is one write transaction.
import * as p from '../sdk/src/index.mjs';
import * as c from '../sdk/src/client.mjs';
import { decodeEvent } from '../sdk/src/replay.mjs';
import { allEvents } from '../matchmaker/chain.mjs';
import { REBUILDABLE } from '../db/db.mjs';

const CURSOR = 'ratings';
const hexOf = value => p.hex(p.felt(value));

/**
 * Where the events come from: `head()`, the latest block's number;
 * `blockHash(n)`; and `events(from, to)`, SurroundRatings' events in those
 * blocks, decoded (`decodeEvent`), in chain order, each with its `block`.
 */
export function chainSource(provider, ratings) {
  return {
    head: () => provider.getBlockNumber(),
    blockHash: async n => (await provider.getBlockWithTxHashes(n)).block_hash,
    events: async (from, to) => (await allEvents(provider, { address: hexOf(ratings) }, from, to))
      .map(e => { const d = decodeEvent(e); return d && { ...d, block: e.block_number }; })
      .filter(Boolean),
  };
}

export class Indexer {
  /**
   * `source`: see `chainSource`. `channel`: the channel whose games to keep
   * (SurroundRatings may rate others'). `from_block`: where to start, its
   * deploy block. `boards` ({ size: komi_half }) and `clocks` ({ name:
   * settings }), the matchmaker's, name a ticket's board and clock from their
   * hashes.
   */
  constructor(db, { source, channel, from_block = 0, boards = {}, clocks = {}, confirmations = 2, rewind = 20, log = () => {} }) {
    this.db = db;
    this.source = source;
    this.channel = p.felt(channel);
    this.fromBlock = from_block;
    this.confirmations = confirmations;
    this.rewindBlocks = rewind;
    this.log = log;
    this.sizes = new Map(Object.entries(boards).map(([size, komi]) => [c.goConfigHash(Number(size), komi), Number(size)]));
    this.clocks = new Map(Object.entries(clocks).map(([name, settings]) => [c.clockHash(settings), name]));
  }

  #cursor() {
    return this.db.prepare('SELECT block, hash FROM indexer_cursor WHERE name = ?').get(CURSOR) ?? null;
  }

  /** Empty the rebuildable tables: the next round reads everything again from `from_block`. */
  rebuild() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of REBUILDABLE) this.db.exec(`DELETE FROM ${table}`);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** One round: read the confirmed blocks since the last; returns how many events it kept. */
  async tick() {
    const to = (await this.source.head()) - this.confirmations;
    let cursor = this.#cursor();
    if (cursor && (await this.source.blockHash(cursor.block)) !== cursor.hash) {
      const back = Math.max(this.fromBlock - 1, cursor.block - this.rewindBlocks);
      this.log(`block ${cursor.block} was replaced: reading again from ${back + 1}`);
      this.#forget(back);
      cursor = back < this.fromBlock ? null : { block: back };
    }
    const from = cursor ? cursor.block + 1 : this.fromBlock;
    if (from > to) return 0;
    const events = (await this.source.events(from, to)).filter(e => p.felt(e.channel ?? 0) === this.channel);
    const hash = await this.source.blockHash(to);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const e of events) this.#apply(e);
      this.db.prepare(`INSERT INTO indexer_cursor (name, block, hash) VALUES (?, ?, ?)
        ON CONFLICT (name) DO UPDATE SET block = excluded.block, hash = excluded.hash`).run(CURSOR, to, String(hash));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    if (events.length) this.log(`read ${events.length} events, blocks ${from}–${to}`);
    return events.length;
  }

  /** Forget what was read after block `block`, as if it never was. */
  #forget(block) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM rated_games WHERE block > ?').run(block);
      this.db.prepare('DELETE FROM rank_history WHERE block > ?').run(block);
      this.db.prepare('DELETE FROM indexer_cursor WHERE name = ?').run(CURSOR);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  #apply(e) {
    const digest = hexOf(e.digest);
    if (e.type === 'TicketUsed') {
      const t = e.ticket;
      this.db.prepare(`INSERT INTO rated_games (digest, channel, game_id, black, white, size, clock, block)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (digest) DO UPDATE SET black = excluded.black, white = excluded.white,
        size = excluded.size, clock = excluded.clock`)
        .run(digest, hexOf(e.channel), hexOf(e.game_id), hexOf(t.player_0), hexOf(t.player_1),
          this.sizes.get(p.felt(t.config)) ?? null, this.clocks.get(p.felt(t.clock)) ?? null, e.block);
    } else if (e.type === 'RatingUpdated') {
      const player = hexOf(e.player);
      this.db.prepare(`INSERT OR REPLACE INTO rank_history (player, digest, game_id, opponent, score, shown, applied, anchor,
        played_at, block) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(player, digest, hexOf(e.game_id), hexOf(e.opponent), e.score, e.shown, e.applied ? 1 : 0, e.anchor ? 1 : 0,
          Number(e.played_at), e.block);
      this.db.prepare(`INSERT INTO rated_games (digest, channel, game_id, steps, played_at, block) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (digest) DO UPDATE SET steps = excluded.steps, played_at = excluded.played_at`)
        .run(digest, hexOf(e.channel), hexOf(e.game_id), e.steps, Number(e.played_at), e.block);
      // The winner, from black's side (the ticket's seat 0) once the ticket named it.
      const winner = e.score === 2 ? 1 : e.score === 0 ? 2 : 0;
      this.db.prepare('UPDATE rated_games SET winner = ? WHERE digest = ? AND black = ?').run(winner, digest, player);
    } else if (e.type === 'GameVoided') {
      this.db.prepare(`INSERT INTO rated_games (digest, channel, game_id, voided, block) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (digest) DO UPDATE SET voided = excluded.voided`)
        .run(digest, hexOf(e.channel), hexOf(e.game_id), e.reason, e.block);
    }
  }
}
