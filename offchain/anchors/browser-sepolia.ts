// The browser's rated-game modules (apps/web/src/rated: RatedFlow and
// RatedGame), live on Sepolia against the running stack (stack.ts): the test
// newcomer's Argent account signs the terms it's offered, KataGo plays its
// moves, and the game is played to the end (scored by agreement, or
// resigned past MAX_STEPS), then rated.
//
//   node --experimental-strip-types --env-file=apps/web/.env.local offchain/anchors/browser-sepolia.ts [ANCHOR_ID]
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, RpcProvider, stark } from "../sdk/node_modules/starknet/dist/index.mjs";
import * as p from "../sdk/src/index.mjs";
import * as c from "../sdk/src/client.mjs";
import { KataGo } from "../lobby/engine.ts";
import { deadStones } from "../lobby/scoring.ts";
import { RatedFlow } from "../../apps/web/src/rated/flow.ts";
import { PLAYING, RatedGame, SCORING } from "../../apps/web/src/rated/game.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MATCHMAKER = process.env.SURROUND_MATCHMAKER_URL ?? "http://127.0.0.1:3300";
const which = process.argv[2] ?? "yuna";
/** Past this many steps the newcomer resigns: a live test, not a marathon. */
const MAX_STEPS = 160;
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

const state = JSON.parse(await readFile(resolve(root, "offchain/results/sepolia-arbiter-v7.json"), "utf8"));
const keys = JSON.parse(await readFile(resolve(root, "offchain/results/raw/sepolia-arbiter-v7/keys.json"), "utf8"));
const provider = new RpcProvider({ nodeUrl: process.env.SURROUND_SEPOLIA_RPC ?? "http://127.0.0.1:9545/rpc/v0_9" });
const account = new Account({ provider, address: state.newcomer, signer: keys.newcomer });
// What the browser's wallet does: SNIP-12 through the account, its signature as felts.
const signer = {
  address: state.newcomer,
  signTypedData: async (typed: unknown) =>
    stark.formatSignature(await account.signMessage(typed as any)).map((x: any) => p.hex(BigInt(x))),
};
const anchor = state.anchors[which];
assert(anchor, `No anchor ${which}`);
const before = await (await fetch(`${MATCHMAKER}/players/${state.newcomer}`)).json();
log(`newcomer ${before.rank ?? "unrated"}${before.provisional ? "?" : ""} after ${before.games} games, against ${which} (${anchor.rank})`);

const engine = new KataGo(process.env);
await engine.ready();
const store = new c.SessionStore(c.memoryBackend());
const flow = new RatedFlow(signer, { matchmaker: MATCHMAKER, store });
const signed = await flow.playAnchor({ anchor: anchor.address, size: 9, band: before.rated ? null : 1 });
log(`paired as ${signed.color}, signed; game ${signed.game_id}`);
const pairing = await flow.waitReady(signed.digest);
assert(pairing, "The game never reached its keeper");
const game = await RatedGame.open(pairing, store);
await game.sync();
log("the keeper holds the game; playing");

const pointOf = (r: any) => (r !== null && typeof r === "object" ? r.point : r);
while (!game.finished) {
  if (!game.myTurn) {
    await game.sync({ wait: 20 });
    continue;
  }
  if (game.phase === SCORING) {
    if (game.proposal.proposed) {
      log(`${which} proposed ${game.proposal.dead.size} dead stones; accepting`);
      await game.accept();
    } else {
      const analysis = await engine.analyze(game.position, game.komi);
      const dead = deadStones(game.position, analysis.ownership);
      log(`proposing ${dead.size} dead stones`);
      await game.propose(dead);
    }
  } else if (game.phase === PLAYING && game.steps >= MAX_STEPS) {
    log(`resigning at step ${game.steps}`);
    await game.resign();
  } else {
    const point = pointOf(await engine.move(game.position, game.komi, "20k"));
    if (point === null) await game.pass();
    else await game.play(point);
  }
}
log(`over after ${game.steps} steps: winner ${game.winner} ${game.reason}`);
engine.close();

for (let i = 0; ; i++) {
  const now = await (await fetch(`${MATCHMAKER}/players/${state.newcomer}`)).json();
  if (now.games > before.games) {
    log(`rated: ${now.rank}${now.provisional ? "?" : ""} after ${now.games} games (${now.wins} wins, ${now.losses} losses)`);
    break;
  }
  assert(i < 120, "Not rated within 20 minutes");
  if (i % 6 === 0) log("waiting for the keeper to settle and rate…");
  await new Promise((r) => setTimeout(r, 10_000));
}
process.exit(0);
