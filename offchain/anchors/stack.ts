// Run the v7 Sepolia lobby stack locally, for testing: arbiter's keeper
// (referee, opens, settles and rates games), the matchmaker and the AI anchor
// daemon, until stopped.
//
//   node --experimental-strip-types --env-file=apps/web/.env.local offchain/anchors/stack.ts
//
// Keys come from the v7 deployment's test keys (results/raw/sepolia-arbiter-v7/
// keys.json: matchmaker, keeper referee, anchors) and the funded signer
// (~/.starknet_accounts, as for sepolia.mjs), which pays for the keeper's and
// the matchmaker's transactions. State lives in results/raw/sepolia-arbiter-v7.
// Play an anchor against it with `SURROUND_STACK=1 node … offchain/anchors/sepolia.ts ANCHOR`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, RpcProvider } from "../sdk/node_modules/starknet/dist/index.mjs";
import { fileBackend } from "../sdk/node_modules/@arbiter/sdk/sdk/src/store-file.mjs";
import * as p from "../sdk/src/index.mjs";
import * as c from "../sdk/src/client.mjs";
import { starknetChain } from "../matchmaker/chain.mjs";
import { Matchmaker } from "../matchmaker/matchmaker.mjs";
import { serve } from "../matchmaker/server.mjs";
import { fileStore } from "../matchmaker/store.mjs";
import { KataGo } from "../lobby/engine.ts";
import { AnchorDaemon } from "./anchor.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RPC = process.env.SURROUND_SEPOLIA_RPC ?? "http://127.0.0.1:9545/rpc/v0_9";
const KEEPER_RPC = process.env.SURROUND_KEEPER_RPC ?? "http://127.0.0.1:9545/rpc/v0_10";
const ARBITER = resolve(process.env.SURROUND_ARBITER ?? resolve(homedir(), "development/referee"));
const KEEPER_PORT = 3200, MATCHMAKER_PORT = 3300;
const raw = resolve(root, "offchain/results/raw/sepolia-arbiter-v7");
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

const state = JSON.parse(await readFile(resolve(root, "offchain/results/sepolia-arbiter-v7.json"), "utf8"));
const keys = Object.fromEntries(
  Object.entries(JSON.parse(await readFile(resolve(raw, "keys.json"), "utf8"))).map(([n, v]) => [n, BigInt(v as string)]),
);
const accounts = JSON.parse(await readFile(resolve(homedir(), ".starknet_accounts/starknet_open_zeppelin_accounts.json"), "utf8"));
const stored = accounts["alpha-sepolia"][process.env.SURROUND_SEPOLIA_ACCOUNT ?? "account-1"];
const provider = new RpcProvider({ nodeUrl: RPC });
const fromBlock = state.transactions.deploy_ratings.block_number;

// The keeper.
const keeperConfig = resolve(raw, "keeper-local.json");
const keeperFile = JSON.parse(await readFile(resolve(root, "offchain/anchors/keeper.sepolia.json"), "utf8"));
await writeFile(keeperConfig, JSON.stringify({
  ...keeperFile, port: KEEPER_PORT, rpc_url: KEEPER_RPC, store: resolve(raw, "keeper-data"),
  account: { ...keeperFile.account, address: stored.address },
  games: keeperFile.games.map((g: any) => ({ ...g, module: resolve(root, "offchain/matchmaker/keeper-hooks.mjs") })),
}, null, 2));
const keeper = spawn("node", [resolve(ARBITER, "keeper/server.mjs"), keeperConfig], {
  env: { ...process.env, KEEPER_PRIVATE_KEY: stored.private_key, KEEPER_REFEREE_KEY: p.hex(keys.keeper),
    SURROUND_TICKETS_FROM_BLOCK: String(fromBlock) },
  stdio: ["ignore", "pipe", "pipe"],
});
// The keeper logs every request as JSON; show what it does, not each poll.
const keeperLog = (d: Buffer) => {
  for (const line of String(d).split("\n").filter(Boolean))
    if (!/"method":"GET"/.test(line)) log(`[keeper] ${line}`);
};
keeper.stdout.on("data", keeperLog);
keeper.stderr.on("data", keeperLog);
const keeperUrl = `http://127.0.0.1:${KEEPER_PORT}`;
for (let i = 0; ; i++) {
  try { if ((await fetch(`${keeperUrl}/info`)).ok) break; } catch {}
  assert(i < 60, "The keeper did not start");
  await new Promise((r) => setTimeout(r, 500));
}

// The matchmaker. A new store holds `{}`: this test key's earlier games are
// all settled, so pairing starts at once.
const storeFile = resolve(raw, "matchmaker-state.json");
await access(storeFile).catch(() => writeFile(storeFile, "{}"));
const example = JSON.parse(await readFile(resolve(root, "offchain/matchmaker/config.example.json"), "utf8"));
const chain = starknetChain({ rpc_url: RPC, channel: BigInt(state.channel), ratings: BigInt(state.ratings),
  account: { address: stored.address, privateKey: stored.private_key } });
const matchmaker = await Matchmaker.open({
  ...example, chain_id: p.tag("SN_SEPOLIA"), channel: BigInt(state.channel), prover: BigInt(state.prover),
  ratings: BigInt(state.ratings), matchmakerKey: keys.matchmaker,
  keepers: [{ url: keeperUrl, referee: p.hex(p.publicKey(keys.keeper)) }],
  clocks: { turn: p.rankedClock(p.publicKey(keys.keeper)).settings }, response_seconds: 300,
  max_fee_fri: BigInt(example.max_fee_fri), from_block: fromBlock,
  anchors: Object.values(state.anchors).map((a: any) => a.address),
}, chain, { log: (m: string) => log(`[matchmaker] ${m}`), store: fileStore(storeFile) });
const mm = await serve(matchmaker, { port: MATCHMAKER_PORT, poll_ms: 5000, log: (m: string) => log(`[matchmaker] ${m}`) });

// The anchors.
const engine = new KataGo(process.env);
await engine.ready();
assert(engine.status().human, "Set KATAGO_HUMAN_MODEL (e.g. --env-file=apps/web/.env.local)");
const daemon = new AnchorDaemon(
  Object.entries(state.anchors).map(([id, a]: [string, any]) => ({ id, rank: a.rank,
    wallet: new Account({ provider, address: a.address, signer: p.hex(keys[`anchor_${id}`]) }) })),
  { matchmaker: mm.url, chainId: p.tag("SN_SEPOLIA"), engine,
    store: new c.SessionStore(await fileBackend(resolve(raw, "anchors-store"))), log: (m: string) => log(`[anchors] ${m}`) },
);
let ticking = false;
const timer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try { await daemon.tick(); } finally { ticking = false; }
}, 2000);

const stop = async () => {
  clearInterval(timer);
  keeper.kill();
  engine.close();
  await mm.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
log(`keeper ${keeperUrl}, matchmaker ${mm.url}, anchors ${Object.keys(state.anchors).join(", ")} on Sepolia v7 (channel ${state.channel})`);
