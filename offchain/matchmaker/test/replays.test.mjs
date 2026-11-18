// Replays (GET /games/:id/record): a finished game's moves, a casual game's
// from the database and a rated one's from its keeper; bare steps, and a 404
// where there's no record from the first move.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import { openDatabase } from '../../db/db.mjs';
import { History } from '../../db/history.mjs';
import { serve } from '../server.mjs';
import { CHANNEL, address, harness, reviveTerms, walletSign } from './fake.mjs';

async function served(h, history) {
  const server = await serve(h.matchmaker, { history, poll_ms: 0 });
  const get = async path => { const r = await fetch(`${server.url}${path}`); return { status: r.status, body: await r.json() }; };
  return { server, get };
}

test("a casual game's replay: its moves from the database, without signatures", async () => {
  const history = new History(openDatabase(':memory:'));
  const h = await harness({ record: game => history.recordCasual(game) });
  const casual = { rated: false, size: 9, clock: c.UNTIMED };
  await h.queue('a', casual);
  const paired = await h.queue('b', casual);
  const terms = reviveTerms(paired.terms);
  for (const name of ['a', 'b'])
    await h.matchmaker.sign(paired.digest, { player: address(name), signature: walletSign(name, c.goTermsTypedData(terms)) });
  const session = h.keeper.games.get(`/games/0x0/${p.hex(terms.game_id)}`);
  const key = seat => h.sessionKeys.get(p.hex(terms.keys[seat]));
  session.move(p.goStep(p.PLAY, 40), key(0));
  session.move(p.goStep(p.PASS), key(1));
  session.move(p.goStep(p.PLAY, 30), key(0));
  session.move(p.resignStep(1), key(1));
  await h.matchmaker.tick();
  const { server, get } = await served(h, history);
  try {
    const { status, body } = await get(`/games/${paired.digest}/record`);
    assert.equal(status, 200);
    assert.deepEqual({ ...body, at: 0 }, {
      kind: 'casual', id: paired.digest, black: address('a'), white: address('b'), size: 9, komi_half: terms.config.komi_half,
      winner: 1, reason: p.REASON_RESIGN, voided: null, at: 0,
      steps: [
        { kind: p.MOVE_PLAY, action: { kind: p.PLAY, point: 40 } },
        { kind: p.MOVE_PLAY, action: { kind: p.PASS } },
        { kind: p.MOVE_PLAY, action: { kind: p.PLAY, point: 30 } },
        { kind: p.MOVE_RESIGN, seat: 1 },
      ],
    });
    assert.equal((await get('/games/0x1234/record')).status, 404);
    assert.equal((await get('/games/not-a-felt/record')).status, 404);
  } finally {
    await server.close();
  }
});

/** A rated game on the harness's keeper: black plays twice, white resigns; the indexer has it played. */
async function ratedGame() {
  const db = openDatabase(':memory:'), history = new History(db);
  const h = await harness();
  const game = await h.play('a', 'b');
  const key = seat => h.sessionKeys.get(p.hex(game.terms.keys[seat]));
  game.keeper.play(game.terms, 60, key(0), h.clock.ms);
  game.keeper.resign(game.terms, 1, key(1), h.clock.ms + 1000);
  db.prepare(`INSERT INTO rated_games (digest, channel, game_id, black, white, size, clock, winner, steps, played_at, voided, block)
    VALUES (?, ?, ?, ?, ?, 19, 'turn', 1, 2, 1700000100, NULL, 1)`)
    .run(p.hex(game.digest), p.hex(CHANNEL), p.hex(game.game_id), address('a'), address('b'));
  return { h, history, game };
}

test("a rated game's replay comes from its keeper, and is kept once found", async () => {
  const { h, history, game } = await ratedGame();
  const { server, get } = await served(h, history);
  try {
    const { status, body } = await get(`/games/${p.hex(game.digest)}/record`);
    assert.equal(status, 200);
    assert.deepEqual([body.kind, body.size, body.winner, body.at], ['rated', 19, 1, 1700000100]);
    assert.deepEqual(body.steps, [{ kind: p.MOVE_PLAY, action: { kind: p.PLAY, point: 60 } }, { kind: p.MOVE_RESIGN, seat: 1 }]);
    // A finished game's moves don't change: the keeper isn't asked again. Its row may: that is read each time.
    game.keeper.forget(game.terms);
    history.db.prepare('UPDATE rated_games SET voided = 4, black = NULL WHERE digest = ?').run(p.hex(game.digest));
    const again = (await get(`/games/${p.hex(game.digest)}/record`)).body;
    assert.deepEqual(again.steps, body.steps);
    // A seat the indexer missed is the record's.
    assert.deepEqual([again.voided, again.black], [4, address('a')]);
  } finally {
    await server.close();
  }
});

test('a rated game no keeper has from its first move has no replay', async () => {
  const { h, history, game } = await ratedGame();
  const handle = game.keeper.handle;
  game.keeper.handle = async (path, init) => {
    const res = await handle(path, init);
    if (!path.startsWith('/games/')) return res;
    const view = JSON.parse(await res.text());
    return { ...res, text: async () => JSON.stringify({ ...view, start: 1 }) };
  };
  const { server, get } = await served(h, history);
  try {
    const late = await get(`/games/${p.hex(game.digest)}/record`);
    assert.deepEqual([late.status, late.body.error], [404, 'No keeper has this game\'s record']);
    game.keeper.handle = handle;
    game.keeper.forget(game.terms);
    assert.equal((await get(`/games/${p.hex(game.digest)}/record`)).status, 404);
    // A keeper that's down might hold it: not "no record", but try again.
    game.keeper.up = false;
    assert.equal((await get(`/games/${p.hex(game.digest)}/record`)).status, 503);
  } finally {
    await server.close();
  }
});
