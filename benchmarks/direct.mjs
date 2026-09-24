// Uses the user's existing privacy SDK installation; no wallet secrets or
// configuration files from that project are read. Only fresh local devnet keys.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const directory = dirname(fileURLToPath(import.meta.url));
const privacy = resolve(process.env.PRIVACY_DIR ?? resolve(directory, '../../starknet-privacy'));
const require = createRequire(resolve(privacy, 'sdk/package.json'));
const { Account, RpcProvider, hash } = require('starknet');
const url = process.env.SURROUND_DEVNET_URL ?? 'http://127.0.0.1:6060/rpc';
const parsed = new URL(url);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
  throw new Error('This benchmark only submits to a local devnet');
}
const rpc = async (method, params = {}) => {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
};
const node = new RpcProvider({ nodeUrl: url, transactionRetryIntervalFallback: 50 });
const [local] = await rpc('devnet_getPredeployedAccounts');
const account = new Account({ provider: node, address: local.address, signer: local.private_key });
const bounds = Object.fromEntries(['l1_gas', 'l2_gas', 'l1_data_gas'].map(k => [k, {
  max_amount: 10_000_000_000n, max_price_per_unit: 1n,
}]));
const details = { resourceBounds: bounds, tip: 0n };
const artifacts = resolve(directory, 'settlement/target/dev');
const contract = JSON.parse(await readFile(resolve(artifacts,
  'surround_settlement_bench_ScoringBench.contract_class.json'), 'utf8'));
const casm = JSON.parse(await readFile(resolve(artifacts,
  'surround_settlement_bench_ScoringBench.compiled_contract_class.json'), 'utf8'));
const declared = await account.declare({ contract, casm }, details);
await node.waitForTransaction(declared.transaction_hash);
const deployed = await account.deployContract({ classHash: declared.class_hash }, details);
await node.waitForTransaction(deployed.transaction_hash);
const address = deployed.contract_address;
const fixtures = JSON.parse(await readFile(resolve(directory, 'fixtures.json'), 'utf8'));
const records = [];
for (const [index, fixture] of fixtures.entries()) {
  const start = performance.now();
  const tx = await account.execute({
    contractAddress: address, entrypoint: 'direct',
    calldata: [index + 1, ...fixture.arguments],
  }, details);
  const receipt = await node.waitForTransaction(tx.transaction_hash);
  const elapsed = (performance.now() - start) / 1000;
  if (receipt.execution_status !== 'SUCCEEDED') throw new Error('Direct scoring reverted');
  const output = await node.callContract({
    contractAddress: address, entrypoint: 'result', calldata: [index + 1],
  });
  const [statement, blackHalf, whiteHalf] = output.map(BigInt);
  if (Number(blackHalf - whiteHalf) !== fixture.margin_half) throw new Error('Recorded result mismatch');
  records.push({ id: fixture.id, output: [statement, blackHalf, whiteHalf].map(String),
    wall_seconds: elapsed, transaction_hash: tx.transaction_hash,
    execution_resources: receipt.execution_resources, actual_fee: receipt.actual_fee });
  console.log(`${fixture.id}: ${fixture.result}; ${JSON.stringify(receipt.execution_resources)}`);
}
const block = await rpc('starknet_getBlockWithTxHashes', { block_id: 'latest' });
const result = { measured_at: new Date().toISOString(), network: 'local devnet',
  starknet_version: block.starknet_version, rpc_version: await rpc('starknet_specVersion'),
  chain_id: await rpc('starknet_chainId'), scorer_class_hash: declared.class_hash,
  compiled_class_hash: hash.computeCompiledClassHash(casm), records };
await mkdir(resolve(directory, 'results'), { recursive: true });
await writeFile(resolve(directory, 'results/direct.json'), JSON.stringify(result, null, 2) + '\n');
