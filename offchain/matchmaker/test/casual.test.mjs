// Casual games: unrated pairings in a lobby of their own (quick match, open
// and private tables, the AI), on terms with no ticket that name the casual
// channel value, registered with a keeper's unanchored entry and followed
// until over, never rated. Rated or casual, a player is in one at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import { CHAIN, address, harness, reviveTerms, walletSign } from './fake.mjs';

const CASUAL = { rated: false, size: 9, clock: c.UNTIMED, band: 2 };

/** `name`'s wallet signature over its casual pairing's terms, after rebuilding them as a client does. */
function casualSignature(h, name) {
  const status = h.matchmaker.status(address(name)), terms = reviveTerms(status.terms);
  assert.equal(status.rated, false);
  assert.equal(status.ticket, undefined);
  const settings = status.clock === c.UNTIMED ? null : h.matchmaker.config.clocks[status.clock];
  const rebuilt = c.casualTerms({ chain_id: CHAIN, players: [status.black, status.white], keys: terms.keys, size: status.size,
    komi_half: h.matchmaker.config.boards[status.size], settings, referee: h.keeper.referee, response_seconds: 3600 });
  assert.equal(p.contextHash(p.go, terms), p.contextHash(p.go, rebuilt));
  return walletSign(name, c.goTermsTypedData(terms));
}
const signCasual = (h, name) =>
  h.matchmaker.sign(h.matchmaker.status(address(name)).digest, { player: address(name), signature: casualSignature(h, name) });

test('a casual quick match: no ticket, the casual channel, registered with no extras, never rated', async () => {
  const h = await harness();
  assert.deepEqual((await h.matchmaker.info()).casual, { channel: '0x0', clocks: ['untimed', 'turn'] });
  assert.deepEqual(await h.queue('a', CASUAL), { status: 'waiting', rated: false, since: h.clock.ms });
  assert.deepEqual(h.matchmaker.census(), { waiting: 1, tables: 0, playing: 0 });
  const paired = await h.queue('b', CASUAL);
  assert.equal(paired.status, 'paired');
  const terms = reviveTerms(paired.terms);
  assert.equal(terms.channel, c.CASUAL_CHANNEL);
  assert.equal(terms.clock, null);
  assert.equal(terms.config.ticket, 0n);
  assert.equal(BigInt(paired.digest), p.contextHash(p.go, terms));
  await signCasual(h, 'a');
  const ready = await signCasual(h, 'b');
  assert.equal(ready.ready, true);
  const [registered] = h.keeper.registrations;
  assert.equal(registered.extras, undefined);
  assert.equal(registered.authorizations.length, 2);
  // The game ends at its keeper: its players are free, and nothing is rated.
  const session = h.keeper.games.get(`/games/0x0/${p.hex(terms.game_id)}`);
  session.move(p.resignStep(0), h.sessionKeys.get(p.hex(terms.keys[0])));
  await h.matchmaker.tick();
  assert.deepEqual(h.matchmaker.status(address('a')), { status: 'none' });
  assert.equal(h.matchmaker.games.size, 0);
  assert.deepEqual(h.chain.state.rateCalls, []);
});

test('a timed casual game is refereed by its keeper; rated games have no untimed clock', async () => {
  const h = await harness();
  await h.queue('a', { ...CASUAL, clock: 'turn' });
  const terms = reviveTerms((await h.queue('b', { ...CASUAL, clock: 'turn' })).terms);
  assert.equal(terms.clock.referee, h.keeper.referee);
  await assert.rejects(h.queue('c', { size: 9, clock: c.UNTIMED, band: 2 }), /Unknown clock/);
  // Casual and rated players wait apart, and so do untimed and timed ones.
  await h.queue('d', CASUAL);
  await h.queue('e', { size: 9, clock: 'turn', band: 2 });
  await h.queue('f', { ...CASUAL, clock: 'turn' });
  assert.deepEqual(['d', 'e', 'f'].map(n => h.matchmaker.status(address(n)).status), ['waiting', 'waiting', 'waiting']);
});

test('casual tables: anyone may host and join; a private one is joined by its id alone', async () => {
  const h = await harness({ extra: { min_table_games: 5 } });
  const { table } = await h.matchmaker.host(h.request('a', 'table', CASUAL));
  assert.deepEqual(h.matchmaker.tables().map(t => [t.id, t.rated]), [[table, false]]);
  const { table: invite } = await h.matchmaker.host(h.request('b', 'table', { ...CASUAL, private: true }));
  assert.deepEqual(h.matchmaker.tables().map(t => t.id), [table]);
  await assert.rejects(h.matchmaker.host(h.request('c', 'table', { size: 9, clock: 'turn', band: 2, private: true })),
    /Private tables are for casual games/);
  const joined = await h.matchmaker.join(invite, h.request('c', 'join', { table: invite, band: 2 }));
  assert.equal(joined.rated, false);
  assert.deepEqual([joined.black, joined.white], [address('b'), address('c')]);
  await h.matchmaker.close(table, h.request('a', 'close', { table }));
  assert.deepEqual(h.matchmaker.tables(), []);
});

test('rated or casual, one at a time', async () => {
  const h = await harness();
  await h.queue('a', CASUAL);
  await assert.rejects(h.queue('a'), /Leave the queue first/);
  await h.queue('b', CASUAL);
  await assert.rejects(h.queue('a'), /Finish your game first/);
  await assert.rejects(h.matchmaker.host(h.request('b', 'table', { size: 9, clock: 'turn', band: 2 })), /Finish your game first/);
  // And the other way round.
  await h.queue('c');
  await assert.rejects(h.queue('c', CASUAL), /Leave the queue first/);
});

test('a casual game against an AI anchor: an offer with no ticket, the anchor signing it too', async () => {
  const anchor = address('anchor');
  const h = await harness({ extra: { anchors: [anchor], sign_seconds: 60 } });
  h.chain.state.anchors.set(anchor, 0n);
  const key = h.newKey();
  await h.matchmaker.offerKey(anchor, h.request('anchor', 'anchor_key', { key }));
  const offer = await h.matchmaker.play({ player: address('a'), key: h.newKey(), anchor, ...CASUAL });
  assert.deepEqual([offer.status, offer.rated, offer.ticket], ['offer', false, undefined]);
  const terms = reviveTerms(offer.terms);
  const signed = await h.matchmaker.sign(offer.digest, { player: address('a'), signature: walletSign('a', c.goTermsTypedData(terms)) });
  assert.deepEqual(signed.signed, { black: offer.color === 'black', white: offer.color === 'white' });
  // The anchor sees it among its games, and signs.
  const [game] = h.matchmaker.anchorGames(anchor).games;
  assert.equal(game.rated, false);
  const done = await h.matchmaker.sign(game.digest, { player: anchor, signature: walletSign('anchor', c.goTermsTypedData(terms)) });
  assert.equal(done.ready, true);
});

test('a restart restores casual pairings and the casual lobby', async () => {
  const h = await harness();
  await h.queue('a', CASUAL);
  const digest = (await h.queue('b', CASUAL)).digest;
  await signCasual(h, 'a');
  const fresh = await h.open();
  const status = fresh.status(address('a'));
  assert.deepEqual([status.digest, status.rated, status.signed], [digest, false, { black: true, white: false }]);
  assert.deepEqual(reviveTerms(status.terms), reviveTerms(h.matchmaker.status(address('a')).terms));
});

test('a casual game against an AI anchor seats the player at the color they ask for; a rated one refuses a color', async () => {
  const anchor = address('anchor');
  const h = await harness({ extra: { anchors: [anchor], sign_seconds: 60 } });
  h.chain.state.anchors.set(anchor, 0n);
  await h.matchmaker.offerKey(anchor, h.request('anchor', 'anchor_key', { key: h.newKey() }));
  const ask = color => h.matchmaker.play({ player: address('a'), key: h.newKey(), anchor, ...CASUAL, color });
  // By rank, one of the two colors is the player's; asking seats them at either.
  for (const color of ['black', 'white']) {
    const offer = await ask(color);
    assert.equal(offer.color, color);
    assert.equal(offer[color], address('a'));
    assert.equal(offer[color === 'black' ? 'white' : 'black'], anchor);
  }
  await assert.rejects(ask('green'), /Invalid color/);
  await assert.rejects(h.matchmaker.play({ player: address('a'), key: h.newKey(), anchor, ...CASUAL, rated: true, clock: 'turn', color: 'white' }),
    /A rated game gives the weaker player black/);
});

test('a casual handicap game against an AI anchor has no komi; a rated one refuses a handicap', async () => {
  const anchor = address('anchor');
  const h = await harness({ extra: { anchors: [anchor], sign_seconds: 60 } });
  h.chain.state.anchors.set(anchor, 0n);
  await h.matchmaker.offerKey(anchor, h.request('anchor', 'anchor_key', { key: h.newKey() }));
  const ask = extra => h.matchmaker.play({ player: address('a'), key: h.newKey(), anchor, ...CASUAL, ...extra });
  const plain = await ask({});
  assert.equal(plain.handicap, undefined);
  assert.equal(reviveTerms(plain.terms).config.komi_half, h.matchmaker.config.boards[9]);
  const offer = await ask({ handicap: true });
  assert.equal(offer.handicap, true);
  assert.equal(reviveTerms(offer.terms).config.komi_half, 0);
  await assert.rejects(ask({ handicap: 'yes' }), /Invalid handicap/);
  await assert.rejects(ask({ rated: true, clock: 'turn', handicap: true }), /A rated game has no handicap/);
});
