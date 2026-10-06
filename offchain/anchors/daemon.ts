// Run Surround's AI anchors: one process plays every anchor in the config
// against whoever the matchmaker pairs with it. See README.md.
//
//   ANCHOR_YUNA_KEY=0x… … node --experimental-strip-types offchain/anchors/daemon.ts CONFIG_JSON
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Account, RpcProvider } from "../sdk/node_modules/starknet/dist/index.mjs";
import { fileBackend } from "../sdk/node_modules/@arbiter/sdk/sdk/src/store-file.mjs";
import * as p from "../sdk/src/index.mjs";
import * as c from "../sdk/src/client.mjs";
import { KataGo } from "../lobby/engine.ts";
import { AnchorDaemon } from "./anchor.ts";

const file = resolve(process.argv[2] ?? "");
const config = JSON.parse(await readFile(file, "utf8"));
const log = (message: string) =>
  console.log(`${new Date().toISOString()} ${message}`);
const provider = new RpcProvider({ nodeUrl: config.rpc_url });
const anchors = config.anchors.map((a: any) => {
  const key = process.env[a.private_key_env];
  if (!key) throw Error(`Set ${a.private_key_env}`);
  return {
    id: a.id,
    rank: a.rank,
    wallet: new Account({ provider, address: a.address, signer: key }),
  };
});
const engine = new KataGo({ ...config.katago, ...process.env });
await engine.ready();
if (!engine.status().human)
  throw Error("AI anchors need KataGo's human SL model (KATAGO_HUMAN_MODEL)");
const store = new c.SessionStore(
  await fileBackend(resolve(dirname(file), config.store ?? "anchors-store")),
);
const chainId = /^0x/i.test(config.chain_id)
  ? BigInt(config.chain_id)
  : p.tag(config.chain_id);
const daemon = new AnchorDaemon(anchors, {
  matchmaker: config.matchmaker_url.replace(/\/$/, ""),
  chainId,
  engine,
  store,
  keys: config.keys,
  max_games: config.max_games,
  log,
});
log(
  `anchors ${anchors.map((a: any) => `${a.id} (${a.rank})`).join(", ")} on ${config.matchmaker_url}`,
);
let running = false;
setInterval(
  async () => {
    if (running) return;
    running = true;
    try {
      await daemon.tick();
    } finally {
      running = false;
    }
  },
  (config.poll_seconds ?? 3) * 1000,
);
