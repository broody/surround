// Deploy `RankCard` (src/rank_card) on Sepolia beside v8's SurroundRatings,
// and record it in results/sepolia-arbiter-v8.json as `rank_card`, where the
// local stack and the matchmaker's config read it. A plain contract outside
// the Dojo world: it reads the ratings it is given and outlives the world.
//
//   node offchain/deploy-rank-card.mjs          declare and deploy (resumes a sent transaction)
//   node offchain/deploy-rank-card.mjs check    also mint the funded signer's card, if rated, and read it back
//
// Uses the funded signer and RPC as sepolia.mjs does (SURROUND_SEPOLIA_RPC,
// SURROUND_SEPOLIA_ACCOUNT, SURROUND_ACCOUNT_FILE), and builds with
// `sozo build --profile sepolia` first.
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Account, RpcProvider, hash } from './sdk/node_modules/starknet/dist/index.mjs';
import * as p from './sdk/src/index.mjs';
import * as c from './sdk/src/client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RPC = process.env.SURROUND_SEPOLIA_RPC ?? 'http://127.0.0.1:9545/rpc/v0_9';
const CHAIN = 0x534e5f5345504f4c4941n;
const GO = p.tag('go');
const CAP = 150n * 10n ** 18n;
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
const call = async (contract, entrypoint, calldata = []) => (await node.callContract(c.channelCall(contract, entrypoint, calldata))).map(BigInt);

async function receipt(txHash) {
  const r = await node.waitForTransaction(txHash, { retryInterval: 1500 });
  assert.equal(r.execution_status, 'SUCCEEDED', `Reverted ${txHash}: ${r.revert_reason}`);
  return { transaction_hash: txHash, block_number: r.block_number, block_hash: r.block_hash, execution_status: r.execution_status,
    finality_status: r.finality_status, actual_fee: r.actual_fee };
}
function bounds(estimate) {
  const rb = structuredClone(estimate.resourceBounds);
  for (const r of Object.values(rb)) r.max_amount = (r.max_amount * 150n + 114n) / 115n;
  const maximum = Object.values(rb).reduce((s, r) => s + BigInt(r.max_amount) * BigInt(r.max_price_per_unit), 0n);
  assert(maximum <= CAP, `Over the ${Number(CAP) / 1e18} STRK cap: ${Number(maximum) / 1e18}`);
  return rb;
}

const built = spawnSync('sozo', ['build', '--profile', 'sepolia'], { cwd: root, stdio: 'inherit',
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DOJO_'))) });
assert.equal(built.status, 0, 'sozo build failed');
const dir = resolve(root, 'target/sepolia');
const contract = JSON.parse(await readFile(resolve(dir, 'surround_RankCard.contract_class.json'), 'utf8'));
const casm = JSON.parse(await readFile(resolve(dir, 'surround_RankCard.compiled_contract_class.json'), 'utf8'));
const classHash = hash.computeContractClassHash(contract);

// Declare, unless the class is on the chain already.
let declared = true;
try { await node.getClassByHash(classHash); } catch (e) { if (e.baseError?.code !== 28) throw e; declared = false; }
if (!declared) {
  if (!state.transactions.declare_rank_card) {
    const estimate = await account.estimateDeclareFee({ contract, casm }, { tip: 0n });
    console.log(`RankCard declaration: at most ${Number(estimate.overall_fee) / 1e18} STRK`);
    const tx = await account.declare({ contract, casm }, { tip: 0n, resourceBounds: bounds(estimate) });
    state.transactions.declare_rank_card = { transaction_hash: tx.transaction_hash };
    await save();
  }
  state.transactions.declare_rank_card = await receipt(state.transactions.declare_rank_card.transaction_hash);
  await save();
}

// Deploy it, reading v8's SurroundRatings.
if (!state.rank_card) {
  const payload = { classHash, salt: '0x537572726f756e64', constructorCalldata: [state.ratings] };
  const estimate = await account.estimateDeployFee(payload, { tip: 0n, skipValidate: false });
  const tx = await account.deploy(payload, { tip: 0n, resourceBounds: bounds(estimate) });
  state.rank_card = tx.contract_address[0];
  state.transactions.deploy_rank_card = { transaction_hash: tx.transaction_hash };
  await save();
}
if (!state.transactions.deploy_rank_card.block_number) {
  state.transactions.deploy_rank_card = await receipt(state.transactions.deploy_rank_card.transaction_hash);
  await save();
}
assert.equal(BigInt(await node.getClassHashAt(state.rank_card)), BigInt(classHash));
assert.equal((await call(state.rank_card, 'ratings'))[0], BigInt(state.ratings));
console.log(`rank_card: ${state.rank_card}`);

if (process.argv[2] === 'check') {
  const signer = BigInt(stored.address);
  // Player: mu, phi, last_played, games, ...
  const [games] = (await call(state.ratings, 'player', [GO, signer])).slice(3, 4);
  assert(games > 0n, 'The signer has no rated game to show');
  let minted = true;
  try { await call(state.rank_card, 'owner_of', c.rankCardTokenId(signer)); } catch (e) { if (!c.reverted(e, 'ERC721: invalid token ID')) throw e; minted = false; }
  if (!minted) {
    const calls = [c.mintRankCardCall(state.rank_card, signer)];
    const estimate = await account.estimateInvokeFee(calls, { tip: 0n, skipValidate: false });
    const tx = await account.execute(calls, { tip: 0n, resourceBounds: bounds(estimate) });
    state.transactions.mint_rank_card_signer = await receipt(tx.transaction_hash);
    await save();
    console.log(`minted the signer's card in ${tx.transaction_hash}`);
  }
  const [owner] = await call(state.rank_card, 'owner_of', c.rankCardTokenId(signer));
  assert.equal(owner, signer);
  const uri = await node.callContract(c.channelCall(state.rank_card, 'token_uri', c.rankCardTokenId(signer)));
  // A ByteArray: full words, then the pending word and its length.
  const words = uri.map(BigInt), full = Number(words[0]);
  let text = '';
  const bytes = (w, n) => { for (let i = n - 1; i >= 0; i--) text += String.fromCharCode(Number((w >> BigInt(8 * i)) & 0xffn)); };
  for (let i = 0; i < full; i++) bytes(words[1 + i], 31);
  bytes(words[1 + full], Number(words[2 + full]));
  const meta = JSON.parse(text.slice('data:application/json,'.length));
  console.log(meta.name, JSON.stringify(meta.attributes));
  await writeFile(resolve(root, 'offchain/results/raw/sepolia-arbiter-v8/rank-card-signer.svg'), meta.image.slice('data:image/svg+xml,'.length));
}
