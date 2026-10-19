// Players' profiles: a handle and a starting level claimed with a wallet
// signature, one handle per player and per name (case and separators aside),
// renamed at most weekly, held a while for its old owner, moderated, required
// for a game, and served beside the matchmaker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleError, handleKey, profileTypedData } from '../../sdk/src/profile.mjs';
import { serve } from '../../matchmaker/server.mjs';
import { CHAIN, T0, address, fakeChain, harness, walletSign } from '../../matchmaker/test/fake.mjs';
import { CHARACTERS } from '../../../shared/lobby.ts';
import { run } from '../admin.mjs';
import { openDatabase } from '../db.mjs';
import { DEFAULTS, Profiles } from '../profiles.mjs';

const DAY = 24 * 3600;

function setup({ chain = fakeChain(), file = ':memory:', ...options } = {}) {
  const clock = { s: T0 };
  const handles = new Profiles(openDatabase(file), { chain, chain_id: CHAIN, now: () => clock.s * 1000, ...options });
  /**
   * `name`'s claim of `handle` and `band` (17k by default), signed by `signer`
   * (`name` by default) at `at` (now by default).
   */
  const claim = (name, handle, { band = 2, at = clock.s, signer = name } = {}) => {
    const player = address(name);
    return { player, handle, band, at,
      signature: walletSign(signer, profileTypedData({ chainId: CHAIN, player, handle, band, at })) };
  };
  return { chain, clock, handles, claim, advance: seconds => { clock.s += seconds; } };
}

const refused = (status, pattern) => e => e.status === status && pattern.test(e.message);

test('a wallet claims a handle with its signature; the claim stays checkable', async () => {
  const { chain, handles, claim } = setup();
  const body = claim('a', 'Broody');
  const kept = await handles.claim(body);
  assert.deepEqual(kept, { player: address('a'), handle: 'Broody', band: 2, at: T0, signature: body.signature, version: '1' });
  assert.deepEqual(handles.get(address('a')), kept);
  // Any form of the address finds it.
  assert.equal(handles.get(`0x00${address('a').slice(2)}`).handle, 'Broody');
  assert.equal(handles.get(address('b')), null);
  // The export holds what anyone needs to check each claim against its account.
  const [exported] = handles.all();
  assert.ok(await chain.verify(exported.player, profileTypedData({ chainId: CHAIN, ...exported }), exported.signature));
});

test('handles are 3–20 letters, digits, _ or -, starting with a letter', async () => {
  for (const ok of ['abc', 'Go_Player-9', 'a'.repeat(20), 'a-b-c']) assert.equal(handleError(ok), null, ok);
  for (const bad of ['ab', 'a'.repeat(21), '9lives', '_abc', 'has space', 'émile', 'a__', 'abc!', '', 42, null])
    assert.notEqual(handleError(bad), null, String(bad));
  const { handles, claim } = setup();
  await assert.rejects(handles.claim(claim('a', 'has space')), refused(400, /letters, digits/));
});

test('a handle is one name whatever its case or separators', async () => {
  assert.equal(handleKey('Bro_O-dy'), 'broody');
  const { handles, claim } = setup();
  await handles.claim(claim('a', 'broody'));
  for (const same of ['Broody', 'BRO_ODY', 'bro-ody'])
    await assert.rejects(handles.claim(claim('b', same)), refused(409, /taken/), same);
});

test('the AI regulars and the service own their names', async () => {
  const { handles, claim } = setup({ reserved: ['dealer'] });
  const names = CHARACTERS.flatMap(ch => [ch.id, ch.name.split(' ')[0], ch.name.replace(/ /g, '_'), ch.name.replace(/ /g, '-')]);
  for (const name of [...names, 'Surround', 'Matchmaker', 'dealer'])
    await assert.rejects(handles.claim(claim('a', name)), refused(409, /reserved/), name);
});

test('only the wallet itself, deployed, signing just now, claims', async () => {
  const { chain, handles, claim, advance } = setup();
  await assert.rejects(handles.claim(claim('a', 'mallory', { signer: 'b' })), refused(401, /Bad signature/));
  await assert.rejects(handles.claim({ ...claim('a', 'mallory'), handle: 'mallory2' }), refused(401, /Bad signature/));
  await assert.rejects(handles.claim(claim('a', 'mallory', { at: T0 - 121 })), refused(401, /Stale/));
  await assert.rejects(handles.claim({ ...claim('a', 'mallory'), signature: [] }), refused(400, /Invalid signature/));
  // However long, as a passkey's runs: the account decides.
  await assert.rejects(handles.claim({ ...claim('a', 'mallory'), signature: Array(200).fill('0x1') }), refused(401, /Bad signature/));
  chain.state.undeployed.add(address('a'));
  await assert.rejects(handles.claim(claim('a', 'mallory')), refused(403, /Activate/));
  chain.state.undeployed.delete(address('a'));
  // A claim seen once (it's published) can't be sent again, nor an older one.
  const first = claim('a', 'mallory');
  await handles.claim(first);
  await assert.rejects(handles.claim(first), refused(401, /Stale/));
  advance(DEFAULTS.rename_seconds);
  const older = claim('a', 'malory', { at: T0 + DEFAULTS.rename_seconds - 60 });
  await handles.claim(claim('a', 'marlowe'));
  await assert.rejects(handles.claim(older), refused(401, /Stale/));
  assert.equal(handles.get(address('a')).handle, 'marlowe');
});

test('a player renames once a week, and may change case or separators any time', async () => {
  const { handles, claim, advance } = setup();
  await handles.claim(claim('a', 'stone'));
  advance(60);
  assert.equal((await handles.claim(claim('a', 'Stone'))).handle, 'Stone');
  advance(DAY);
  await assert.rejects(handles.claim(claim('a', 'pebble')), refused(429, /choose another handle from 2023-11-21/));
  // A change of case doesn't restart the week.
  advance(DEFAULTS.rename_seconds - DAY - 60);
  assert.equal((await handles.claim(claim('a', 'pebble'))).handle, 'pebble');
});

test('a handle let go of is held for its old owner, then free', async () => {
  const { handles, claim, advance } = setup();
  await handles.claim(claim('a', 'stone'));
  advance(DEFAULTS.rename_seconds);
  await handles.claim(claim('a', 'pebble'));
  await assert.rejects(handles.claim(claim('b', 'stone')), refused(409, /taken/));
  // Its old owner may take it back, a week on.
  advance(DEFAULTS.rename_seconds);
  await handles.claim(claim('a', 'stone'));
  advance(DEFAULTS.rename_seconds);
  await handles.claim(claim('a', 'rock'));
  advance(DEFAULTS.hold_seconds);
  assert.equal((await handles.claim(claim('b', 'stone'))).handle, 'stone');
});

test('two players claiming one handle at once: one gets it', async () => {
  const { handles, claim } = setup();
  const results = await Promise.allSettled([handles.claim(claim('a', 'tengen')), handles.claim(claim('b', 'tengen'))]);
  assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert.equal(handles.all().length, 1);
});

test('moderators take a handle away and reserve it, from the command line too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'handles-'));
  try {
    const file = join(dir, 'surround.sqlite');
    const { handles, claim } = setup({ file });
    await handles.claim(claim('a', 'rude'));
    assert.equal(JSON.parse(run(file, ['show', address('a')])).handle, 'rude');
    assert.match(run(file, ['clear', address('a'), 'abuse']), /cleared rude/);
    assert.equal(handles.get(address('a')), null);
    // Held for no one, its owner included: reserved.
    await assert.rejects(handles.claim(claim('a', 'Rude')), refused(409, /reserved/));
    await assert.rejects(handles.claim(claim('b', 'rude')), refused(409, /reserved/));
    // Without a handle, its old owner picks another at once.
    assert.equal((await handles.claim(claim('a', 'polite'))).handle, 'polite');
    run(file, ['unreserve', 'rude']);
    assert.equal((await handles.claim(claim('b', 'rude'))).handle, 'rude');
    run(file, ['reserve', 'kami', 'taken by us']);
    await assert.rejects(handles.claim(claim('c', 'Kami')), refused(409, /reserved/));
    // A backup is a database of its own.
    const copy = join(dir, 'backup.sqlite');
    run(file, ['backup', copy]);
    assert.deepEqual(new Profiles(openDatabase(copy), { chain: null, chain_id: CHAIN }).all(), handles.all());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a profile starts from a level the contract allows; a rated player may leave it out', async () => {
  const { chain, handles, claim, advance } = setup();
  // Allowed: 23k, 17k, 6k (the fake contract's 0b1110), not 1k, and none only once rated.
  for (const band of [0, 4]) await assert.rejects(handles.claim(claim('a', 'stone', { band })), refused(400, /23k, 17k, 6k/));
  await assert.rejects(handles.claim(claim('a', 'stone', { band: 5 })), refused(400, /Invalid starting level/));
  assert.equal((await handles.claim(claim('a', 'stone', { band: 3 }))).band, 3);
  // The level changes any time, without counting as a rename.
  advance(60);
  assert.equal((await handles.claim(claim('a', 'stone', { band: 1 }))).band, 1);
  advance(DAY);
  await assert.rejects(handles.claim(claim('a', 'pebble', { band: 1 })), refused(429, /choose another handle/));
  // A rated player's level is the contract's.
  chain.state.players.set(address('b'), { ...(await chain.player(address('b'))), phi: 1n });
  assert.equal((await handles.claim(claim('b', 'rated', { band: 0 }))).band, 0);
});

test('a game needs a profile', async () => {
  const { handles, claim } = setup();
  assert.throws(() => handles.admit(address('a')), refused(403, /Make your profile first/));
  await handles.claim(claim('a', 'stone', { band: 3 }));
  assert.equal(handles.admit(address('a')).band, 3);
});

test('the matchmaker serves profiles: claims, lookups, the export, and on each player', async () => {
  const h = await harness();
  const { handles, claim } = setup({ chain: h.chain });
  const server = await serve(h.matchmaker, { profiles: handles, poll_ms: 0 });
  const call = async (path, body) => {
    const response = await fetch(`${server.url}${path}`, body && { method: 'POST', body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await call(`/players/${address('a')}`)).body.profile, null);
    const posted = await call('/profiles', claim('a', 'Broody'));
    assert.equal(posted.status, 200);
    assert.equal(posted.body.handle, 'Broody');
    assert.deepEqual((await call(`/players/${address('a')}`)).body.profile, { handle: 'Broody', band: 2 });
    assert.deepEqual(await call('/profiles', claim('b', 'broody')), { status: 409, body: { error: 'That handle is taken' } });
    // Checked before the wallet signs: free, taken, reserved, malformed.
    const check = (name, handle) => call(`/handles/check?player=${address(name)}&handle=${encodeURIComponent(handle)}`);
    assert.deepEqual(await check('b', 'tengen'), { status: 200, body: { ok: true } });
    assert.deepEqual(await check('a', 'BROODY'), { status: 200, body: { ok: true } });
    assert.equal((await check('b', 'Bro-ody')).status, 409);
    assert.equal((await check('b', 'Malik')).body.error, 'That handle is reserved');
    assert.equal((await check('b', 'no')).status, 400);
    assert.equal((await call(`/handles/check?handle=tengen`)).status, 400);
    await call('/profiles', claim('b', 'tengen'));
    const all = (await call('/profiles')).body;
    assert.equal(all.chain_id, `0x${CHAIN.toString(16)}`);
    assert.deepEqual(all.profiles.map(x => x.handle).sort(), ['Broody', 'tengen']);
    const some = (await call(`/profiles?players=${address('b')},${address('c')}`)).body;
    assert.deepEqual(some.profiles.map(x => x.handle), ['tengen']);
    assert.equal((await call(`/profiles?players=${Array(101).fill(address('a')).join(',')}`)).status, 400);
  } finally {
    await server.close();
  }
});
