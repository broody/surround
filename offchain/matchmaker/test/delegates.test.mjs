// Browser keys: a player's wallet delegates one per sign-in, and it signs the
// player's queue and table requests until it's revoked (signing out, or out
// everywhere). It never signs a game's terms: only the wallet does.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import { CHAIN, address, harness, reviveTerms } from './fake.mjs';

let browsers = 0, nonces = 0x9000;

/** A browser `name` signs in on: its key, delegated by the wallet on `signIn`, signs requests made with `request`. */
function browser(h, name, m = () => h.matchmaker) {
  const secret = 0x7000n + BigInt(++browsers), key = p.hex(p.publicKey(secret));
  const request = (action, fields = {}, signer = secret) => {
    const session = ['queue', 'table', 'join'].includes(action) ? { key: h.newKey() } : {};
    const body = { player: address(name), at: h.at(), nonce: p.hex(++nonces), delegate: key, ...session, ...fields };
    return { ...body, signature: c.signRequest(c.matchmakerRequest({ chainId: CHAIN, action, ...body }), address(name), signer) };
  };
  return { key, secret, request, signIn: () => m().delegate(h.request(name, 'delegate', { key })) };
}

const QUEUE = { size: 19, clock: 'turn', band: 2 };

test('a signed-in browser queues, leaves and keeps tables for its player; only the wallet signs the terms', async () => {
  const h = await harness({ extra: { min_table_games: 0 } });
  const b = browser(h, 'a');
  assert.deepEqual(await b.signIn(), { player: address('a'), keys: [b.key] });
  assert.deepEqual(h.matchmaker.delegatesOf(address('a')).keys, [b.key]);
  assert.equal((await h.matchmaker.enqueue(b.request('queue', QUEUE))).status, 'waiting');
  assert.deepEqual(await h.matchmaker.leave(b.request('leave')), { left: true });
  const { table } = await h.matchmaker.host(b.request('table', { size: 19, clock: 'turn', band: 2 }));
  assert.deepEqual(await h.matchmaker.close(table, b.request('close', { table })), { closed: table });
  // Paired from the browser's request: the terms still need the wallet.
  await h.matchmaker.enqueue(b.request('queue', QUEUE));
  const status = await h.queue('b');
  const typed = c.goTermsTypedData(reviveTerms(status.terms));
  const byBrowser = c.signRequest(typed, address('a'), b.secret);
  await assert.rejects(h.matchmaker.sign(status.digest, { player: address('a'), signature: byBrowser }), e => e.status === 401);
  assert.deepEqual((await h.sign('a')).signed, { black: true, white: false });
});

test('a browser key signs only what it was delegated for, only for its player, and only itself', async () => {
  const h = await harness();
  const b = browser(h, 'a'), other = browser(h, 'a'), stranger = browser(h, 'c');
  // Not signed in yet.
  await assert.rejects(h.matchmaker.enqueue(b.request('queue', QUEUE)), e => e.status === 401 && /sign in again/.test(e.message));
  await b.signIn();
  await other.signIn();
  // Another player's request, or a signature by another key naming this one.
  await assert.rejects(h.matchmaker.enqueue({ ...b.request('queue', QUEUE), player: address('c') }), e => e.status === 401);
  await assert.rejects(h.matchmaker.enqueue(b.request('queue', QUEUE, 0x7fffn)), e => e.status === 401 && /Bad signature/.test(e.message));
  await assert.rejects(h.matchmaker.enqueue(stranger.request('queue', QUEUE)), e => e.status === 401);
  // Only the wallet delegates, or signs out everywhere; a key revokes only itself.
  await assert.rejects(h.matchmaker.delegate(b.request('delegate', { key: p.hex(0x1234n) })), e => e.status === 403);
  await assert.rejects(h.matchmaker.revoke(b.request('revoke', { key: 0 })), e => e.status === 403);
  await assert.rejects(h.matchmaker.revoke(b.request('revoke', { key: other.key })), e => e.status === 403);
  // A request can't be replayed, whoever signed it.
  const request = b.request('queue', QUEUE);
  await h.matchmaker.enqueue(request);
  await assert.rejects(h.matchmaker.enqueue(request), /Replayed request/);
  assert.deepEqual(h.matchmaker.delegatesOf(address('a')).keys, [b.key, other.key]);
});

test('signing out revokes a browser key, out everywhere revokes all, and a ninth sign-in revokes the oldest', async () => {
  const h = await harness();
  const [b1, b2] = [browser(h, 'a'), browser(h, 'a')];
  await b1.signIn();
  await b2.signIn();
  // b1 signs out, by its own key: no wallet prompt.
  assert.deepEqual((await h.matchmaker.revoke(b1.request('revoke', { key: b1.key }))).keys, [b2.key]);
  await assert.rejects(h.matchmaker.enqueue(b1.request('queue', QUEUE)), /sign in again/);
  // The wallet revokes b2 by name.
  assert.deepEqual((await h.matchmaker.revoke(h.request('a', 'revoke', { key: b2.key }))).keys, []);
  await assert.rejects(h.matchmaker.enqueue(b2.request('queue', QUEUE)), /sign in again/);
  // Eight browsers at most: the ninth sign-in revokes the first.
  const many = Array.from({ length: 9 }, () => browser(h, 'a'));
  for (const b of many) await b.signIn();
  assert.deepEqual(h.matchmaker.delegatesOf(address('a')).keys, many.slice(1).map(b => b.key));
  await assert.rejects(h.matchmaker.leave(many[0].request('leave')), /sign in again/);
  assert.deepEqual(await h.matchmaker.leave(many[8].request('leave')), { left: false });
  // Out everywhere, by the wallet.
  assert.deepEqual((await h.matchmaker.revoke(h.request('a', 'revoke', { key: 0 }))).keys, []);
  for (const b of many) await assert.rejects(h.matchmaker.leave(b.request('leave')), /sign in again/);
});

test('delegations and revocations survive a restart', async () => {
  const h = await harness();
  let m = h.matchmaker;
  const [kept, revoked] = [browser(h, 'a', () => m), browser(h, 'a', () => m)];
  await kept.signIn();
  await revoked.signIn();
  await m.revoke(revoked.request('revoke', { key: revoked.key }));
  m = await h.open();
  assert.deepEqual(m.delegatesOf(address('a')).keys, [kept.key]);
  assert.equal((await m.enqueue(kept.request('queue', QUEUE))).status, 'waiting');
  await assert.rejects(m.enqueue(revoked.request('queue', QUEUE)), /sign in again/);
});
