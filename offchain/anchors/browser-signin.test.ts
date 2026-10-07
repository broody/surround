// Signing in from the browser (apps/web/src/rated: RatedFlow and SignInStore),
// end to end in Node: a real matchmaker over HTTP, on a fake chain, and the AI
// daemon. One wallet signature signs in; the browser key, kept encrypted,
// agrees to the games after.
import test from "node:test";
import assert from "node:assert/strict";
import * as p from "../sdk/src/index.mjs";
import * as c from "../sdk/src/client.mjs";
import * as rating from "../sdk/src/rating.mjs";
import { serve } from "../matchmaker/server.mjs";
import { address, harness, stampingKeeper, walletSign } from "../matchmaker/test/fake.mjs";
import { AnchorDaemon } from "./anchor.ts";
import { RatedFlow } from "../../apps/web/src/rated/flow.ts";
import { SignInStore, memoryBox, type KeyBox } from "../../apps/web/src/rated/signin.ts";

const AI = "yuna";
const engine: any = { async move() { return { point: null, hopeless: false }; }, async analyze() { return {}; } };

async function setup(delegation_seconds = c.DELEGATION_SECONDS) {
  const clock = { ms: 1_700_000_000_000 };
  const keeper = stampingKeeper(clock);
  const h = await harness({ keepers: [keeper], clock,
    extra: { anchors: [{ player: address(AI), id: AI }], delegation_seconds } });
  h.chain.state.anchors.set(address(AI), rating.MU_T[25]);
  const server = await serve(h.matchmaker, { poll_ms: 0 });
  const fetch = (async (url: string, init: any) =>
    url.startsWith(keeper.url) ? keeper.handle(url.slice(keeper.url.length), init) : globalThis.fetch(url, init)) as any;
  const daemon = new AnchorDaemon(
    [{ id: AI, rank: "5k", wallet: { address: address(AI), signMessage: async (typed: any) => walletSign(AI, typed) } }],
    { matchmaker: server.url, chainId: p.tag("SN_SEPOLIA"), engine, store: new c.SessionStore(c.memoryBackend()),
      keys: 4, wait: 1, fetch, now: () => clock.ms },
  );
  /** Player `name`'s flow, signing in to `box`, and how many times its wallet was asked to sign. */
  const player = (name: string, box: KeyBox = memoryBox()) => {
    const prompts = { count: 0 };
    const wallet = { address: address(name),
      signTypedData: async (typed: unknown) => { prompts.count++; return walletSign(name, typed); } };
    const signIns = new SignInStore(box, { now: () => clock.ms });
    const store = new c.SessionStore(c.memoryBackend());
    const flow = new RatedFlow(wallet, { matchmaker: server.url, store, fetch, now: () => clock.ms, signIns });
    return { flow, store, signIns, box, prompts };
  };
  const play = (flow: RatedFlow) => flow.playAnchor({ anchor: address(AI), size: 9, band: 2 });
  return { h, clock, server, daemon, player, play };
}

/** Seat 0 resigns pairing `digest`'s game at its keeper, with the session key the flow kept for it. */
async function resign(h: any, store: any, digest: string, ms: number) {
  const game = h.game(BigInt(digest));
  const { privateKey } = await store.keyFor(game.terms);
  game.keeper.resign(game.terms, 0, privateKey, ms);
}

test("signed in with one wallet signature, a player takes rated games with no further prompt", async () => {
  const { h, clock, server, daemon, player, play } = await setup();
  try {
    await daemon.tick();
    const { flow, store, box, prompts } = player("a");
    assert.equal(await flow.signIn(), true);
    assert.equal(prompts.count, 1);
    const signedIn = (await flow.signedIn())!;
    assert.deepEqual(h.matchmaker.delegatesOf(address("a")).delegates.map((d: any) => d.key), [signedIn.key]);
    // Kept encrypted: the record holds no key in the clear, and the wrapping key can't be read out.
    const record = await box.get(`player:${BigInt(address("a")).toString(16)}`);
    const stored = Buffer.from(record.data).toString("hex");
    assert.ok(!stored.includes(signedIn.privateKey.toString(16)));
    await assert.rejects(globalThis.crypto.subtle.exportKey("raw", await box.get("wrap")));
    // Two games in a row: the browser key agrees to both.
    for (let n = 0; n < 2; n++) {
      const status = await play(flow);
      assert.deepEqual([status.status, status.signed.black], ["paired", true]);
      assert.ok(p.isDelegated(h.matchmaker.tickets.get(BigInt(status.digest)).signatures.black));
      // The anchor signs, the keeper holds the game, black resigns, and the player is free again.
      await daemon.tick();
      assert.equal(h.matchmaker.status(address("a")).ready, true);
      await resign(h, store, status.digest, clock.ms);
      await h.matchmaker.tick();
      await daemon.tick();
    }
    assert.equal(prompts.count, 1);
  } finally {
    await server.close();
  }
});

test("signing out revokes the key without a prompt, and a game then asks the wallet", async () => {
  const { h, server, daemon, player, play } = await setup();
  try {
    await daemon.tick();
    const { flow, prompts } = player("a");
    await flow.signIn();
    await flow.signOut();
    assert.equal(prompts.count, 1);
    assert.equal(await flow.signedIn(), null);
    assert.deepEqual(h.matchmaker.delegatesOf(address("a")).delegates, []);
    const status = await play(flow);
    assert.equal(status.status, "paired");
    assert.equal(prompts.count, 2);
    assert.ok(!p.isDelegated(h.matchmaker.tickets.get(BigInt(status.digest)).signatures.black));
  } finally {
    await server.close();
  }
});

test("a key revoked elsewhere is forgotten, and the wallet signs that game", async () => {
  const { h, server, daemon, player, play } = await setup();
  try {
    await daemon.tick();
    const { flow, prompts } = player("a");
    await flow.signIn();
    // Signed out everywhere from another device.
    await h.matchmaker.revoke(h.request("a", "revoke", { key: 0 }));
    assert.equal((await play(flow)).status, "paired");
    assert.equal(prompts.count, 2);
    assert.equal(await flow.signedIn(), null);
  } finally {
    await server.close();
  }
});

test("where the matchmaker takes no sign-ins, signing in asks nothing and every game takes the wallet", async () => {
  const { server, player } = await setup(0);
  try {
    const { flow, prompts } = player("a");
    assert.equal(await flow.signIn(), false);
    assert.equal(prompts.count, 0);
  } finally {
    await server.close();
  }
});

test("a sign-in decrypts for its player only, until it expires or its wrapping key is gone", async () => {
  const clock = { ms: 1_700_000_000_000 };
  const box = memoryBox();
  const store = new SignInStore(box, { now: () => clock.ms });
  const key = { privateKey: 0x1234n, key: p.hex(p.publicKey(0x1234n)), expires_at: clock.ms / 1000 + 3600 };
  await store.save(address("a"), key);
  assert.deepEqual(await store.key(address("a")), key);
  assert.equal(await store.key(address("b")), null);
  // Another player's record under this one's name does not decrypt: it is bound to its player.
  await box.put(`player:${BigInt(address("b")).toString(16)}`, await box.get(`player:${BigInt(address("a")).toString(16)}`));
  assert.equal(await store.key(address("b")), null);
  // Cleared storage took the wrapping key: sign in again.
  const wrap = await box.get("wrap");
  await box.delete("wrap");
  assert.equal(await store.key(address("a")), null);
  await box.put("wrap", wrap);
  clock.ms += 3600_000;
  assert.equal(await store.key(address("a")), null);
});
