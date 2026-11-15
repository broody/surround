// Minting rated games' kifus (kifu.mjs): which games, from what record, once
// each, what the chain refuses for good, and what is only tried again.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import { openDatabase } from '../../db/db.mjs';
import { Kifus } from '../../db/kifus.mjs';
import { KifuMinter } from '../kifu.mjs';
import { serve } from '../server.mjs';
import { CHANNEL, address, harness, keeperFetch } from './fake.mjs';

/**
 * A kifu contract as `mint` checks a call: the game must be settled and won,
 * minted once, and its record must decode to the anchor's steps and final
 * position. `refuse`, `failEstimate`, `failMint` and `fee` are the tests' to change.
 */
function kifuChain(games) {
  const state = { minted: new Map(), estimates: [], mints: [], fee: 10n, refuse: null, failEstimate: false, failMint: false };
  const check = ({ game_id, anchor, record }) => {
    const id = p.hex(game_id), game = games.get(id);
    if (!game) throw Error("execution reverted: 'Game not settled'");
    if (state.refuse) throw Error(`execution reverted: '${state.refuse}'`);
    if (state.minted.has(id)) throw Error("execution reverted: 'Kifu already minted'");
    const { steps, board } = c.decodeKifu(game.size, Number(anchor.seq), record);
    if (steps.length !== Number(anchor.seq) || p.json(board) !== p.json(anchor.game.board)) throw Error("execution reverted: 'Wrong move record'");
  };
  return {
    state,
    kifuMinted: async id => state.minted.has(p.hex(id)),
    estimateMint: async game => {
      state.estimates.push(p.hex(game.game_id));
      if (state.failEstimate) throw Error('the node answered nothing');
      check(game);
      return { fee: state.fee, resourceBounds: {} };
    },
    mint: async game => {
      check(game);
      if (state.failMint) throw Error('the node answered nothing');
      state.mints.push(p.hex(game.game_id));
      state.minted.set(p.hex(game.game_id), game);
      return `0xk${state.mints.length}`;
    },
  };
}

/** A database the indexer filled: `rows` are rated games, `{ game_id, winner, voided? }`. */
function database() {
  const db = openDatabase(':memory:');
  let block = 0;
  const add = ({ game_id, winner = null, voided = null, steps = 1, channel = CHANNEL }) => {
    block++;
    db.prepare(`INSERT INTO rated_games (digest, channel, game_id, black, white, size, clock, winner, steps, played_at, voided, block)
      VALUES (?, ?, ?, ?, ?, 19, 'turn', ?, ?, ?, ?, ?)`)
      .run(p.hex(0xd000n + BigInt(block)), p.hex(channel), p.hex(game_id), address('ann'), address('bo'), winner, steps, block, voided, block);
  };
  return { db, kifus: new Kifus(db), add };
}

/** `n` games, each between two new players, on the harness's keeper, each resigned by black: won by white. */
async function played(n = 1) {
  const h = await harness();
  const games = new Map();
  for (let i = 0; i < n; i++) {
    const game = await h.play(`black${i}`, `white${i}`);
    h.resign(game, 0);
    h.settle(game, 2);
    await h.matchmaker.tick();
    games.set(p.hex(game.game_id), { ...game, size: 19, session: game.keeper.games.get(`/games/${p.hex(CHANNEL)}/${p.hex(game.game_id)}`) });
  }
  return { h, games };
}

function minter(h, games, kifus, config = {}, chain = kifuChain(games)) {
  const logs = [], clock = { ms: 1_700_000_000_000 };
  const m = new KifuMinter({ max_attempts: 3, ...config }, chain, kifus,
    { channel: CHANNEL, keepers: h.keepers.map(k => ({ url: k.url })), fetch: keeperFetch(h.keepers), log: l => logs.push(l),
      now: () => clock.ms });
  return { m, chain, logs, clock };
}

test("a rated game's kifu is minted once, from its keeper's record of every step", async () => {
  const { h, games } = await played();
  const [id] = games.keys(), game = games.get(id);
  const { kifus, add } = database();
  add({ game_id: id, winner: 2, steps: Number(game.session.env.seq) });
  const { m, chain } = minter(h, games, kifus);
  assert.deepEqual(await m.tick(), { minted: [id], none: [], failed: [] });
  // What was sent is the keeper's game: its settled state, and every step packed as the contract reads them.
  const sent = chain.state.minted.get(id);
  assert.equal(sent.anchor.transcript, game.session.env.transcript);
  assert.deepEqual(sent.record, c.kifuRecord(game.session));
  assert.deepEqual({ ...kifus.get(id), at: 0 }, { status: 'minted', reason: null, tx: '0xk1', at: 0 });
  // Minted: never estimated or sent again.
  assert.deepEqual(await m.tick(), { minted: [], none: [], failed: [] });
  assert.deepEqual(chain.state.estimates, [id]);
});

test('a restart mints nothing again: what was minted is in the database', async () => {
  const { h, games } = await played();
  const [id] = games.keys();
  const { kifus, add } = database();
  add({ game_id: id, winner: 2 });
  const chain = kifuChain(games);
  await minter(h, games, kifus, {}, chain).m.tick();
  const again = minter(h, games, kifus, {}, chain);
  assert.deepEqual(await again.m.tick(), { minted: [], none: [], failed: [] });
  assert.equal(chain.state.mints.length, 1);
});

test('a draw, a voided game, an unrated one and another channel\'s are never sent', async () => {
  const { h, games } = await played(4);
  const [draw, voided, unrated, elsewhere] = games.keys();
  const { kifus, add } = database();
  add({ game_id: draw, winner: 0 });
  add({ game_id: voided, winner: 2, voided: 4 });
  add({ game_id: unrated });
  add({ game_id: elsewhere, winner: 2, channel: 0x222n });
  const { m, chain } = minter(h, games, kifus);
  assert.deepEqual(await m.tick(), { minted: [], none: [], failed: [] });
  assert.deepEqual(chain.state.estimates, []);
});

test('a kifu minted elsewhere is recorded as minted, even with no keeper holding its game, and nothing is sent', async () => {
  const { h, games } = await played();
  const [id] = games.keys();
  h.keeper.forget(games.get(id).terms);
  const { kifus, add } = database();
  add({ game_id: id, winner: 2 });
  const { m, chain } = minter(h, games, kifus);
  chain.state.minted.set(id, {});
  assert.deepEqual(await m.tick(), { minted: [id], none: [], failed: [] });
  assert.deepEqual(chain.state.estimates, []);
  assert.equal(chain.state.mints.length, 0);
  assert.deepEqual({ ...kifus.get(id), at: 0 }, { status: 'minted', reason: null, tx: null, at: 0 });
});

test('a kifu minted between the check and the estimate is recorded as minted, and nothing is sent', async () => {
  const { h, games } = await played();
  const [id] = games.keys();
  const { kifus, add } = database();
  add({ game_id: id, winner: 2 });
  const { m, chain } = minter(h, games, kifus);
  chain.kifuMinted = async () => false;
  chain.state.minted.set(id, {});
  assert.deepEqual(await m.tick(), { minted: [id], none: [], failed: [] });
  assert.deepEqual(chain.state.estimates, [id]);
  assert.equal(chain.state.mints.length, 0);
});

test('a record the chain refuses for good is never tried again', async () => {
  const { h, games } = await played();
  const [id] = games.keys();
  const { kifus, add } = database();
  add({ game_id: id, winner: 2 });
  const { m, chain, logs } = minter(h, games, kifus);
  chain.state.refuse = 'Wrong anchor state';
  assert.deepEqual(await m.tick(), { minted: [], none: [id], failed: [] });
  assert.equal(kifus.get(id).reason, 'Wrong anchor state');
  chain.state.refuse = null;
  assert.deepEqual(await m.tick(), { minted: [], none: [], failed: [] });
  assert.equal(chain.state.estimates.length, 1);
  assert.match(logs.join('\n'), /refused by the chain: Wrong anchor state/);
});

test('a record no keeper has is tried each round, then alerted and left an hour; the next game is still minted', async () => {
  const { h, games } = await played(2);
  const [lost, kept] = games.keys();
  h.keeper.forget(games.get(lost).terms);
  const { kifus, add } = database();
  add({ game_id: lost, winner: 2 });
  add({ game_id: kept, winner: 2 });
  const { m, chain, logs, clock } = minter(h, games, kifus);
  assert.deepEqual(await m.tick(), { minted: [kept], none: [], failed: [lost] });
  assert.deepEqual(await m.tick(), { minted: [], none: [], failed: [lost] });
  assert.deepEqual(await m.tick(), { minted: [], none: [], failed: [lost] });
  assert.match(logs.join('\n'), /ALERT: kifu of .* still not minted after 3 attempts \(no keeper has its record.*trying again in 3600 s/);
  // Left alone for retry_seconds…
  clock.ms += 3_599_000;
  assert.deepEqual(await m.tick(), { minted: [], none: [], failed: [] });
  assert.equal(kifus.get(lost), null);
  assert.deepEqual(chain.state.estimates, [kept]);
  // …then tried again, and minted once a keeper has the record.
  clock.ms += 1_000;
  const game = games.get(lost);
  game.keeper.games.set(`/games/${p.hex(CHANNEL)}/${lost}`, game.session);
  assert.deepEqual(await m.tick(), { minted: [lost], none: [], failed: [] });
});

test('a mint over max_fee_fri, or one that fails, is not recorded and is tried again', async () => {
  const { h, games } = await played();
  const [id] = games.keys();
  const { kifus, add } = database();
  add({ game_id: id, winner: 2 });
  const { m, chain } = minter(h, games, kifus, { max_fee_fri: 5n });
  assert.deepEqual(await m.tick(), { minted: [], none: [], failed: [id] });
  assert.equal(chain.state.mints.length, 0);
  m.maxFee = 100n;
  chain.state.failMint = true;
  assert.deepEqual(await m.tick(), { minted: [], none: [], failed: [id] });
  assert.equal(kifus.get(id), null);
  chain.state.failMint = false;
  assert.deepEqual(await m.tick(), { minted: [id], none: [], failed: [] });
});

test('a round mints at most per_round kifus', async () => {
  const { h, games } = await played(3);
  const { kifus, add } = database();
  for (const id of games.keys()) add({ game_id: id, winner: 2 });
  const { m } = minter(h, games, kifus, { per_round: 2 });
  assert.equal((await m.tick()).minted.length, 2);
  assert.equal((await m.tick()).minted.length, 1);
});

test('a mint that hangs holds up neither pairing nor rating: the minter has a loop of its own', async () => {
  let ticks = 0, rounds = 0;
  const matchmaker = { tick: async () => { ticks++; } };
  const hanging = { tick: () => { rounds++; return new Promise(() => {}); } };
  const { close } = await serve(matchmaker, { minter: hanging, poll_ms: 5 });
  await new Promise(r => setTimeout(r, 60));
  await close();
  assert.ok(ticks >= 3, `the matchmaker ticked ${ticks} times`);
  assert.equal(rounds, 1);
});
