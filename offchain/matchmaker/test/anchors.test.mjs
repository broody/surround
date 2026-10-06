// AI anchors: fixed-strength opponents pinned in SurroundRatings. An anchor's
// daemon offers session keys ahead of time; a player who asks for the anchor
// is paired at once, the anchor without a band, and only the player is held
// to the lobby's rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import * as rating from '../../sdk/src/rating.mjs';
import { address, harness, reviveTerms, walletSign } from './fake.mjs';

/** μ at 5k (OGS rank 25) and 20k (rank 10). */
const MU_5K = rating.MU_T[25], MU_20K = rating.MU_T[10];
const AI = 'yuna';

/** A harness whose matchmaker offers `AI`, pinned at `mu`, with `keys` session keys offered. */
async function withAnchor({ mu = MU_5K, keys = 2, extra = {} } = {}) {
  const h = await harness({ extra: { anchors: [address(AI)], ...extra } });
  if (mu !== null) h.chain.state.anchors.set(address(AI), mu);
  h.offer = (name = AI, fields = {}) => h.matchmaker.offerKey(address(AI), h.request(name, 'anchor_key', fields));
  for (let i = 0; i < keys; i++) await h.offer();
  h.ask = (name, fields = {}) => h.matchmaker.play(h.request(name, 'ai', { size: 19, clock: 'turn', band: 2, anchor: address(AI), ...fields }));
  /** The anchor signs a pairing's terms, after checking them as its daemon does. */
  h.anchorSigns = async digest => {
    const game = h.matchmaker.anchorGames(address(AI)).games.find(g => g.digest === digest);
    const terms = reviveTerms(game.terms), ticket = c.reviveTicket(game.ticket);
    assert.equal(p.contextHash(p.go, terms), p.contextHash(p.go, c.ratedTerms(ticket, terms.keys)));
    assert.equal(p.hex(terms.keys[game.color === 'black' ? 0 : 1]), game.key);
    return h.matchmaker.sign(digest, { player: address(AI), signature: walletSign(AI, c.goTermsTypedData(terms)) });
  };
  return h;
}

test('a player who asks for an anchor is paired at once, on a key it offered, the anchor without a band', async () => {
  const h = await withAnchor();
  assert.deepEqual(await h.matchmaker.anchorList(), [{ player: address(AI), rank_tenths: 250, keys: 2 }]);
  const offered = h.matchmaker.anchorKeys.get(address(AI))[0];
  const status = await h.ask('a');
  assert.equal(status.status, 'paired');
  assert.equal(status.anchor, address(AI));
  // A 17k newcomer is weaker than the 5k anchor: the player takes black.
  assert.equal(status.color, 'black');
  const ticket = c.reviveTicket(status.ticket);
  assert.deepEqual([p.hex(ticket.black), p.hex(ticket.white), ticket.black_band, ticket.white_band, ticket.source],
    [address('a'), address(AI), 2, 0, c.QUEUE]);
  assert.equal(p.hex(reviveTerms(status.terms).keys[1]), offered);
  // The anchor sees its game, with the key it plays it with; one key is left.
  const view = h.matchmaker.anchorGames(address(AI));
  assert.equal(view.keys, 1);
  assert.deepEqual(view.games.map(g => [g.digest, g.color, g.key]), [[status.digest, 'white', offered]]);
  // Both sign: the game goes to its keeper.
  await h.sign('a');
  const signed = await h.anchorSigns(status.digest);
  assert.equal(signed.ready, true);
  assert.equal(h.keeper.registrations.length, 1);
  // The anchor never shows as anyone's single pairing.
  assert.equal(h.matchmaker.status(address(AI)).status, 'none');
});

test('a player stronger than the anchor plays white', async () => {
  const h = await withAnchor({ mu: MU_20K });
  h.chain.state.ranks.set(address('a'), { rank_tenths: 150, provisional: false, rated: true });
  const status = await h.ask('a', { band: undefined });
  assert.equal(status.color, 'white');
  const ticket = c.reviveTicket(status.ticket);
  assert.deepEqual([p.hex(ticket.black), ticket.black_band, ticket.white_band], [address(AI), 0, 1]);
});

test('an anchor plays many players at once, and the same player as often as they like', async () => {
  const h = await withAnchor({ keys: 4 });
  const games = [await h.ask('a'), await h.ask('b')];
  assert.equal(h.matchmaker.anchorGames(address(AI)).games.length, 2);
  // a plays it again and again, past the repeat limit, one game at a time.
  for (let i = 0; i < 2; i++) {
    await assert.rejects(h.ask('a'), /Finish your rated game first/);
    const game = h.game(BigInt(games[0].digest));
    await h.sign('a');
    await h.anchorSigns(games[0].digest);
    h.resign(game, 0);
    await h.matchmaker.tick();
    games[0] = await h.ask('a');
    assert.equal(games[0].status, 'paired');
  }
});

test('an anchor is offered only if configured and pinned onchain, and only while it has keys', async () => {
  const h = await withAnchor({ keys: 1 });
  await assert.rejects(h.ask('a', { anchor: address('stranger') }), e => e.status === 404);
  await h.ask('a');
  await assert.rejects(h.ask('b'), e => e.status === 503 && /busy/.test(e.message));
  await h.offer();
  assert.equal((await h.ask('b')).status, 'paired');
  // Not pinned: no games, and no keys taken.
  const unpinned = await withAnchor({ mu: null, keys: 0 });
  await assert.rejects(unpinned.offer(), e => e.status === 503);
  await assert.rejects(unpinned.ask('a'), e => e.status === 503 && /not rated/.test(e.message));
});

test('the player signs which anchor they asked for; only the anchor offers its keys, a bounded few', async () => {
  const h = await withAnchor({ keys: 0, extra: { max_anchor_keys: 2 } });
  await h.offer();
  const request = h.request('a', 'ai', { size: 19, clock: 'turn', band: 2, anchor: address(AI) });
  await assert.rejects(h.matchmaker.play({ ...request, anchor: address('other') }), e => e.status === 401);
  // Someone else offering the anchor's keys.
  await assert.rejects(h.matchmaker.offerKey(address(AI), h.request('b', 'anchor_key')), e => e.status === 401);
  await h.offer();
  await assert.rejects(h.offer(), e => e.status === 409 && /Enough keys/.test(e.message));
  // A key someone waiting uses can't be offered, and an offered one can't be queued with.
  const queued = await h.queue('c');
  assert.equal(queued.status, 'waiting');
  const key = h.matchmaker.anchorKeys.get(address(AI))[0];
  await assert.rejects(h.queue('d', { key }), e => e.status === 409 && /Session key in use/.test(e.message));
});

test('an anchor never queues, hosts or joins a table', async () => {
  const h = await withAnchor();
  await assert.rejects(h.queue(AI), e => e.status === 403);
  await assert.rejects(h.matchmaker.host(h.request(AI, 'table', { size: 19, clock: 'turn' })), e => e.status === 403);
});

test('a player who is queued, hosting or busy is refused an anchor game', async () => {
  const h = await withAnchor();
  await h.queue('a');
  await assert.rejects(h.ask('a'), /Leave the queue first/);
  await h.ask('b');
  await assert.rejects(h.ask('b'), /Finish your rated game first/);
});
