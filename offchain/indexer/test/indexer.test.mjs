// The indexer: SurroundRatings' events (decoded, as `chainSource` gives them)
// into rated games and each player's rank history, confirmed blocks only, a
// replaced block read again, and a rebuild from scratch; and players' history,
// rated and casual, as the matchmaker serves it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import { openDatabase } from '../../db/db.mjs';
import { History } from '../../db/history.mjs';
import { Indexer } from '../indexer.mjs';

const CHANNEL = 0x111n, OTHER = 0x222n;
const TURN = { turn_ms: 60000, bank_ms: 0, increment_ms: 0, byoyomi: null };
const BOARDS = { 9: 14, 19: 15 };
const [A, B, AI] = [0xa1n, 0xb2n, 0xa1a1n];

/** A chain of blocks the tests add events to and replace. */
function fakeSource() {
  const s = { head: 0, hashes: new Map(), events: [] };
  return {
    s,
    add(event) { s.events.push(event); s.head = Math.max(s.head, event.block); },
    replace(block) { s.hashes.set(block, `0xreplaced${block}`); s.events = s.events.filter(e => e.block < block); },
    source: {
      head: async () => s.head,
      blockHash: async n => s.hashes.get(n) ?? `0xhash${n}`,
      events: async (from, to) => s.events.filter(e => e.block >= from && e.block <= to),
    },
  };
}

/** A rated game's events: the ticket used, then black's and white's ratings, black winning. */
function rated(digest, black, white, block, { size = 19, played_at = 1_700_000_000, channel = CHANNEL } = {}) {
  const ticket = { player_0: black, player_1: white, config: c.goConfigHash(size, BOARDS[size]), clock: c.clockHash(TURN) };
  const side = (player, opponent, score, shown) => ({ type: 'RatingUpdated', player, digest, channel, game_id: digest + 1n,
    opponent, score, steps: 90, played_at: BigInt(played_at), applied: true, anchor: false, shown, block });
  return [{ type: 'TicketUsed', digest, channel, game_id: digest + 1n, ticket, block },
    side(black, white, 2, 140), side(white, black, 0, 120)];
}

test('rated games and ranks from the ratings events, of its channel only, confirmed blocks only', async () => {
  const db = openDatabase(':memory:'), chain = fakeSource();
  const indexer = new Indexer(db, { source: chain.source, channel: CHANNEL, from_block: 10, boards: BOARDS, clocks: { turn: TURN },
    confirmations: 2 });
  for (const e of rated(0x1000n, A, B, 11)) chain.add(e);
  for (const e of rated(0x2000n, A, B, 12, { channel: OTHER })) chain.add(e);
  chain.add({ type: 'GameVoided', digest: 0x3000n, channel: CHANNEL, game_id: 0x3001n, reason: 4, block: 12 });
  // Block 12 isn't confirmed yet: only block 11 is read.
  chain.s.head = 13;
  assert.equal(await indexer.tick(), 3);
  const history = new History(db);
  const [game] = history.games(A);
  assert.deepEqual(game, { kind: 'rated', id: '0x1000', game_id: '0x1001', black: p.hex(A), white: p.hex(B), size: 19,
    clock: 'turn', winner: 1, steps: 90, at: 1_700_000_000, reason: null, voided: null });
  assert.deepEqual(history.ranks(B).map(r => [r.digest, r.score, r.shown]), [['0x1000', 0, 120]]);
  // Two blocks later block 12 is confirmed: the voided game, and nothing of the other channel.
  chain.s.head = 14;
  assert.equal(await indexer.tick(), 1);
  assert.equal(db.prepare('SELECT voided FROM rated_games WHERE digest = ?').get('0x3000').voided, 4);
  assert.equal(db.prepare('SELECT count(*) AS n FROM rated_games').get().n, 2);
});

test('a replaced block is read again; a rebuild reads everything again', async () => {
  const db = openDatabase(':memory:'), chain = fakeSource();
  const indexer = new Indexer(db, { source: chain.source, channel: CHANNEL, from_block: 10, boards: BOARDS, clocks: { turn: TURN },
    confirmations: 0, rewind: 5 });
  for (const e of rated(0x1000n, A, B, 11)) chain.add(e);
  for (const e of rated(0x2000n, B, A, 14, { played_at: 1_700_000_100 })) chain.add(e);
  await indexer.tick();
  assert.equal(new History(db).games(A).length, 2);
  // Block 14 is replaced by one without the second game, and the chain goes on.
  chain.replace(14);
  chain.s.head = 15;
  await indexer.tick();
  assert.deepEqual(new History(db).games(A).map(g => g.id), ['0x1000']);
  indexer.rebuild();
  assert.equal(new History(db).games(A).length, 0);
  await indexer.tick();
  assert.deepEqual(new History(db).games(A).map(g => g.id), ['0x1000']);
});

test('a player\'s history: rated and casual games together, newest first, a page at a time', async () => {
  const db = openDatabase(':memory:'), chain = fakeSource(), history = new History(db);
  const indexer = new Indexer(db, { source: chain.source, channel: CHANNEL, boards: BOARDS, clocks: { turn: TURN }, confirmations: 0 });
  for (const e of rated(0x1000n, A, AI, 1, { played_at: 1_700_000_200 })) chain.add(e);
  await indexer.tick();
  const casual = (id, ended_at) => ({ id, game_id: id + 1n, black: B, white: A, size: 9, komi_half: 14, clock: 'untimed',
    keeper: 'http://keeper.test', started_at: ended_at - 600, ended_at, winner: 2, reason: 128, steps: 41, record: '{}' });
  history.recordCasual(casual(0x5000n, 1_700_000_100));
  history.recordCasual(casual(0x6000n, 1_700_000_300));
  // Kept once, as it was.
  history.recordCasual({ ...casual(0x6000n, 1_700_000_300), winner: 1 });
  const games = history.games(A);
  assert.deepEqual(games.map(g => [g.kind, g.id, g.winner]), [['casual', '0x6000', 2], ['rated', '0x1000', 1], ['casual', '0x5000', 2]]);
  assert.deepEqual(history.games(A, { before: 1_700_000_200, limit: 5 }).map(g => g.id), ['0x5000']);
  assert.deepEqual(history.games(A, { limit: 1 }).map(g => g.id), ['0x6000']);
  assert.equal(history.record(0x5000n), '{}');
});
