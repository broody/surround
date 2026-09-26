// Re-prove recorded Sepolia settlements with any starknet_proveTransaction
// prover (hosted, or referee's self-hosted gateway) at the base block the
// recorded proof used, and compare with the recorded proof. Nothing is
// submitted; no wallet is needed.
//
// node offchain/server/tools/prove-bench.mjs PROVER_URL NAME [NAME ...]
//   NAME is a record in results/sepolia-referee-v2.json with a single proof.
//   SURROUND_SEPOLIA_RPC selects the RPC node (default publicnode).
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { RpcProvider } from '../../sdk/node_modules/starknet/dist/index.mjs';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';

const [proverUrl, ...names] = process.argv.slice(2);
if (!proverUrl || !names.length) { console.error('usage: prove-bench.mjs PROVER_URL NAME [NAME ...]'); process.exit(2); }
const RPC = process.env.SURROUND_SEPOLIA_RPC ?? 'https://starknet-sepolia-rpc.publicnode.com';
const provider = new RpcProvider({ nodeUrl: RPC });
const root = new URL('../../', import.meta.url);
const state = JSON.parse(await readFile(new URL('results/sepolia-referee-v2.json', root), 'utf8'));
const version = await c.rpc(proverUrl, 'starknet_specVersion', []);
const rows = [];
for (const name of names) {
  const record = state.records[name];
  if (!record?.proof) throw Error(`${name}: no single-proof record`);
  const session = p.importSession(JSON.parse(await readFile(new URL(`results/raw/sepolia/${name}-session.json`, root), 'utf8')));
  const block = await provider.getBlockWithTxHashes(record.proof.base_block);
  const nonce = await provider.getNonceForAddress(p.hex(session.terms.prover), block.block_hash);
  const transaction = c.provingTransaction({ session, epoch: 0, nonce });
  const started = Date.now();
  let response, error;
  try {
    response = await c.rpc(proverUrl, 'starknet_proveTransaction', { block_id: { block_hash: block.block_hash }, transaction }, 900000);
  } catch (e) { error = e.rpcError?.message ?? e.message; }
  const seconds = (Date.now() - started) / 1000;
  const row = { name, steps: session.steps.length, seconds, base_block: record.proof.base_block };
  if (error) Object.assign(row, { error });
  else Object.assign(row, {
    facts_match: p.json(response.proof_facts.map(BigInt)) === p.json(record.proof.facts.map(BigInt)),
    proof_bytes: Buffer.from(response.proof, 'base64').length,
    same_proof: createHash('sha256').update(response.proof).digest('hex') === record.proof.proof_base64_sha256,
    recorded_seconds: record.proof.wall_seconds, recorded_prover: record.proof.prover_url ?? state.prover_url,
  });
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.log(JSON.stringify({ prover: proverUrl, version, rpc: RPC, rows: rows.length }));
