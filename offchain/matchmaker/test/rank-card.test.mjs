// Minting rated players' rank cards (rank-card.mjs): which players, once each,
// what the chain refuses for good, and what is only tried again.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../sdk/src/index.mjs';
import { openDatabase } from '../../db/db.mjs';
import { RankCards } from '../../db/rank-cards.mjs';
import { RankCardMinter } from '../rank-card.mjs';
import { address } from './fake.mjs';

/**
 * A rank card contract as `mint` checks a call: a rated player who isn't an
 * AI, once. `rated`, `ai`, `failEstimate`, `failMint` and `fee` are the tests' to change.
 */
function cardChain() {
  const state = { rated: new Set(), ai: new Set(), minted: new Set(), mints: [], fee: 10n, failEstimate: false, failMint: false };
  const check = player => {
    if (state.ai.has(player)) throw Error("execution reverted: 'No card for an AI'");
    if (!state.rated.has(player)) throw Error("execution reverted: 'No rated game yet'");
    if (state.minted.has(player)) throw Error("execution reverted: 'Card already minted'");
  };
  return {
    state,
    cardMinted: async player => state.minted.has(player),
    estimateCard: async player => {
      if (state.failEstimate) throw Error('the node answered nothing');
      check(player);
      return { fee: state.fee, resourceBounds: {} };
    },
    mintCard: async player => {
      check(player);
      if (state.failMint) throw Error('the node answered nothing');
      state.mints.push(player);
      state.minted.add(player);
      return `0xc${state.mints.length}`;
    },
  };
}

/** A database the indexer filled; `rate(black, white, { ai })` adds a rated game between them. */
function database() {
  const db = openDatabase(':memory:');
  let block = 0;
  const rate = (black, white, { ai = null, applied = 1 } = {}) => {
    block++;
    const digest = p.hex(0xd000n + BigInt(block));
    for (const [player, opponent, seat] of [[black, white, 'black'], [white, black, 'white']])
      db.prepare(`INSERT INTO rank_history (player, digest, game_id, opponent, score, shown, applied, anchor, played_at, block)
        VALUES (?, ?, ?, ?, 1, 100, ?, ?, ?, ?)`)
        .run(player, digest, p.hex(block), opponent, applied, ai === seat ? 1 : 0, block, block);
  };
  return { db, cards: new RankCards(db), rate };
}

function minter(cards, config = {}, chain = cardChain()) {
  const logs = [], clock = { ms: 1_700_000_000_000 };
  const m = new RankCardMinter({ max_attempts: 3, ...config }, chain, cards, { log: l => logs.push(l), now: () => clock.ms });
  return { m, chain, logs, clock };
}

const [ann, bo, cy, ai] = ['ann', 'bo', 'cy', 'ai'].map(address);

test('each rated player gets one card, first rated first, and no AI does', async () => {
  const { cards, rate } = database();
  rate(ann, bo);
  rate(cy, ai, { ai: 'white' });
  rate(ann, cy);
  assert.deepEqual(cards.due(), [ann, bo, cy]);
  const { m, chain } = minter(cards);
  for (const player of [ann, bo, cy]) chain.state.rated.add(player);
  assert.deepEqual(await m.tick(), { minted: [ann, bo, cy], none: [], failed: [] });
  assert.deepEqual(chain.state.mints, [ann, bo, cy]);
  assert.equal(cards.get(ann).tx, '0xc1');
  // Another game changes nothing: the card follows it onchain.
  rate(ann, bo);
  assert.deepEqual(cards.due(), []);
  assert.deepEqual(await m.tick(), { minted: [], none: [], failed: [] });
});

test('a player no rated game counted for is not due', async () => {
  const { cards, rate } = database();
  // The chain rated the game for neither: no rating to show, and `mint` would refuse it.
  rate(ann, bo, { applied: 0 });
  assert.deepEqual(cards.due(), []);
  rate(ann, cy);
  assert.deepEqual(cards.due(), [ann, cy]);
});

test('a card minted elsewhere is only recorded', async () => {
  const { cards, rate } = database();
  rate(ann, bo);
  const { m, chain } = minter(cards);
  chain.state.rated.add(ann).add(bo);
  chain.state.minted.add(ann);
  assert.deepEqual(await m.tick(), { minted: [ann, bo], none: [], failed: [] });
  assert.deepEqual(chain.state.mints, [bo]);
  assert.equal(cards.get(ann).tx, null);
});

test('an AI the chain knows of is refused for good', async () => {
  const { cards, rate } = database();
  // The indexer missed the anchor's mark; the chain didn't.
  rate(ann, ai);
  const { m, chain, logs } = minter(cards);
  chain.state.rated.add(ann).add(ai);
  chain.state.ai.add(ai);
  assert.deepEqual(await m.tick(), { minted: [ann], none: [ai], failed: [] });
  assert.deepEqual({ ...cards.get(ai) }, { status: 'none', reason: 'No card for an AI', tx: null, at: 1_700_000_000 });
  assert.match(logs[1], /refused by the chain: No card for an AI/);
  assert.deepEqual(cards.due(), []);
});

test('what may pass is tried again, then rests after max_attempts', async () => {
  const { cards, rate } = database();
  rate(ann, bo);
  const { m, chain, logs, clock } = minter(cards, { retry_seconds: 60 });
  // The node hasn't seen the rating yet.
  chain.state.rated.add(bo);
  assert.deepEqual(await m.tick(), { minted: [bo], none: [], failed: [ann] });
  assert.deepEqual(await m.tick(), { minted: [], none: [], failed: [ann] });
  assert.deepEqual(await m.tick(), { minted: [], none: [], failed: [ann] });
  assert.match(logs.at(-1), /ALERT: rank card of .* still not minted after 3 attempts \(.*No rated game yet/);
  // Resting: not tried.
  assert.deepEqual(await m.tick(), { minted: [], none: [], failed: [] });
  clock.ms += 61_000;
  chain.state.rated.add(ann);
  assert.deepEqual(await m.tick(), { minted: [ann], none: [], failed: [] });
});

test('a fee over max_fee_fri and a failed send mint nothing', async () => {
  const { cards, rate } = database();
  rate(ann, bo);
  const { m, chain } = minter(cards, { max_fee_fri: 5, per_round: 1 });
  chain.state.rated.add(ann).add(bo);
  assert.deepEqual(await m.tick(), { minted: [], none: [], failed: [ann] });
  m.maxFee = null;
  chain.state.failMint = true;
  assert.deepEqual(await m.tick(), { minted: [], none: [], failed: [ann] });
  assert.deepEqual(chain.state.mints, []);
  assert.equal(cards.get(ann), null);
  chain.state.failMint = false;
  assert.deepEqual(await m.tick(), { minted: [ann], none: [], failed: [] });
});
