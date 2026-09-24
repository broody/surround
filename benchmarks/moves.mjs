// Replay the SGF corpus against the actual Dojo actions contract on a local node.
// Usage: node benchmarks/moves.mjs <loopback-rpc> <account-log> <fixture-json>
// Use disposable local accounts, with fees and account validation enabled.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(resolve(process.env.PRIVACY_DIR ?? resolve(root, '../starknet-privacy'), 'sdk/package.json'));
const { Account, RpcProvider } = require('starknet');
const [url, logPath, fixturePath] = process.argv.slice(2);
const parsed = new URL(url);
assert(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname), 'Local HTTP only');
const json = x => JSON.stringify(x, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
const rpc = async (method, params = {}) => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: json({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(60_000) });
  assert(response.ok, `HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw Object.assign(Error(`${method}: ${json(body.error)}`), { code: body.error.code });
  return body.result;
};
assert.equal(BigInt(await rpc('starknet_chainId')), 0x4b4154414e41n, 'KATANA chain only');
const block = await rpc('starknet_getBlockWithTxHashes', { block_id: 'latest' });
for (const field of ['l1_gas_price', 'l2_gas_price', 'l1_data_gas_price']) {
  assert.equal(BigInt(block[field].price_in_fri), 1n, `Use ${field} = 1 FRI locally`);
}
const log = await readFile(logPath, 'utf8');
const addresses = [...log.matchAll(/Account address\s*\|\s*(0x[0-9a-fA-F]+)/g)].map(m => m[1]);
const keys = [...log.matchAll(/Private key\s*\|\s*(0x[0-9a-fA-F]+)/g)].map(m => m[1]);
assert(addresses.length >= 2 && addresses.length === keys.length);
const rpcSpec = await rpc('starknet_specVersion');
const provider = new RpcProvider({ nodeUrl: url, specVersion: rpcSpec });
const accounts = [0, 1].map(i => new Account({ provider, address: addresses[i], signer: keys[i], cairoVersion: '1' }));
const manifest = JSON.parse(await readFile(resolve(root, 'manifest_dev.json'), 'utf8'));
const address = manifest.contracts.find(c => c.tag === 'surround-actions').address;
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'));
const digest = async file => createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
const state = { created_at: new Date().toISOString(), network: 'KATANA',
  local_node: process.env.SURROUND_BENCH_NODE ?? 'Katana 1.7.1',
  starknet_version: block.starknet_version, rpc_spec: rpcSpec, l1_da_mode: block.l1_da_mode,
  account_validation: true, fee_charging: true, local_gas_price_fri: 1,
  actions_address: address, actions_class_hash: await provider.getClassHashAt(address),
  note: 'Local gas measurements, not public-network transactions. Local fee price is artificial.',
  source_sha256: Object.fromEntries(await Promise.all(['src/rules.cairo', 'src/models.cairo', 'src/systems/actions.cairo', 'Scarb.lock'].map(async p => [p, await digest(p)]))),
  games: [] };
const save = () => writeFile(resolve(here, process.env.SURROUND_BENCH_OUTPUT ?? 'results/moves.json'), json(state));
const bounds = { l1_gas: { max_amount: 100000n, max_price_per_unit: 1n },
  l2_gas: { max_amount: 1000000000n, max_price_per_unit: 1n },
  l1_data_gas: { max_amount: 100000n, max_price_per_unit: 1n } };

async function receiptFor(transactionHash) {
  for (let attempt = 0; attempt < 600; attempt++) {
    try { return await rpc('starknet_getTransactionReceipt', { transaction_hash: transactionHash }); }
    catch (error) { if (error.code !== 29) throw error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(`Receipt timed out: ${transactionHash}`);
}

async function invoke(game, player, method, calldata, details = {}) {
  const tx = await accounts[player].execute({ contractAddress: address, entrypoint: method, calldata: calldata.map(String) },
    { tip: 0n, resourceBounds: bounds });
  const receipt = await receiptFor(tx.transaction_hash);
  assert.equal(receipt.execution_status, 'SUCCEEDED', json(receipt));
  assert(BigInt(receipt.actual_fee.amount) > 0n, 'Fee charging must be enabled');
  const row = { method, player, ...details, transaction_hash: tx.transaction_hash,
    block_number: receipt.block_number, execution_resources: receipt.execution_resources,
    actual_fee: receipt.actual_fee };
  game.transactions.push(row);
  return row;
}
const call = async (method, calldata) => (await provider.callContract({ contractAddress: address,
  entrypoint: method, calldata: calldata.map(String) }, 'latest')).map(BigInt);

for (const f of fixtures) {
  const game = { id: f.id, size: f.size, expected_result: f.result, transactions: [] };
  state.games.push(game);
  const created = await invoke(game, 0, 'create_game', [f.size, f.komi, 0, 2592000, 604800]);
  const trace = await rpc('starknet_traceTransaction', { transaction_hash: created.transaction_hash });
  const id = trace.execute_invocation.calls.find(c => BigInt(c.contract_address) === BigInt(address)).result[0];
  game.local_game_id = id;
  await invoke(game, 1, 'join_game', [id]);
  let previousCaptures = 0;
  for (const [i, point] of f.moves.entries()) {
    const method = point === 361 ? 'pass' : 'play';
    const row = await invoke(game, i % 2, method, [id, i, ...(method === 'play' ? [point] : [])], { move: i + 1, point });
    const current = await call('get_game', [id]);
    assert.equal(Number(current[8]), i + 1);
    const captures = Number(current[15] + current[16]);
    row.stones_captured = captures - previousCaptures;
    previousCaptures = captures;
    if ((i + 1) % 50 === 0) { await save(); console.log(`${f.id}: ${i + 1}/${f.moves.length} moves`); }
  }
  const final = await call('get_game', [id]);
  assert.equal(Number(final[6]), 2, 'Expected scoring phase');
  assert.equal(Number(final[15]), f.captures.b);
  assert.equal(Number(final[16]), f.captures.w);
  assert.deepEqual(await call('get_board', [id]), f.board.map(BigInt));
  for (const [revision, point] of f.representatives.entries()) {
    await invoke(game, 0, 'mark_group', [id, 1, revision, point, 1]);
  }
  await invoke(game, 0, 'accept_score', [id, 1, f.representatives.length]);
  await invoke(game, 1, 'accept_score', [id, 1, f.representatives.length], { final_settlement: true });
  const settled = await call('get_game', [id]);
  assert.equal(Number(settled[6]), 3, 'Expected finished phase');
  assert.equal(Number(settled[19] - settled[20]), f.margin);
  game.verified = { moves: f.moves.length, captures: f.captures, board: true,
    margin_half: Number(settled[19] - settled[20]), result: f.result };
  await save();
  console.log(`${f.id}: ${f.moves.length} moves, final board and published ${f.result} verified`);
}
state.completed_at = new Date().toISOString();
await save();
console.log(`Complete: ${state.games.length} recorded games`);
