// The browser's side of a rated game (apps/web/src/rated), end to end in Node: a real matchmaker
// (over HTTP, on a fake chain), the anchor daemon, and a keeper that stamps
// steps. The player's wallet signs the request and the terms; the game is
// played with the session key the flow kept.
import test from "node:test";
import assert from "node:assert/strict";
import * as p from "../sdk/src/index.mjs";
import * as c from "../sdk/src/client.mjs";
import * as rating from "../sdk/src/rating.mjs";
import { serve } from "../matchmaker/server.mjs";
import { address, harness, stampingKeeper, walletSign } from "../matchmaker/test/fake.mjs";
import { AnchorDaemon } from "./anchor.ts";
import { play, type Position } from "../../apps/web/src/game/rules.ts";
import { RatedFlow } from "../../apps/web/src/rated/flow.ts";
import { RatedGame, PLAYING, SCORING } from "../../apps/web/src/rated/game.ts";

const AI = "yuna";
const pause = () => new Promise((r) => setTimeout(r, 5));

/** An engine that plays the first legal point, or passes once its opponent passed, and sees nothing dead. */
const engine: any = {
  async move(position: Position) {
    if (position.moves.at(-1)?.point === null) return { point: null, hopeless: false };
    for (let point = 0; point < position.board.length; point++) {
      try {
        play(position, point);
        return { point, hopeless: false };
      } catch {}
    }
    return { point: null, hopeless: false };
  },
  async analyze(position: Position) {
    return { ownership: position.board.map(() => 0), rootInfo: { scoreLead: 0 } };
  },
};

async function setup() {
  const clock = { ms: 1_700_000_000_000 };
  const keeper = stampingKeeper(clock);
  const h = await harness({ keepers: [keeper], clock, extra: { anchors: [{ player: address(AI), id: AI }] } });
  h.chain.state.anchors.set(address(AI), rating.MU_T[25]);
  const server = await serve(h.matchmaker, { poll_ms: 0 });
  const fetch = (async (url: string, init: any) =>
    url.startsWith(keeper.url) ? keeper.handle(url.slice(keeper.url.length), init) : globalThis.fetch(url, init)) as any;
  const wallet = (name: string) => ({ address: address(name), signTypedData: async (typed: unknown) => walletSign(name, typed) });
  const daemon = new AnchorDaemon(
    [{ id: AI, rank: "5k", wallet: { address: address(AI), signMessage: async (typed: any) => walletSign(AI, typed) } }],
    { matchmaker: server.url, chainId: p.tag("SN_SEPOLIA"), engine, store: new c.SessionStore(c.memoryBackend()),
      keys: 2, wait: 1, fetch, now: () => clock.ms },
  );
  const flow = (name: string, store = new c.SessionStore(c.memoryBackend())) =>
    ({ flow: new RatedFlow(wallet(name), { matchmaker: server.url, store, fetch, now: () => clock.ms }), store });
  return { h, keeper, server, fetch, daemon, flow };
}

/** Pull until it's our turn or the game is over. */
async function untilOurTurn(game: RatedGame) {
  for (let i = 0; i < 400 && !game.myTurn && !game.finished; i++) {
    await game.sync({ wait: 1 });
    await pause();
  }
}

test("a wallet asks for an AI, signs its terms, and plays the game on its session key", async () => {
  const { h, server, fetch, daemon, flow } = await setup();
  try {
    await daemon.tick();
    const { flow: me, store } = flow("a");
    // A 17k newcomer against the 5k anchor: the player takes black.
    const signed = await me.playAnchor({ anchor: address(AI), size: 9, band: 2 });
    assert.equal(signed.color, "black");
    assert.deepEqual(signed.signed, { black: true, white: false });
    // The anchor signs; the keeper takes the game.
    await daemon.tick();
    const pairing = await me.waitReady(signed.digest, { everyMs: 5 });
    assert.ok(pairing?.ready);
    assert.equal((await me.current())?.digest, signed.digest);

    const game = await RatedGame.open(pairing!, store, fetch);
    await game.sync();
    assert.equal(game.myTurn, true);
    await game.play(40);
    assert.equal(game.position.board[40], 1);
    await daemon.tick();
    await untilOurTurn(game);
    // The anchor answered at the first legal point.
    assert.equal(game.position.board[0], 2);
    assert.equal(game.phase, PLAYING);
    // The clock runs on the referee's stamps.
    const { left, flagAt } = game.clock(h.clock.ms);
    assert.equal(left?.length, 2);
    assert.ok(flagAt! > h.clock.ms);

    // We pass, the anchor passes back: scoring, and we propose the count.
    await game.pass();
    await untilOurTurn(game);
    assert.equal(game.phase, SCORING);
    await game.propose([]);
    for (let i = 0; i < 400 && !game.finished; i++) {
      await game.sync({ wait: 1 });
      await pause();
    }
    assert.equal(game.finished, true);
    assert.equal(game.reason, "by agreement");
    // One stone each and every empty point neutral: White wins on komi.
    assert.equal(game.winner, 2);
  } finally {
    await server.close();
  }
});

test("terms are signed only for a session key this browser made", async () => {
  const { daemon, server, flow } = await setup();
  try {
    await daemon.tick();
    const { flow: me } = flow("a");
    const signed = await me.playAnchor({ anchor: address(AI), size: 9, band: 2 });
    // The same wallet in another browser, without the key: it refuses.
    const { flow: elsewhere } = flow("a");
    await assert.rejects(elsewhere.accept(signed), /session key is not one this browser made/);
  } finally {
    await server.close();
  }
});
