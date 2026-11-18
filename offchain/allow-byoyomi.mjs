// Allow Surround's byo-yomi presets (sdk `byoyomiPresets`: one per board) in
// v8's SurroundRatings on Sepolia, so rated games can name them, and record
// the transaction in results/sepolia-arbiter-v8.json as `ratings_byoyomi`.
// The 60 s `turn` preset stays allowed. Only presets not allowed yet are sent;
// it reads each back with `is_clock_preset` afterwards.
//
//   node offchain/allow-byoyomi.mjs
//
// Uses the funded signer and RPC as deploy-rank-card.mjs does
// (SURROUND_SEPOLIA_RPC, SURROUND_SEPOLIA_ACCOUNT, SURROUND_ACCOUNT_FILE).
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Account, RpcProvider } from './sdk/node_modules/starknet/dist/index.mjs';
import * as p from './sdk/src/index.mjs';
import * as c from './sdk/src/client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RPC = process.env.SURROUND_SEPOLIA_RPC ?? 'http://127.0.0.1:9545/rpc/v0_9';
const CHAIN = 0x534e5f5345504f4c4941n;
const CAP = 5n * 10n ** 18n;
const resultFile = resolve(root, 'offchain/results/sepolia-arbiter-v8.json');
const node = new RpcProvider({ nodeUrl: RPC });
assert.equal(BigInt(await node.getChainId()), CHAIN, 'Sepolia only');
const accountFile = process.env.SURROUND_ACCOUNT_FILE ?? resolve(homedir(), '.starknet_accounts/starknet_open_zeppelin_accounts.json');
const stored = JSON.parse(await readFile(accountFile, 'utf8'))['alpha-sepolia']?.[process.env.SURROUND_SEPOLIA_ACCOUNT ?? 'account-1'];
assert(stored, 'No alpha-sepolia account');
const account = new Account({ provider: node, address: stored.address, signer: stored.private_key });
const state = JSON.parse(await readFile(resultFile, 'utf8'));
assert.equal(BigInt(state.signer), BigInt(stored.address), 'Not the v8 deployment\'s signer');
const save = () => writeFile(resultFile, p.json(state));

const allowed = async settings => BigInt((await node.callContract(c.channelCall(state.ratings, 'is_clock_preset',
  [c.GO_POOL, ...p.span(p.standardTime.encodeSettings(settings))])))[0]) === 1n;
const presets = Object.entries(p.byoyomiPresets());
const missing = [];
for (const [name, settings] of presets) if (!(await allowed(settings))) missing.push([name, settings]);

if (missing.length) {
  if (!state.transactions.ratings_byoyomi) {
    const calls = missing.map(([, settings]) => c.setClockPresetCall(state.ratings, settings));
    const estimate = await account.estimateInvokeFee(calls, { tip: 0n, skipValidate: false });
    const rb = structuredClone(estimate.resourceBounds);
    for (const r of Object.values(rb)) r.max_amount = (r.max_amount * 150n + 114n) / 115n;
    const maximum = Object.values(rb).reduce((s, r) => s + BigInt(r.max_amount) * BigInt(r.max_price_per_unit), 0n);
    assert(maximum <= CAP, `Over the ${Number(CAP) / 1e18} STRK cap: ${Number(maximum) / 1e18}`);
    const tx = await account.execute(calls, { tip: 0n, resourceBounds: rb });
    state.transactions.ratings_byoyomi = { transaction_hash: tx.transaction_hash };
    await save();
  }
  const hash = state.transactions.ratings_byoyomi.transaction_hash;
  const r = await node.waitForTransaction(hash, { retryInterval: 1500 });
  assert.equal(r.execution_status, 'SUCCEEDED', `Reverted ${hash}: ${r.revert_reason}`);
  state.transactions.ratings_byoyomi = { transaction_hash: hash, block_number: r.block_number, block_hash: r.block_hash,
    execution_status: r.execution_status, finality_status: r.finality_status, actual_fee: r.actual_fee };
  await save();
  console.log(`ratings_byoyomi: ${hash}`);
}
for (const [name, settings] of presets) {
  assert(await allowed(settings), `${name} is not allowed`);
  console.log(`${name}: allowed (${c.clockHash(settings).toString(16)})`);
}
