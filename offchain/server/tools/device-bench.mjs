// Proves a Surround game's settlement the way a wallet proves on the device: Outis's prover
// (outis-wallet/prover's wasm build, in Node, one thread) runs the adapter's virtual transaction
// live against a node and proves it in this process, as a wallet's page does. Nothing is
// broadcast: each game is a fresh one no channel has opened, played from a fixture with
// throwaway session keys, and proved from its terms at epoch 0 (as `proveSession` would).
//
// OUTIS_PROVER=~/development/outis-wallet/prover-v031 \
//   node offchain/server/tools/device-bench.mjs --out DIR [--rpc URL] [--steps N] FIXTURE [FIXTURE ...]
//
// For each fixture it writes DIR/FIXTURE/, a capture in outis-wallet/prover's format: the RPC
// answers the prover read (with its reads as one simulation's `initial_reads`), the prove request,
// and the wasm build's proof as the reference. `os_native_probe replay DIR/FIXTURE` proves it again
// natively and says whether the proof is identical. report.json and one JSON line per fixture on
// stdout carry the timings, the OS steps, the wasm memory and the proof's facts.
//
// The device's prover makes PROOF2 against the 0.14.4 virtual OS program below, which Sepolia's
// v8 adapter doesn't pin (it pins PROOF1's), so these proofs could not settle there: the facts are
// checked against PROOF2's program instead, and the adapter's own is reported beside them.
//
//   node offchain/server/tools/device-bench.mjs --against URL --out DIR FIXTURE [FIXTURE ...]
//
// sends each capture's own request (its transaction, at its block) to a starknet_proveTransaction
// prover instead, a server's, and says whether its proof and facts are the device's, byte for byte.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { RpcProvider } from '../../sdk/node_modules/starknet/dist/index.mjs';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import { snapshotIfOpen, contractCall, nativeProofBlock } from '../../sdk/node_modules/@arbiter/sdk/sdk/src/proving.mjs';

const PROOF2_OS_PROGRAM = 0x1c7be3225dfb33359b3ba9ffbe1542b7da27879b6d89f47b967e512463fd324n;
const { values: a, positionals: names } = parseArgs({ allowPositionals: true, options: {
  rpc: { type: 'string', default: 'http://127.0.0.1:9545/rpc/v0_10' },
  deployment: { type: 'string', default: 'results/sepolia-arbiter-v8.json' },
  steps: { type: 'string' }, out: { type: 'string' }, against: { type: 'string' },
} });
if (!a.out || !names.length || !(a.against || process.env.OUTIS_PROVER)) {
  console.error('usage: OUTIS_PROVER=DIR device-bench.mjs --out DIR [--rpc URL] [--steps N] FIXTURE [FIXTURE ...]\n'
    + '       device-bench.mjs --against URL --out DIR FIXTURE [FIXTURE ...]');
  process.exit(2);
}
const seconds = since => Math.round((performance.now() - since)) / 1000;
if (a.against) {
  for (const name of names) console.log(JSON.stringify(await against(a.against, join(a.out, name), name)));
  process.exit(0);
}
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const prover = resolve(process.env.OUTIS_PROVER);
const { buildOsInput, liveRpc } = await import(pathToFileURL(join(prover, 'js/tx-driver.mjs')).href);
const probe = createRequire(import.meta.url)(join(prover, 'js/node/os_wasm_probe.js'));
const deployment = JSON.parse(await readFile(resolve(root, a.deployment), 'utf8'));
const provider = new RpcProvider({ nodeUrl: a.rpc });
const chainId = await provider.getChainId();
const chainName = Buffer.from(BigInt(chainId).toString(16), 'hex').toString();
// A private key, or an address, nobody else has: 248 random bits.
const fresh = () => BigInt(`0x${randomBytes(31).toString('hex')}`);
const log = (...parts) => console.error(new Date().toISOString().slice(11, 19), ...parts);

for (const name of names) {
  const fixture = JSON.parse(await readFile(resolve(root, `fixtures/${name}.json`), 'utf8'));
  const { size, komi_half } = fixture.terms.config;
  const privateKeys = [fresh(), fresh()];
  const terms = p.goTerms({ chain_id: chainId, channel: deployment.channel, prover: deployment.prover,
    players: [fresh(), fresh()], keys: privateKeys.map(p.publicKey), size, komi_half });
  const session = p.goSession(terms);
  const limit = a.steps ? Number(a.steps) : fixture.steps.length;
  for (const { step } of fixture.steps.slice(0, limit)) {
    const { kind, point, dead } = step.action;
    session.move(p.goStep(kind, point, dead), privateKeys[session.due()]);
  }
  // As the adapter's replay would accept it, every signature checked.
  const end = p.replay(p.go, terms, session.start, session.startWitness, session.steps).env;
  const startHash = p.stateHash(p.go, session.start), endHash = p.stateHash(p.go, end);
  if (endHash !== session.stateHash()) throw Error(`${name}: the replay ends elsewhere than the session`);

  const head = await provider.getBlockNumber();
  const block = await provider.getBlockWithTxHashes(nativeProofBlock(head, 0));
  if (await snapshotIfOpen(provider, p.go, terms.channel, terms.game_id, block.block_hash) !== null)
    throw Error(`${name}: a channel has this game open`);
  const classHash = await provider.getClassHashAt(p.hex(terms.prover), block.block_hash);
  if (BigInt(classHash) !== BigInt(deployment.class_hash)) throw Error(`${name}: ${p.hex(terms.prover)} is not the adapter`);
  const adapterProgram = BigInt((await provider.callContract(contractCall(terms.prover, 'os_program'), block.block_hash))[0]);
  const nonce = await provider.getNonceForAddress(p.hex(terms.prover), block.block_hash);
  const transaction = c.provingTransaction({ session, epoch: 0, nonce, opening: true });

  // Every answer the prover reads, for the capture.
  const calls = [];
  const rpc = liveRpc(a.rpc, (method, params, body) => calls.push({ method, params, result: body.result }));
  const row = { name, steps: session.steps.length, size, base_block: block.block_number, calldata: transaction.calldata.length };
  log(`${name}: ${row.steps} steps, ${row.calldata} calldata felts, block ${block.block_number}`);
  const started = performance.now();
  let response;
  try {
    const { session: tx, rounds } = await buildOsInput({ TxSession: probe.TxSession, rpc, chainId: chainName, transaction,
      blockNumber: block.block_number, log: message => log(`${name}: ${message}`) });
    Object.assign(row, { rounds, input_s: seconds(started) });
    let phase = performance.now();
    row.pie = tx.run_os();
    row.os_s = seconds(phase);
    row.os_steps = Number(/n_steps=(\d+)/.exec(row.pie)?.[1] ?? NaN);
    log(`${name}: ${row.pie}`);
    log(`${name}: memory after the OS run: ${probe.memory_report()}`);
    phase = performance.now();
    response = JSON.parse(tx.prove());
    row.prove_s = seconds(phase);
    phase = performance.now();
    try { probe.verify_prove_result(JSON.stringify(response)); row.verified = true; } catch (e) { row.verified = false; row.verify_error = String(e); }
    row.verify_s = seconds(phase);
    tx.free();
  } catch (error) {
    row.error = String(error?.message ?? error);
  }
  row.total_s = seconds(started);
  row.memory = probe.memory_report();
  if (response) {
    const facts = response.proof_facts.map(BigInt);
    Object.assign(row, {
      proof_bytes: Buffer.from(response.proof, 'base64').length,
      proof_version: Buffer.from(facts[0].toString(16), 'hex').toString(),
      os_program: p.hex(facts[2]),
      adapter_os_program: p.hex(adapterProgram),
      settles_on_adapter: facts[2] === adapterProgram,
    });
    try {
      c.validateNativeProof(response, { classHash, terms, epoch: 0, startHash, endHash, block, osProgram: PROOF2_OS_PROGRAM });
      row.transition = 'matches';
    } catch (e) { row.transition = e.message; }
  }
  await writeCapture(join(a.out, name), { calls, transaction, block, response, row });
  console.log(JSON.stringify(row));
}

// A prove result's L2→L1 messages as numbers, whatever order its JSON keys came in.
function messages(result) {
  return (result.l2_to_l1_messages ?? []).map(m => [BigInt(m.from_address), BigInt(m.to_address), ...m.payload.map(BigInt)]);
}

// Proves a capture's request with the prover at `url` and compares the answer with the capture's
// reference, the device's proof.
async function against(url, dir, name) {
  const files = await readdir(dir);
  const read = async prefix => JSON.parse(await readFile(join(dir, files.find(f => f.startsWith(prefix))), 'utf8'));
  const [request, reference] = [await read('request-'), (await read('response-')).result];
  const started = performance.now();
  const row = { name, prover: url, block: request.params.block_id.block_number };
  try {
    const result = await c.rpc(url, 'starknet_proveTransaction', request.params, 900000);
    const facts = result.proof_facts.map(BigInt);
    Object.assign(row, {
      seconds: seconds(started), proof_bytes: Buffer.from(result.proof, 'base64').length,
      proof_version: Buffer.from(facts[0].toString(16), 'hex').toString(), os_program: p.hex(facts[2]),
      same_proof: result.proof === reference.proof,
      same_facts: p.json(facts) === p.json(reference.proof_facts.map(BigInt)),
      same_messages: p.json(messages(result)) === p.json(messages(reference)),
    });
  } catch (error) {
    Object.assign(row, { seconds: seconds(started), error: error.rpcError?.message ?? error.message });
  }
  return row;
}

// A capture as outis-wallet/prover's rpc-record-proxy.py writes one, for `os_native_probe replay`:
// the native replay takes the prover's reads from a simulation's `initial_reads`, so every read the
// wasm run fetched goes there, and the wasm proof is the reference it compares with.
async function writeCapture(dir, { calls, transaction, block, response, row }) {
  await mkdir(dir, { recursive: true });
  const reads = { storage: new Map(), nonces: new Map(), class_hashes: new Map() };
  const classes = new Map();
  const log = [];
  const entry = (method, params, result) => log.push(JSON.stringify({
    request: { id: log.length, jsonrpc: '2.0', method, params }, response: { id: log.length, jsonrpc: '2.0', result } }));
  for (const { method, params, result } of calls) {
    if (method === 'starknet_getStorageAt')
      reads.storage.set(`${BigInt(params.contract_address)}:${BigInt(params.key)}`, { contract_address: params.contract_address, key: params.key, value: result });
    else if (method === 'starknet_getNonce') reads.nonces.set(BigInt(params.contract_address), { contract_address: params.contract_address, nonce: result });
    else if (method === 'starknet_getClassHashAt')
      reads.class_hashes.set(BigInt(params.contract_address), { contract_address: params.contract_address, class_hash: result });
    else if (method === 'starknet_getCompiledCasm') classes.set(BigInt(params.class_hash), { class_hash: params.class_hash, casm: result });
  }
  const header = calls.find(call => call.method === 'starknet_getBlockWithTxHashes');
  entry(header.method, header.params, header.result);
  entry('starknet_simulateTransactions', { block_id: { block_number: block.block_number }, transactions: [transaction] }, {
    initial_reads: {
      storage: [...reads.storage.values()], nonces: [...reads.nonces.values()], class_hashes: [...reads.class_hashes.values()],
      declared_contracts: [...classes.values()].map(({ class_hash }) => ({ class_hash, is_declared: true })),
    },
    simulated_transactions: [],
  });
  for (const call of calls) {
    if (call.method === 'starknet_getClass')
      entry(call.method, call.params, { ...call.result, sierra_program: call.result.sierra_program.slice(0, 3) });
    else if (call.method === 'starknet_getStorageAt' || call.method === 'starknet_getStorageProof') entry(call.method, call.params, call.result);
  }
  await writeFile(join(dir, 'rpc-log.jsonl'), `${log.join('\n')}\n`);
  for (const { class_hash, casm } of classes.values()) await writeFile(join(dir, `casm-${class_hash}.json`), JSON.stringify({ result: casm }));
  const stamp = Date.now();
  await writeFile(join(dir, `request-${stamp}.json`), JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'starknet_proveTransaction',
    params: { block_id: { block_number: block.block_number }, transaction } }));
  // Without the wasm build's proof (it ran out of memory, say) the native replay still proves the
  // capture, against an empty reference: it then says DIFFERENT, which means only that there was none.
  await writeFile(join(dir, `response-${stamp}.json`), JSON.stringify({ jsonrpc: '2.0', id: 1,
    result: response ?? { proof: '', proof_facts: [], l2_to_l1_messages: [] } }));
  row.capture = {
    storage: reads.storage.size, nonces: reads.nonces.size, class_hashes: reads.class_hashes.size, classes: classes.size,
    unaddressed_classes: [...classes.keys()].filter(hash => ![...reads.class_hashes.values()].some(r => BigInt(r.class_hash) === hash)).length,
    storage_proofs: calls.filter(call => call.method === 'starknet_getStorageProof').length,
  };
  await writeFile(join(dir, 'report.json'), JSON.stringify(row, null, 2));
}
