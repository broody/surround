// A wallet that signs the sign-in and nothing else (the Outis window, which a
// player signs in to with an email: apps/web/src/wallet/outis.ts), through the
// browser's flow in Node: a real matchmaker over HTTP, on a fake chain, and
// the AI daemon. Every lobby request and every game's terms are the browser
// key's; where the key is missing, revoked or too near its end, the player
// signs in again, and the wallet is never asked for anything else.
import test from "node:test";
import assert from "node:assert/strict";
import * as p from "../sdk/src/index.mjs";
import * as c from "../sdk/src/client.mjs";
import * as rating from "../sdk/src/rating.mjs";
import { serve } from "../matchmaker/server.mjs";
import { address, harness, stampingKeeper, walletSign } from "../matchmaker/test/fake.mjs";
import { AnchorDaemon } from "./anchor.ts";
import { RatedFlow } from "../../apps/web/src/rated/flow.ts";
import { SignInStore, memoryBox } from "../../apps/web/src/rated/signin.ts";

const AI = "yuna";
const engine: any = { async move() { return { point: null, hopeless: false }; }, async analyze() { return {}; } };
/** What the Outis window signs for Surround (its list): anything else it refuses. */
const LISTED = ["Delegation", "Profile"];

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
  /** Player `name` through the window: its flow, and each kind of message its wallet was asked to sign. */
  const player = (name: string) => {
    const asked: string[] = [];
    const wallet = {
      address: address(name),
      signInOnly: true,
      signTypedData: async (typed: any) => {
        asked.push(typed.primaryType);
        if (!LISTED.includes(typed.primaryType)) throw new Error(`Surround isn't listed for that kind of message: ${typed.primaryType}`);
        return walletSign(name, typed);
      },
    };
    const signIns = new SignInStore(memoryBox(), { now: () => clock.ms });
    const store = new c.SessionStore(c.memoryBackend());
    const flow = new RatedFlow(wallet, { matchmaker: server.url, store, fetch, now: () => clock.ms, signIns });
    return { flow, store, asked };
  };
  const play = (flow: RatedFlow) => flow.playAnchor({ anchor: address(AI), size: 9, band: 2 });
  /** Seat 0 resigns the game, and everyone moves on. */
  const finish = async (store: any, digest: string) => {
    await daemon.tick();
    const game = h.game(BigInt(digest));
    const { privateKey } = await store.keyFor(game.terms);
    game.keeper.resign(game.terms, 0, privateKey, clock.ms);
    await h.matchmaker.tick();
    await daemon.tick();
  };
  return { h, clock, server, daemon, player, play, finish };
}

test("a game with no sign-in yet signs in first, and the wallet signs nothing else", async () => {
  const { h, server, daemon, player, play, finish } = await setup();
  try {
    await daemon.tick();
    const { flow, store, asked } = player("a");
    for (let n = 0; n < 2; n++) {
      const status = await play(flow);
      assert.deepEqual([status.status, status.signed.black], ["paired", true]);
      assert.ok(p.isDelegated(h.matchmaker.tickets.get(BigInt(status.digest)).signatures.black));
      await finish(store, status.digest);
    }
    assert.deepEqual(asked, ["Delegation"]);
  } finally {
    await server.close();
  }
});

test("the queue, a table and leaving them are the browser key's, signed in on the way", async () => {
  const { server, player } = await setup();
  try {
    const { flow, asked } = player("a");
    assert.equal((await flow.queue({ rated: true, size: 9, clock: "turn", band: 2 })).status, "waiting");
    assert.deepEqual(await flow.leave(), { left: true });
    const { table } = await flow.host({ rated: false, size: 9, clock: "untimed", band: 2, private: true });
    assert.deepEqual(await flow.close(table), { closed: table });
    assert.deepEqual(asked, ["Delegation"]);
    // Signing out asks the wallet nothing; the next request signs in again.
    await flow.signOut();
    assert.equal((await flow.queue({ rated: true, size: 9, clock: "turn", band: 2 })).status, "waiting");
    assert.deepEqual(asked, ["Delegation", "Delegation"]);
  } finally {
    await server.close();
  }
});

test("a key revoked elsewhere: the player signs in again, for a lobby request and for a game", async () => {
  const { h, server, daemon, player, play } = await setup();
  try {
    await daemon.tick();
    const { flow, asked } = player("a");
    await flow.signIn();
    await h.matchmaker.revoke(h.request("a", "revoke", { key: 0 }));
    // A game: its request is unsigned, so the revoked key is found at the terms.
    const status = await play(flow);
    assert.deepEqual([status.status, status.signed.black], ["paired", true]);
    assert.deepEqual(asked, ["Delegation", "Delegation"]);
    const second = player("b");
    await second.flow.signIn();
    await h.matchmaker.revoke(h.request("b", "revoke", { key: 0 }));
    // A lobby request: refused for the revoked key, sent again under a new sign-in.
    assert.equal((await second.flow.queue({ rated: true, size: 9, clock: "turn", band: 2 })).status, "waiting");
    assert.deepEqual(second.asked, ["Delegation", "Delegation"]);
  } finally {
    await server.close();
  }
});

test("a sign-in ending too soon for a game is replaced by a new one, not by the wallet's signature", async () => {
  const { h, clock, server, daemon, player, play } = await setup();
  try {
    await daemon.tick();
    const { flow, asked } = player("a");
    await flow.signIn();
    const first = (await flow.signedIn())!;
    // An hour of the week left: a lobby request still passes, a game's terms don't.
    clock.ms += (c.DELEGATION_SECONDS - 3600) * 1000;
    h.chain.state.now += BigInt(c.DELEGATION_SECONDS - 3600);
    await daemon.tick();
    const status = await play(flow);
    assert.deepEqual([status.status, status.signed.black], ["paired", true]);
    assert.deepEqual(asked, ["Delegation", "Delegation"]);
    assert.notEqual((await flow.signedIn())!.key, first.key);
  } finally {
    await server.close();
  }
});

test("where the matchmaker takes no sign-ins, such a wallet can't play, and is asked nothing", async () => {
  const { server, daemon, player, play } = await setup(0);
  try {
    await daemon.tick();
    const { flow, asked } = player("a");
    await assert.rejects(play(flow), /Signing in isn't open/);
    await assert.rejects(flow.queue({ rated: true, size: 9, clock: "turn", band: 2 }), /Signing in isn't open/);
    assert.deepEqual(asked, []);
  } finally {
    await server.close();
  }
});

test("a sign-in signed beside something else: the delegation first, its signature after", async () => {
  const { h, server, player } = await setup();
  try {
    const { flow, asked } = player("a");
    const request = (await flow.signInRequest())!;
    assert.equal((request.typedData as any).primaryType, "Delegation");
    // Nothing is kept, here or at the matchmaker, until the wallet has signed.
    assert.equal(await flow.signedIn(), null);
    assert.deepEqual(h.matchmaker.delegatesOf(address("a")).delegates, []);
    await request.finish(walletSign("a", request.typedData));
    const signedIn = (await flow.signedIn())!;
    assert.deepEqual(h.matchmaker.delegatesOf(address("a")).delegates.map((d: any) => d.key), [signedIn.key]);
    assert.deepEqual(asked, []);
  } finally {
    await server.close();
  }
});

test("casual play too: the casual queue, a table joined and a casual AI game, all on the browser key", async () => {
  const { server, daemon, player } = await setup();
  try {
    await daemon.tick();
    // Two window players meet in the casual queue, and each agrees with its own browser key.
    const a = player("a"), b = player("b");
    const ask = { rated: false, size: 9, clock: "untimed", band: 2 };
    assert.equal((await a.flow.queue(ask)).status, "waiting");
    const pb = (await b.flow.queue(ask)) as any;
    assert.equal(pb.status, "paired");
    const pa = (await a.flow.current())!;
    assert.equal((await a.flow.accept(pa, { rated: false, size: 9 })).signed[pa.color], true);
    assert.equal((await b.flow.accept(pb, { rated: false, size: 9 })).signed[pb.color], true);
    assert.deepEqual([a.asked, b.asked], [["Delegation"], ["Delegation"]]);
    // A table one hosts and another joins, by its invite.
    const host = player("c"), guest = player("d");
    const { table } = await host.flow.host({ rated: false, size: 9, clock: "untimed", band: 2, private: true });
    const joined = await guest.flow.join(table, { band: 2 });
    assert.equal(joined.status, "paired");
    assert.equal((await guest.flow.accept(joined, { rated: false, size: 9 })).signed[joined.color], true);
    assert.deepEqual([host.asked, guest.asked], [["Delegation"], ["Delegation"]]);
    // A casual game against the AI, as a new player's first game may be.
    const e = player("e");
    const status = await e.flow.playAnchor({ anchor: address(AI), size: 9, band: 2, rated: false, color: "black" });
    assert.deepEqual([status.status, status.signed.black], ["paired", true]);
    assert.deepEqual(e.asked, ["Delegation"]);
  } finally {
    await server.close();
  }
});
