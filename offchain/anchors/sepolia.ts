// A newcomer plays an AI anchor on Sepolia, end to end, with nothing faked:
// the matchmaker pairs them (POST /ai), the anchor daemon signs and plays
// (KataGo), arbiter's keeper referees, opens, settles and rates the game, and
// SurroundRatings rates only the newcomer, against the anchor's pin.
//
//   SURROUND_ARBITER=~/development/referee \
//     node --experimental-strip-types offchain/anchors/sepolia.ts [ANCHOR]
//
// It needs the v7 deployment (`node offchain/sepolia.mjs deploy`), whose
// record (results/sepolia-arbiter-v7.json) names the contracts and anchors and
// whose test keys (results/raw/sepolia-arbiter-v7/keys.json) sign for the
// matchmaker, the keeper's referee and the anchors. The funded signer
// (~/.starknet_accounts, as for sepolia.mjs) is the keeper's and the
// matchmaker's account. The newcomer is a fresh account like it, deployed once.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, RpcProvider, ec, stark } from "../sdk/node_modules/starknet/dist/index.mjs";
import * as p from "../sdk/src/index.mjs";
import * as c from "../sdk/src/client.mjs";
import * as rating from "../sdk/src/rating.mjs";
import { fetchRatingEvents, verifyRatings } from "../sdk/src/replay.mjs";
import { starknetChain } from "../matchmaker/chain.mjs";
import { Matchmaker } from "../matchmaker/matchmaker.mjs";
import { serve } from "../matchmaker/server.mjs";
import { memoryStore } from "../matchmaker/store.mjs";
import { KataGo } from "../lobby/engine.ts";
import { play } from "../../apps/web/src/game/rules.ts";
import { AnchorDaemon, newSessionKey, positionOf } from "./anchor.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RPC = process.env.SURROUND_SEPOLIA_RPC ?? "http://127.0.0.1:9545/rpc/v0_9";
const KEEPER_RPC = process.env.SURROUND_KEEPER_RPC ?? "http://127.0.0.1:9545/rpc/v0_10";
const ARBITER = resolve(process.env.SURROUND_ARBITER ?? resolve(homedir(), "development/referee"));
const recordFile = resolve(root, "offchain/results/sepolia-arbiter-v7.json");
const raw = resolve(root, "offchain/results/raw/sepolia-arbiter-v7");
const which = process.argv[2] ?? "aiko";
const SIZE = 9;
/** Black resigns after this many steps: past the 20 a rated game needs. */
const RESIGN_AT = 30;
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const state = JSON.parse(await readFile(recordFile, "utf8"));
const save = () => writeFile(recordFile, p.json(state));
assert(state.ratings && state.anchors, "Deploy v7 first: node offchain/sepolia.mjs deploy");
const keysFile = resolve(raw, "keys.json");
const keys = Object.fromEntries(
  Object.entries(JSON.parse(await readFile(keysFile, "utf8"))).map(([n, v]) => [n, BigInt(v as string)]),
);
if (keys.newcomer == null) {
  keys.newcomer = BigInt(`0x${Buffer.from(ec.starkCurve.utils.randomPrivateKey()).toString("hex")}`);
  await writeFile(keysFile, JSON.stringify(Object.fromEntries(Object.entries(keys).map(([n, v]) => [n, p.hex(v)]))), { mode: 0o600 });
}
const provider = new RpcProvider({ nodeUrl: RPC });
const accounts = JSON.parse(await readFile(resolve(homedir(), ".starknet_accounts/starknet_open_zeppelin_accounts.json"), "utf8"));
const stored = accounts["alpha-sepolia"][process.env.SURROUND_SEPOLIA_ACCOUNT ?? "account-1"];
const signer = new Account({ provider, address: stored.address, signer: stored.private_key });
/** A wallet signature as the matchmaker takes it: felts in hex. */
const walletSignature = (s: any) => stark.formatSignature(s).map((x: any) => p.hex(BigInt(x)));
const block = async () => (await provider.getBlockWithTxHashes("latest")).block_number;

// The newcomer: a fresh account like the signer's (Argent: a Starknet owner,
// no guardian). It only signs.
if (!state.newcomer) {
  const tx = await signer.deploy({ classHash: await provider.getClassHashAt(stored.address), salt: "0x6e6577636f6d6572",
    constructorCalldata: [0, p.publicKey(keys.newcomer), 1] }, { tip: 0n });
  await provider.waitForTransaction(tx.transaction_hash);
  state.newcomer = tx.contract_address[0];
  await save();
  log(`newcomer deployed at ${state.newcomer}`);
}
const newcomer = new Account({ provider, address: state.newcomer, signer: p.hex(keys.newcomer) });
const anchor = state.anchors[which];
assert(anchor, `No anchor ${which}`);

// KataGo plays the newcomer's moves, and the anchors' when this script runs them.
const stopAll: (() => unknown)[] = [];
process.on("exit", () => stopAll.forEach((f) => f()));
const engine = new KataGo(process.env);
await engine.ready();
assert(engine.status().human, "Set KATAGO_HUMAN_MODEL: anchors play KataGo's human SL profiles");
stopAll.push(() => engine.close());

// With SURROUND_STACK set, play against the stack `stack.ts` runs (keeper on
// 3200, matchmaker on 3300, the anchors); otherwise run them here.
let keeperUrl = "http://127.0.0.1:3200", mmUrl = "http://127.0.0.1:3300";
if (!process.env.SURROUND_STACK) {
  // The keeper: arbiter's, refereeing with the lobby keeper's key and paying
  // from the signer's account, Surround's hooks opening and rating games.
  const keeperPort = 3201;
  keeperUrl = `http://127.0.0.1:${keeperPort}`;
  await mkdir(raw, { recursive: true });
  const keeperConfig = resolve(raw, "keeper.json");
  await writeFile(keeperConfig, JSON.stringify({
    host: "127.0.0.1", port: keeperPort, store: resolve(raw, "keeper-data"), chain_id: "SN_SEPOLIA", rpc_url: KEEPER_RPC,
    poll_seconds: 5, settle: true, referee: { private_key_env: "KEEPER_REFEREE_KEY" },
    account: { address: stored.address, private_key_env: "KEEPER_PRIVATE_KEY", max_fee_fri: "50000000000000000000" },
    games: [{
      channel: state.channel, module: resolve(root, "offchain/matchmaker/keeper-hooks.mjs"), export: "go",
      entrypoints: { get_channel: "get_channel", submit_history: "submit_history", resolve: "resolve_dispute",
        acknowledge: "acknowledge", resume_by_referee: "resume_by_referee", terms: "terms" },
      max_steps: 1200, replay_max_steps: 64, start_grace_seconds: 120, answer_margin_seconds: 120,
      world: state.world, namespace: "surround", from_block: state.transactions.deploy_ratings?.block_number,
    }],
    max_open_per_player: 64, max_wait_seconds: 30, cors_origin: "*",
  }, null, 2));
  const keeper = spawn("node", [resolve(ARBITER, "keeper/server.mjs"), keeperConfig], {
    env: { ...process.env, KEEPER_PRIVATE_KEY: stored.private_key, KEEPER_REFEREE_KEY: p.hex(keys.keeper),
      SURROUND_TICKETS_FROM_BLOCK: String(state.transactions.deploy_ratings?.block_number ?? 0) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  keeper.stdout.on("data", (d) => process.stdout.write(`[keeper] ${d}`));
  keeper.stderr.on("data", (d) => process.stdout.write(`[keeper] ${d}`));
  stopAll.push(() => keeper.kill());
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${keeperUrl}/info`)).ok) break; } catch {}
    assert(i < 60, "The keeper did not start");
    await pause(500);
  }

  // The matchmaker, in process: the anchors, the keeper, a 60 s turn clock.
  const clock = p.rankedClock(p.publicKey(keys.keeper)).settings;
  const chain = starknetChain({ rpc_url: RPC, channel: BigInt(state.channel), ratings: BigInt(state.ratings),
    account: { address: stored.address, privateKey: stored.private_key } });
  const matchmaker = await Matchmaker.open({
    chain_id: p.tag("SN_SEPOLIA"), channel: BigInt(state.channel), prover: BigInt(state.prover),
    matchmakerKey: keys.matchmaker, keepers: [{ url: keeperUrl, referee: p.hex(p.publicKey(keys.keeper)) }],
    clocks: { turn: clock }, boards: { 9: 14, 13: 15, 19: 15 }, response_seconds: 300,
    from_block: await block(), anchors: Object.values(state.anchors).map((a: any) => a.address),
  }, chain, { log: (m: string) => log(`[matchmaker] ${m}`), store: memoryStore({}) });
  const mm = await serve(matchmaker, { poll_ms: 5000, log: (m: string) => log(`[matchmaker] ${m}`) });
  stopAll.push(() => mm.close());
  mmUrl = mm.url;

  // The anchor daemon, in process, KataGo behind it.
  const daemon = new AnchorDaemon(
    Object.entries(state.anchors).map(([id, a]: [string, any]) => ({ id, rank: a.rank,
      wallet: new Account({ provider, address: a.address, signer: p.hex(keys[`anchor_${id}`]) }) })),
    { matchmaker: mm.url, chainId: p.tag("SN_SEPOLIA"), engine, store: new c.SessionStore(c.memoryBackend()), keys: 2,
      log: (m: string) => log(`[anchors] ${m}`) },
  );
  let ticking = false;
  const timer = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try { await daemon.tick(); } finally { ticking = false; }
  }, 2000);
  stopAll.push(() => clearInterval(timer));
  await daemon.tick();
}

// The newcomer asks for the anchor, signed by its wallet, starting at 23k.
const ratingsBefore = await c.getPlayerRating(provider, state.ratings, state.newcomer);
const sessionKey = newSessionKey();
const request = async (action: string, fields: any) => {
  const body = { player: state.newcomer, at: Math.floor(Date.now() / 1000), nonce: p.hex(newSessionKey()), ...fields };
  const typed = c.matchmakerRequest({ chainId: p.tag("SN_SEPOLIA"), action, ...body, opponent: body.anchor ?? 0 });
  return { ...body, signature: walletSignature(await newcomer.signMessage(typed)) };
};
const call = async (path: string, body: any) => {
  const r = await fetch(`${mmUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await r.json();
  assert(r.ok, `${path}: ${json.error}`);
  return json;
};
let status = await call("/ai", await request("ai", { key: p.hex(p.publicKey(sessionKey)), size: SIZE, clock: "turn",
  band: ratingsBefore.games ? 0 : 1, anchor: anchor.address }));
log(`paired with ${which} as ${status.color}, game ${status.game_id}`);
const terms = p.goTerms({ ...status.terms, ...status.terms.config });
const ticket = c.reviveTicket(status.ticket);
assert.equal(p.contextHash(p.go, terms), p.contextHash(p.go, c.ratedTerms(ticket, terms.keys)));
const seat = status.color === "black" ? 0 : 1;
assert.equal(terms.keys[seat], p.publicKey(sessionKey));
status = await call(`/games/${status.digest}/sign`, { player: state.newcomer,
  signature: walletSignature(await newcomer.signMessage(c.goTermsTypedData(terms))) });
for (let i = 0; !status.ready; i++) {
  assert(i < 60, "The game never reached its keeper");
  await pause(1000);
  status = (await (await fetch(`${mmUrl}/queue/${state.newcomer}`)).json());
}
log("both wallets signed; the keeper holds the game");
state.records ??= {};
const record: any = state.records[`anchor_${which}`] = { anchor: which, anchor_address: anchor.address, newcomer: state.newcomer,
  game_id: status.game_id, ticket_digest: status.digest, color: status.color, before: { games: ratingsBefore.games } };
await save();

// Play: the newcomer is KataGo at 20k too, and resigns once the game is long
// enough to rate.
const store = new c.SessionStore(c.memoryBackend());
await store.saveKey(sessionKey);
const session = await store.open(p.go, terms);
const client = new c.KeeperClient(keeperUrl);
await client.pull(session, { store });
while (!session.env.outcome.finished) {
  if (session.due() !== seat) { await client.pull(session, { wait: 20, store }); continue; }
  const step = session.env.seq >= RESIGN_AT ? p.resignStep(seat) : await (async () => {
    const position = positionOf(session);
    const point = await engine.move(position, terms.config.komi_half / 2, "20k");
    if (point !== null) play(position, point);
    return point === null ? p.goStep(p.PASS) : p.goStep(p.PLAY, point);
  })();
  await store.move(session, step, sessionKey);
  await client.submit(session, { store });
}
record.steps = session.env.seq;
record.outcome = session.env.outcome;
await save();
log(`game over after ${session.env.seq} steps: winner ${session.env.outcome.winner}, reason ${session.env.outcome.reason}`);

// The keeper opens it on its ticket, settles it after the response window and
// rates it (its afterSettle hook); the matchmaker rates it too if not.
const [ticketStatus] = [async () => (await provider.callContract(c.channelCall(state.ratings, "ticket_status", [status.digest]))).map(BigInt)];
for (let i = 0; ; i++) {
  const [s] = await ticketStatus();
  if (s === 2n || s === 3n) { record.ticket_status = Number(s); break; }
  assert(i < 240, "The game was not rated within 20 minutes");
  if (i % 12 === 0) log(`waiting for the keeper to settle and rate (ticket status ${s})`);
  await pause(5000);
}
assert.equal(record.ticket_status, 2, "The game was voided");
const after = await c.getPlayerRating(provider, state.ratings, state.newcomer);
const pinned = await c.getPlayerRating(provider, state.ratings, anchor.address);
assert.equal(after.games, ratingsBefore.games + 1);
assert.ok(pinned.anchor && pinned.games === 0 && pinned.mu === BigInt(anchor.mu_q32), "The anchor moved");
// The update is the SDK's: the newcomer against the anchor's pin, dated by the first stamp.
const events = await fetchRatingEvents(provider, state.ratings, state.transactions.deploy_ratings.block_number);
const replay = verifyRatings(events);
assert.ok(replay.ok, JSON.stringify(replay.errors));
const mine = events.filter((e: any) => e.type === "RatingUpdated" && p.hex(e.digest) === p.hex(BigInt(status.digest)));
assert.deepEqual(mine.map((e: any) => e.anchor), seat === 0 ? [false, true] : [true, false]);
record.after = { mu_q32: String(after.mu), phi_q32: String(after.phi), rank: rating.rankLabel(after.rank_tenths),
  provisional: after.provisional, games: after.games, wins: after.wins, losses: after.losses };
record.anchor_after = { mu_q32: String(pinned.mu), rank: rating.rankLabel(pinned.rank_tenths), games: pinned.games };
record.replay = { ok: replay.ok, games: replay.games };
await save();
log(`rated: newcomer ${record.after.rank}${after.provisional ? "?" : ""} after ${after.games} game(s); ${which} still ${record.anchor_after.rank}, pinned`);
process.exit(0);
