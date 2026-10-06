// The anchor daemon against a real matchmaker (served over HTTP, on a fake
// chain) and a fake keeper that stamps the steps it is sent: it offers keys,
// checks and signs its pairing, and plays its game until it is over.
import test from "node:test";
import assert from "node:assert/strict";
import * as p from "../sdk/src/index.mjs";
import * as c from "../sdk/src/client.mjs";
import * as rating from "../sdk/src/rating.mjs";
import { parse } from "../sdk/node_modules/@arbiter/sdk/sdk/src/store.mjs";
import { serve } from "../matchmaker/server.mjs";
import { address, fakeKeeper, harness, walletSign } from "../matchmaker/test/fake.mjs";
import { play, type Position } from "../../apps/web/src/game/rules.ts";
import { AnchorDaemon, positionOf } from "./anchor.ts";

const AI = "aiko";
const tick = () => new Promise((r) => setTimeout(r, 5));

/** A keeper that also takes steps and stamps them, and makes a long poll wait a little. */
function stampingKeeper(clock: { ms: number }) {
  const k: any = fakeKeeper();
  const handle = k.handle;
  k.handle = async (path: string, init: any = {}) => {
    const method = init.method ?? "GET";
    const route = path.split("?")[0];
    if (method === "POST" && route.endsWith("/steps")) {
      const session = k.games.get(route.slice(0, -"/steps".length));
      for (const step of parse(init.body).steps)
        session.stamp(step, clock.ms, k.refereeKey);
      return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
    }
    if (method === "GET" && route.endsWith("/steps")) await tick();
    return handle(path, init);
  };
  return k;
}

/** An engine that plays the first legal point (or passes, if `passing`) and sees nothing dead. */
const engine: any = {
  moves: 0,
  passing: false,
  async move(position: Position) {
    if (this.passing) return null;
    for (let point = 0; point < position.board.length; point++) {
      try {
        play(position, point);
        this.moves++;
        return point;
      } catch {}
    }
    return null;
  },
  async analyze(position: Position) {
    return { ownership: position.board.map(() => 0) };
  },
};

test("an anchor offers keys, signs its pairing's terms and plays the game through its keeper", async () => {
  const clock = { ms: 1_700_000_000_000 };
  const keeper = stampingKeeper(clock);
  const h = await harness({ keepers: [keeper], clock, extra: { anchors: [address(AI)] } });
  h.chain.state.anchors.set(address(AI), rating.MU_T[25]);
  const server = await serve(h.matchmaker, { poll_ms: 0 });
  const fetch = (async (url: string, init: any) =>
    url.startsWith(keeper.url)
      ? keeper.handle(url.slice(keeper.url.length), init)
      : globalThis.fetch(url, init)) as any;
  const store = new c.SessionStore(c.memoryBackend());
  const logs: string[] = [];
  const daemon = new AnchorDaemon(
    [{ id: AI, rank: "5k", wallet: { address: address(AI), signMessage: async (typed: any) => walletSign(AI, typed) } }],
    { matchmaker: server.url, chainId: p.tag("SN_SEPOLIA"), engine, store, keys: 3, wait: 1, fetch, log: (m) => logs.push(m),
      now: () => clock.ms },
  );
  try {
    await daemon.tick();
    assert.equal(h.matchmaker.anchorKeys.get(address(AI)).length, 3);
    // A 17k newcomer asks for the 5k anchor and plays black.
    const status = await h.matchmaker.play(h.request("a", "ai", { size: 19, clock: "turn", band: 2, anchor: address(AI) }));
    assert.equal(status.color, "black");
    await daemon.tick();
    assert.deepEqual(h.matchmaker.status(address("a")).signed, { black: false, white: true });
    await h.sign("a");
    const game = h.game(BigInt(status.digest));
    // Black's first stone; the anchor answers once it pulls it.
    keeper.play(game.terms, 60, h.sessionKeys.get(p.hex(game.terms.keys[0])), clock.ms);
    await daemon.tick();
    assert.equal(daemon.playing.size, 1);
    const session = keeper.games.get(`/games/${p.hex(game.terms.channel)}/${p.hex(game.terms.game_id)}`);
    for (let i = 0; i < 200 && session.env.game.next_player !== p.BLACK; i++) await tick();
    assert.equal(session.env.game.next_player, p.BLACK);
    assert.equal(engine.moves, 1);
    const position = positionOf(session);
    assert.deepEqual([position.board[60], position.board[0]], [1, 2]);
    // Black resigns: the anchor's game is over.
    h.resign(game, 0);
    await Promise.all(daemon.playing.values());
    assert.equal(daemon.playing.size, 0);
    assert.ok(logs.some((m) => /over: won/.test(m)), logs.join("\n"));
  } finally {
    await server.close();
  }
});

test("an anchor refuses to sign terms with a session key it never offered", async () => {
  const clock = { ms: 1_700_000_000_000 };
  const keeper = stampingKeeper(clock);
  const h = await harness({ keepers: [keeper], clock, extra: { anchors: [address(AI)] } });
  h.chain.state.anchors.set(address(AI), rating.MU_T[25]);
  const server = await serve(h.matchmaker, { poll_ms: 0 });
  const fetch = (async (url: string, init: any) =>
    url.startsWith(keeper.url) ? keeper.handle(url.slice(keeper.url.length), init) : globalThis.fetch(url, init)) as any;
  const logs: string[] = [];
  const wallet = { address: address(AI), signMessage: async (typed: any) => walletSign(AI, typed) };
  const options = { matchmaker: server.url, chainId: p.tag("SN_SEPOLIA"), engine, keys: 1, wait: 1, fetch, log: (m: string) => logs.push(m),
    now: () => clock.ms };
  try {
    // One daemon offers the key; another, with an empty store, is asked to sign.
    await new AnchorDaemon([{ id: AI, rank: "5k", wallet }], { ...options, store: new c.SessionStore(c.memoryBackend()) }).tick();
    await h.matchmaker.play(h.request("a", "ai", { size: 19, clock: "turn", band: 2, anchor: address(AI) }));
    const stranger = new AnchorDaemon([{ id: AI, rank: "5k", wallet }], { ...options, keys: 0, store: new c.SessionStore(c.memoryBackend()) });
    await stranger.tick();
    assert.deepEqual(h.matchmaker.status(address("a")).signed, { black: false, white: false });
    assert.ok(logs.some((m) => /a session key we never offered/.test(m)), logs.join("\n"));
  } finally {
    await server.close();
  }
});

test("at scoring, an anchor accepts a proposal that decides the game as its own estimate does", async () => {
  const clock = { ms: 1_700_000_000_000 };
  const keeper = stampingKeeper(clock);
  const h = await harness({ keepers: [keeper], clock, extra: { anchors: [address(AI)] } });
  h.chain.state.anchors.set(address(AI), rating.MU_T[25]);
  const server = await serve(h.matchmaker, { poll_ms: 0 });
  const fetch = (async (url: string, init: any) =>
    url.startsWith(keeper.url) ? keeper.handle(url.slice(keeper.url.length), init) : globalThis.fetch(url, init)) as any;
  const logs: string[] = [];
  const daemon = new AnchorDaemon(
    [{ id: AI, rank: "5k", wallet: { address: address(AI), signMessage: async (typed: any) => walletSign(AI, typed) } }],
    { matchmaker: server.url, chainId: p.tag("SN_SEPOLIA"), engine, store: new c.SessionStore(c.memoryBackend()), keys: 1,
      wait: 1, fetch, log: (m) => logs.push(m), now: () => clock.ms },
  );
  engine.passing = true;
  try {
    await daemon.tick();
    const status = await h.matchmaker.play(h.request("a", "ai", { size: 9, clock: "turn", band: 2, anchor: address(AI) }));
    await daemon.tick();
    await h.sign("a");
    const game = h.game(BigInt(status.digest));
    const session = keeper.games.get(`/games/${p.hex(game.terms.channel)}/${p.hex(game.terms.game_id)}`);
    const human = (step: any) =>
      session.stamp(p.signedStep(session.sign(step, h.sessionKeys.get(p.hex(game.terms.keys[0])))), clock.ms, keeper.refereeKey);
    // Black passes, the anchor passes: scoring, black to propose.
    human(p.goStep(p.PASS));
    await daemon.tick();
    for (let i = 0; i < 200 && session.env.game.phase !== p.SCORING; i++) await tick();
    assert.equal(session.env.game.phase, p.SCORING);
    // Nothing dead on an empty board: white wins on komi either way.
    human(p.goStep(p.PROPOSE, p.NO_POINT, 0n));
    await Promise.all(daemon.playing.values());
    assert.equal(session.env.game.phase, p.FINISHED);
    assert.deepEqual([session.env.outcome.winner, session.env.outcome.reason], [2, p.AGREEMENT]);
    assert.ok(logs.some((m) => /over: won/.test(m)), logs.join("\n"));
  } finally {
    engine.passing = false;
    await server.close();
  }
});
