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
    clock: 'turn', winner: 1, steps: 90, at: 1_700_000_000, reason: null, voided: null, moved: null });
  assert.deepEqual(history.ranks(B).ranks.map(r => [r.digest, r.score, r.shown]), [['0x1000', 0, 120]]);
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

test('a rank chart of thousands of games: the newest, shared out in runs, in a few hundred entries', () => {
  const db = openDatabase(':memory:'), history = new History(db);
  const insert = db.prepare(`INSERT INTO rank_history (player, digest, game_id, opponent, score, shown, applied, anchor,
    played_at, block) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`);
  // 3000 games: won, lost, lost, won, ... ; the rank after game i is 100 + i % 50, played a minute apart.
  const GAMES = 3000, T = 1_700_000_000;
  const score = i => (i % 4 === 0 || i % 4 === 3 ? 2 : 0);
  for (let i = 0; i < GAMES; i++) insert.run(p.hex(A), p.hex(0x10000n + BigInt(i)), '0x1', p.hex(B), score(i), 100 + (i % 50), T + 60 * i, i);
  // Few enough: one entry a game, the newest `last` of them, oldest first.
  const recent = history.ranks(A, { last: 20 });
  assert.equal(recent.total, GAMES);
  assert.deepEqual(recent.ranks.map(r => r.played_at), Array.from({ length: 20 }, (_, k) => T + 60 * (GAMES - 20 + k)));
  assert.deepEqual(recent.ranks.at(-1), { digest: p.hex(0x10000n + BigInt(GAMES - 1)), game_id: '0x1', opponent: p.hex(B),
    score: 2, shown: 149, applied: true, played_at: T + 60 * (GAMES - 1), games: 1, low: 149, high: 149, wins: 1, draws: 0,
    losses: 0, first_at: T + 60 * (GAMES - 1) });
  // All of them: 200 runs of 15, every game in one, each with its range and record.
  const all = history.ranks(A);
  assert.equal(all.ranks.length, 200);
  assert.equal(all.ranks.reduce((n, r) => n + r.games, 0), GAMES);
  assert.deepEqual(all.ranks[0], { games: 15, shown: 114, low: 100, high: 114, wins: 7, draws: 0, losses: 8, first_at: T,
    played_at: T + 60 * 14 });
  assert.equal(all.ranks.at(-1).shown, 149);
  assert.equal(all.ranks.at(-1).played_at, T + 60 * (GAMES - 1));
  // Uneven shares still cover every game once, and the newest 1000 start where they should.
  const odd = history.ranks(A, { points: 7, last: 1000 });
  assert.deepEqual(odd.ranks.map(r => r.games), [142, 143, 143, 143, 143, 143, 143]);
  assert.equal(odd.ranks[0].first_at, T + 60 * (GAMES - 1000));
  // Nonsense asks get the defaults; a player with no games gets none.
  assert.equal(history.ranks(A, { points: 'x', last: -3 }).ranks.length, 200);
  assert.deepEqual(history.ranks(B), { total: 0, ranks: [] });
});

test('each rated game in a player\'s history says how it moved their rank', async () => {
  const db = openDatabase(':memory:'), chain = fakeSource(), history = new History(db);
  const indexer = new Indexer(db, { source: chain.source, channel: CHANNEL, boards: BOARDS, clocks: { turn: TURN }, confirmations: 0 });
  // A wins both (140 after each, from the fake events); B loses both (120). Then B beats A once.
  for (const e of rated(0x1000n, A, B, 1, { played_at: 1_700_000_100 })) chain.add(e);
  for (const e of rated(0x2000n, A, B, 2, { played_at: 1_700_000_200 })) chain.add(e);
  const [win, loss] = rated(0x3000n, B, A, 3, { played_at: 1_700_000_300 }).slice(1);
  chain.add(rated(0x3000n, B, A, 3, { played_at: 1_700_000_300 })[0]);
  chain.add({ ...win, shown: 135 });
  chain.add({ ...loss, shown: 131 });
  await indexer.tick();
  assert.deepEqual(history.games(A).map(g => [g.id, g.moved]), [['0x3000', -9], ['0x2000', 0], ['0x1000', null]]);
  assert.deepEqual(history.games(B).map(g => [g.id, g.moved]), [['0x3000', 15], ['0x2000', 0], ['0x1000', null]]);
});
