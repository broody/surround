// Signing in: a player's wallet signs one delegation (`delegationTypedData`)
// letting a browser key sign their queue and table requests and agree to
// rated games' terms in its place, until it expires or is revoked (signing
// out, or out everywhere). The channel checks the same delegation when the
// game opens (`open_rated_game_delegable`).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import * as rating from '../../sdk/src/rating.mjs';
import { CHAIN, CHANNEL, address, harness, reviveTerms, walletSign } from './fake.mjs';

let browsers = 0, nonces = 0x9000;
const WEEK = 7 * 24 * 3600, DAY = 24 * 3600;
const QUEUE = { size: 19, clock: 'turn', band: 2 };
const signingIn = (extra = {}) => harness({ extra: { delegation_seconds: c.DELEGATION_SECONDS, ...extra } });

/**
 * A browser `name` signs in on: its key, delegated by `wallet` (the player's
 * own by default) until `expiresAt` on `signIn`, signs lobby requests made
 * with `request` and the terms of the player's pairing with `approve`.
 */
function browser(h, name, m = () => h.matchmaker) {
  const secret = 0x7000n + BigInt(++browsers), key = p.hex(p.publicKey(secret));
  const request = (action, fields = {}, signer = secret) => {
    const session = ['queue', 'table', 'join'].includes(action) ? { key: h.newKey() } : {};
    const body = { player: address(name), at: h.at(), nonce: p.hex(++nonces), delegate: key, ...session, ...fields };
    return { ...body, signature: c.signRequest(c.matchmakerRequest({ chainId: CHAIN, action, ...body }), address(name), signer) };
  };
  const signIn = (expiresAt = h.at() + WEEK, wallet = name) => {
    const delegation = { chain_id: CHAIN, channel: CHANNEL, key, expires_at: expiresAt };
    return m().delegate({ player: address(name), key, expires_at: expiresAt,
      signature: walletSign(wallet, p.delegationTypedData(p.go, delegation)) });
  };
  const approve = (signer = secret) => {
    const status = m().status(address(name));
    const { r, s } = p.sign(p.termsMessageHash(p.go, reviveTerms(status.terms), address(name)), signer);
    return m().sign(status.digest, { player: address(name), approval: { key, signature: { r: p.hex(r), s: p.hex(s) } } });
  };
  return { key, secret, request, signIn, approve };
}

test('one wallet signature signs in; the browser key then queues, keeps tables and agrees to games', async () => {
  const h = await signingIn({ min_table_games: 0 });
  const b = browser(h, 'a');
  const expires = h.at() + WEEK;
  assert.deepEqual(await b.signIn(expires), { player: address('a'), delegates: [{ key: b.key, expires_at: expires }] });
  assert.equal((await h.matchmaker.info()).delegation_seconds, c.DELEGATION_SECONDS);
  assert.equal((await h.matchmaker.enqueue(b.request('queue', QUEUE))).status, 'waiting');
  assert.deepEqual(await h.matchmaker.leave(b.request('leave')), { left: true });
  const { table } = await h.matchmaker.host(b.request('table', QUEUE));
  assert.deepEqual(await h.matchmaker.close(table, b.request('close', { table })), { closed: table });
  // Paired from the browser's request, the key agrees to the terms too: no wallet prompt.
  await h.matchmaker.enqueue(b.request('queue', QUEUE));
  await h.queue('b');
  assert.deepEqual((await b.approve()).signed, { black: true, white: false });
  // The keeper gets the delegated approval, delegation and all, to open the game with.
  await h.sign('b');
  const [registered] = h.keeper.registrations;
  const approval = registered.authorizations[0];
  assert.ok(p.isDelegated(approval));
  assert.equal(approval.key, b.key);
  assert.equal(approval.expires_at, expires);
  const typed = p.delegationTypedData(p.go, { chain_id: CHAIN, channel: CHANNEL, key: b.key, expires_at: expires });
  assert.ok(await h.chain.verify(address('a'), typed, approval.delegation));
});

test('a sign-in runs at most delegation_seconds, only the wallet signs it, and a game needs a day of it left', async () => {
  const off = await harness();
  await assert.rejects(browser(off, 'a').signIn(), e => e.status === 403 && /not open/.test(e.message));
  const h = await signingIn();
  const now = h.at();
  const b = browser(h, 'a');
  await assert.rejects(b.signIn(now + c.DELEGATION_SECONDS + 1), e => e.status === 400);
  await assert.rejects(b.signIn(now), e => e.status === 400);
  await assert.rejects(b.signIn(now + WEEK, 'c'), e => e.status === 401);
  // Less than a day left: the key still queues, but a game it agreed to could outlast it.
  await b.signIn(now + DAY - 60);
  await h.matchmaker.enqueue(b.request('queue', QUEUE));
  await h.queue('b');
  await assert.rejects(b.approve(), e => e.status === 409 && /too soon/.test(e.message));
  // Expired, it signs nothing.
  h.advance(DAY * 1000);
  await assert.rejects(h.matchmaker.leave(b.request('leave')), e => e.status === 401 && /sign in again/.test(e.message));
  assert.deepEqual(h.matchmaker.delegatesOf(address('a')).delegates, []);
  // Signing in closed: the sign-ins kept stop counting, since the keepers would refuse their games.
  const fresh = browser(h, 'c');
  await fresh.signIn();
  h.matchmaker.config.delegation_seconds = 0;
  await assert.rejects(h.matchmaker.leave(fresh.request('leave')), e => e.status === 401 && /sign in again/.test(e.message));
});

test('signed in, a player takes an AI game\'s offer with the browser key: no wallet prompt at all', async () => {
  const AI = 'yuna';
  const h = await signingIn({ anchors: [{ player: address(AI), id: AI }] });
  h.chain.state.anchors.set(address(AI), rating.MU_T[25]);
  await h.matchmaker.offerKey(address(AI), h.request(AI, 'anchor_key'));
  const b = browser(h, 'a');
  await b.signIn();
  const offer = await h.matchmaker.play({ player: address('a'), key: h.newKey(), size: 19, clock: 'turn', band: 2,
    anchor: address(AI) });
  const { r, s } = p.sign(p.termsMessageHash(p.go, reviveTerms(offer.terms), address('a')), b.secret);
  const taken = await h.matchmaker.sign(offer.digest, { player: address('a'), approval: { key: b.key, signature: { r, s } } });
  assert.equal(taken.status, 'paired');
  assert.deepEqual(taken.signed, { black: true, white: false });
  assert.ok(p.isDelegated(h.matchmaker.tickets.get(BigInt(offer.digest)).signatures.black));
});

test('a browser key signs only what it may, only for its player, only terms it signed, and only itself out', async () => {
  const h = await signingIn();
  const b = browser(h, 'a'), other = browser(h, 'a'), stranger = browser(h, 'c');
  // Not signed in yet.
  await assert.rejects(h.matchmaker.enqueue(b.request('queue', QUEUE)), e => e.status === 401 && /sign in again/.test(e.message));
  await b.signIn();
  await other.signIn();
  // Another player's request, or a signature by another key naming this one.
  await assert.rejects(h.matchmaker.enqueue({ ...b.request('queue', QUEUE), player: address('c') }), e => e.status === 401);
  await assert.rejects(h.matchmaker.enqueue(b.request('queue', QUEUE, 0x7fffn)), e => e.status === 401 && /Bad signature/.test(e.message));
  await assert.rejects(h.matchmaker.enqueue(stranger.request('queue', QUEUE)), e => e.status === 401);
  // Only the wallet signs out everywhere; a key revokes only itself.
  await assert.rejects(h.matchmaker.revoke(b.request('revoke', { key: 0 })), e => e.status === 403);
  await assert.rejects(h.matchmaker.revoke(b.request('revoke', { key: other.key })), e => e.status === 403);
  // A request can't be replayed, whoever signed it.
  const request = b.request('queue', QUEUE);
  await h.matchmaker.enqueue(request);
  await assert.rejects(h.matchmaker.enqueue(request), /Replayed request/);
  // Paired: another key's signature under this key's name agrees to nothing, nor does the key as a wallet.
  const status = await h.queue('b');
  await assert.rejects(b.approve(0x7fffn), e => e.status === 401 && /Bad signature/.test(e.message));
  const typed = c.goTermsTypedData(reviveTerms(h.matchmaker.status(address('a')).terms));
  const asWallet = c.signRequest(typed, address('a'), b.secret);
  await assert.rejects(h.matchmaker.sign(status.digest, { player: address('a'), signature: asWallet }), e => e.status === 401);
  assert.deepEqual(h.matchmaker.delegatesOf(address('a')).delegates.map(d => d.key), [b.key, other.key]);
});

test('signing out revokes a key for good, out everywhere revokes all, and a ninth sign-in revokes the oldest', async () => {
  const h = await signingIn();
  const [b1, b2] = [browser(h, 'a'), browser(h, 'a')];
  await b1.signIn();
  await b2.signIn();
  // b1 signs out, by its own key: no wallet prompt.
  assert.deepEqual((await h.matchmaker.revoke(b1.request('revoke', { key: b1.key }))).delegates.map(d => d.key), [b2.key]);
  await assert.rejects(h.matchmaker.enqueue(b1.request('queue', QUEUE)), /sign in again/);
  // Its delegation is onchain with every game it opened: signed in again, it is still refused.
  await assert.rejects(b1.signIn(), e => e.status === 403 && /revoked/.test(e.message));
  // The wallet revokes b2 by name, and a key it never signed in with, for later.
  await h.matchmaker.revoke(h.request('a', 'revoke', { key: b2.key }));
  const later = browser(h, 'a');
  await h.matchmaker.revoke(h.request('a', 'revoke', { key: later.key }));
  await assert.rejects(later.signIn(), /revoked/);
  // Eight browsers at most: the ninth sign-in revokes the first.
  const many = Array.from({ length: 9 }, () => browser(h, 'a'));
  for (const b of many) await b.signIn();
  assert.deepEqual(h.matchmaker.delegatesOf(address('a')).delegates.map(d => d.key), many.slice(1).map(b => b.key));
  await assert.rejects(h.matchmaker.leave(many[0].request('leave')), /sign in again/);
  assert.deepEqual(await h.matchmaker.leave(many[8].request('leave')), { left: false });
  // Out everywhere, by the wallet.
  assert.deepEqual((await h.matchmaker.revoke(h.request('a', 'revoke', { key: 0 }))).delegates, []);
  for (const b of many) await assert.rejects(h.matchmaker.leave(b.request('leave')), /sign in again/);
  // A revoked key's delegation expires, and so does its refusal.
  h.advance((c.DELEGATION_SECONDS + 1) * 1000);
  assert.deepEqual((await b1.signIn()).delegates.map(d => d.key), [b1.key]);
});

test('sign-ins and revocations survive a restart', async () => {
  const h = await signingIn();
  let m = h.matchmaker;
  const [kept, revoked] = [browser(h, 'a', () => m), browser(h, 'a', () => m)];
  await kept.signIn();
  await revoked.signIn();
  await m.revoke(revoked.request('revoke', { key: revoked.key }));
  m = await h.open();
  assert.deepEqual(m.delegatesOf(address('a')).delegates.map(d => d.key), [kept.key]);
  assert.equal((await m.enqueue(kept.request('queue', QUEUE))).status, 'waiting');
  await assert.rejects(m.enqueue(revoked.request('queue', QUEUE)), /sign in again/);
  await assert.rejects(revoked.signIn(), /revoked/);
});
