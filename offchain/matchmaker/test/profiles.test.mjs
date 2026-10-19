// The matchmaker and players' profiles: no game without a profile, the
// profile's starting level when a request names none, and an undeployed
// account told to activate rather than that its signature is bad.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import { profileTypedData } from '../../sdk/src/profile.mjs';
import { openDatabase } from '../../db/db.mjs';
import { History } from '../../db/history.mjs';
import { Profiles } from '../../db/profiles.mjs';
import { serve } from '../server.mjs';
import { CHAIN, CHANNEL, address, harness, reviveTerms, walletSign } from './fake.mjs';

/** A harness whose matchmaker admits only players with a profile and keeps casual games, and a way to make a profile. */
async function withProfiles() {
  const clock = { ms: 1_700_000_000 * 1000 };
  const db = openDatabase(':memory:'), history = new History(db);
  let profiles;
  const h = await harness({ clock, admit: player => profiles.admit(player), record: game => history.recordCasual(game),
    extra: { delegation_seconds: c.DELEGATION_SECONDS } });
  profiles = new Profiles(db, { chain: h.chain, chain_id: CHAIN, now: () => clock.ms });
  const profile = (name, handle, band = 2) => {
    const player = address(name), at = h.at();
    return profiles.claim({ player, handle, band, at,
      signature: walletSign(name, profileTypedData({ chainId: CHAIN, player, handle, band, at })) });
  };
  return { h, profiles, profile, history };
}

const refused = (status, pattern) => e => e.status === status && pattern.test(e.message);
const NO_PROFILE = /Make your profile first/, UNDEPLOYED = /Activate your account first/;

test('no game without a profile: the queue, tables and AI games', async () => {
  const { h, profile } = await withProfiles();
  await assert.rejects(h.queue('a'), refused(403, NO_PROFILE));
  await assert.rejects(h.matchmaker.host(h.request('a', 'table', { size: 19, clock: 'turn', band: 2 })), refused(403, NO_PROFILE));
  await assert.rejects(h.matchmaker.play({ player: address('a'), key: h.newKey(), size: 19, clock: 'turn', anchor: address('ai') }),
    refused(403, NO_PROFILE));
  await profile('a', 'stone');
  assert.equal((await h.queue('a')).status, 'waiting');
});

test('a request naming no band starts from the profile\'s level', async () => {
  const { h, profile } = await withProfiles();
  await profile('a', 'stone', 3);
  await h.queue('a', { band: undefined });
  assert.equal(h.matchmaker.lobby.queue.get(address('a')).band, 3);
  // One that names a band keeps it.
  await h.matchmaker.leave(h.request('a', 'leave'));
  await h.queue('a', { band: 1 });
  assert.equal(h.matchmaker.lobby.queue.get(address('a')).band, 1);
});

test('an undeployed account is told to activate, not that its signature is bad', async () => {
  const { h } = await withProfiles();
  h.chain.state.undeployed.add(address('fresh'));
  await assert.rejects(h.queue('fresh'), refused(403, UNDEPLOYED));
  const key = p.hex(p.publicKey(0x77n)), expires_at = h.at() + 3600;
  await assert.rejects(h.matchmaker.delegate({ player: address('fresh'), key, expires_at,
    signature: walletSign('fresh', p.delegationTypedData(p.go, { chain_id: CHAIN, channel: CHANNEL, key, expires_at })) }),
  refused(403, UNDEPLOYED));
  // A deployed account with a bad signature is still told so.
  const asked = h.request('b', 'queue', { size: 19, clock: 'turn', band: 2 });
  const forged = { ...asked, signature: walletSign('c', c.matchmakerRequest({ chainId: CHAIN, action: 'queue', ...asked })) };
  await assert.rejects(h.matchmaker.enqueue(forged), refused(401, /Bad signature/));
});

test('a finished casual game is kept, and served on its players\' profiles', async () => {
  const { h, profiles, profile, history } = await withProfiles();
  await profile('a', 'stone');
  await profile('b', 'pebble');
  const casual = { rated: false, size: 9, clock: c.UNTIMED };
  await h.queue('a', casual);
  const paired = await h.queue('b', casual);
  const terms = reviveTerms(paired.terms);
  for (const name of ['a', 'b'])
    await h.matchmaker.sign(paired.digest, { player: address(name), signature: walletSign(name, c.goTermsTypedData(terms)) });
  const session = h.keeper.games.get(`/games/0x0/${p.hex(terms.game_id)}`);
  session.move(p.resignStep(1), h.sessionKeys.get(p.hex(terms.keys[1])));
  await h.matchmaker.tick();
  const [kept] = history.games(address('a'));
  assert.deepEqual([kept.kind, kept.id, kept.winner, kept.clock], ['casual', paired.digest, 1, 'untimed']);
  const server = await serve(h.matchmaker, { profiles, history, poll_ms: 0 });
  const get = async path => { const r = await fetch(`${server.url}${path}`); return { status: r.status, body: await r.json() }; };
  try {
    const page = await get('/profiles/Stone');
    assert.deepEqual(page.body.profile, { player: address('a'), handle: 'stone', band: 2 });
    assert.equal(page.body.account.deployed, true);
    assert.deepEqual((await get(`/profiles/${address('b')}/games`)).body.games.map(g => g.id), [paired.digest]);
    assert.deepEqual((await get('/profiles/stone/ranks')).body, { ranks: [] });
    assert.equal((await get('/profiles/nobody')).status, 404);
  } finally {
    await server.close();
  }
});
