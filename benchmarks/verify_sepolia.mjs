// Read-only cross-check through a second RPC; no signing keys are loaded.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(process.env.PRIVACY_DIR ?? resolve(here, '../../starknet-privacy'), 'sdk/package.json'));
const { RpcProvider } = require('starknet');
const url = 'https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10';
const provider = new RpcProvider({ nodeUrl: url });
const state = JSON.parse(await readFile(resolve(here, 'results/sepolia.json'), 'utf8'));
if (BigInt(await provider.getChainId()) !== 0x534e5f5345504f4c4941n) throw Error('Wrong chain');
if (BigInt(await provider.getClassHashAt(state.contract_address)) !== BigInt(state.class_hash)) throw Error('Wrong deployed class');
if (!state.completed_at || Object.keys(state.records).length !== 6) throw Error('Native run incomplete');
const checks = [];
for (const [name, record] of Object.entries(state.records)) {
  const txHash = record.settlement.transaction_hash;
  const [receipt, output, response] = await Promise.all([
    provider.getTransactionReceipt(txHash),
    provider.callContract({ contractAddress: state.contract_address, entrypoint: 'result',
      calldata: [record.id, 1] }, record.settlement.block_number),
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'starknet_getTransactionByHash',
        params: { transaction_hash: txHash, response_flags: ['INCLUDE_PROOF_FACTS'] } }),
      signal: AbortSignal.timeout(30_000) }).then(r => r.json()),
  ]);
  if (receipt.execution_status !== 'SUCCEEDED' || receipt.block_number !== record.settlement.block_number) throw Error('Receipt mismatch');
  if (output.map(BigInt).join() !== record.verified_output.map(BigInt).join()) throw Error('Score mismatch');
  const facts = response.result?.proof_facts;
  if (!facts || facts.map(BigInt).join() !== record.proof.proof_facts.map(BigInt).join()) throw Error('Onchain proof facts mismatch');
  checks.push({ fixture: name, transaction_hash: txHash, block_number: receipt.block_number,
    finality_status: receipt.finality_status, score_verified: true, proof_facts_verified: true });
  console.log(`${name}: receipt, score and native facts independently verified`);
}
await writeFile(resolve(here, 'results/sepolia-verification.json'), JSON.stringify({
  verified_at: new Date().toISOString(), rpc_url: url, class_hash_verified: true,
  contract_address: state.contract_address, checks,
}, null, 2) + '\n');
