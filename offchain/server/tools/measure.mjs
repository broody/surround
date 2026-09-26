// Sepolia measurement fixtures for self-hosted proving (see os-job.mjs). Nothing
// here is ever settled.
//
// node offchain/server/tools/measure.mjs game [fixture ...]
//   Creates and joins games on the deployed channel, left at epoch 0, so any prefix
//   of a recorded fixture can be proved against a recent base block. A TestPlayer
//   instance owned by the wallet joins as white.
// node offchain/server/tools/measure.mjs stub LABEL ARTIFACT_DIR SIZE KOMI_HALF
//   Declares (if needed) and deploys the ChannelProver built in ARTIFACT_DIR, with a
//   SnapshotStub (offchain/measure) standing in for the Dojo channel. This measures
//   adapter classes that no deployed channel pins.
//
// Wallet: SURROUND_MEASURE_ACCOUNT (default account-1) from the local alpha-sepolia
// accounts file. Session keys are the PUBLIC test keys 0x1 and 0x2. The private key
// stays in process memory. Public results go to offchain/results/measurement-games-referee.json.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Account, RpcProvider, ec, hash } from '../../sdk/node_modules/starknet/dist/index.mjs';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const RPC = process.env.SURROUND_SEPOLIA_RPC ?? 'http://127.0.0.1:9545/rpc/v0_10';
const CHAIN = 0x534e5f5345504f4c4941n;
const cap = 10n * 10n ** 18n, declarationCap = 80n * 10n ** 18n;
const keys = [0x1n, 0x2n];
// Estimates include account validation (skipValidate: false) plus a margin.
const node = new RpcProvider({ nodeUrl: RPC, resourceBoundsOverhead: Object.fromEntries(
  ['l1_gas', 'l1_data_gas', 'l2_gas'].map(k => [k, { max_amount: 50, max_price_per_unit: 15 }])) });
assert.equal(BigInt(await node.getChainId()), CHAIN, 'Sepolia only');

const deployment = JSON.parse(await readFile(resolve(root, 'offchain/results/sepolia-referee.json'), 'utf8'));
const accountFile = process.env.SURROUND_ACCOUNT_FILE ?? resolve(homedir(), '.starknet_accounts/starknet_open_zeppelin_accounts.json');
if (((await stat(accountFile)).mode & 0o077) !== 0) console.warn(`warning: ${accountFile} is readable by other users; consider chmod 600`);
const name = process.env.SURROUND_MEASURE_ACCOUNT ?? 'account-1';
const stored = JSON.parse(await readFile(accountFile, 'utf8'))['alpha-sepolia'][name];
assert(stored, `No alpha-sepolia account ${name}`);
let onchainKey;
for (const entry of ['get_public_key', 'getPublicKey', 'get_owner']) {
  try { onchainKey = BigInt((await node.callContract(c.channelCall(stored.address, entry)))[0]); break; } catch {}
}
assert.equal(onchainKey, BigInt(ec.starkCurve.getStarkKey(stored.private_key)), 'Account key mismatch');
const account = new Account({ provider: node, address: stored.address, signer: stored.private_key });

const resultFile = resolve(root, 'offchain/results/measurement-games-referee.json');
let state;
try { state = JSON.parse(await readFile(resultFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
state ??= { network: 'SN_SEPOLIA', channel: deployment.channel, prover: deployment.prover, owner: stored.address,
  note: 'Unsettled epoch-0 games for self-hosted proving measurements. Session keys 0x1 and 0x2 are public test keys.',
  transactions: {}, games: {} };
assert.equal(BigInt(state.owner), BigInt(stored.address), 'Measurement games belong to another wallet');
const save = () => writeFile(resultFile, p.json(state));

async function receipt(hash) {
  for (let i = 0; i < 200; i++) {
    let r; try { r = await node.getTransactionReceipt(hash); } catch (e) { if (e.baseError?.code !== 29) throw e; }
    if (r?.execution_status === 'REVERTED') throw Error(`Reverted ${hash}: ${r.revert_reason}`);
    if (r?.block_hash) return { transaction_hash: hash, block_number: r.block_number, actual_fee: r.actual_fee };
    await new Promise(ok => setTimeout(ok, 1500));
  }
  throw Error(`Receipt pending: ${hash}`);
}
async function execute(label, calls) {
  let r = state.transactions[label];
  if (!r) {
    const estimate = await account.estimateInvokeFee(calls, { tip: 0n, skipValidate: false });
    const rb = structuredClone(estimate.resourceBounds);
    const maximum = Object.values(rb).reduce((s, b) => s + BigInt(b.max_amount) * BigInt(b.max_price_per_unit), 0n);
    assert(maximum <= cap, `Transaction exceeds ${Number(cap) / 1e18} test STRK cap`);
    const sent = await account.execute(calls, { tip: 0n, resourceBounds: rb });
    r = state.transactions[label] = { transaction_hash: sent.transaction_hash }; await save();
  }
  if (!r.block_number) { r = state.transactions[label] = await receipt(r.transaction_hash); await save(); }
  console.log(`${label}: ${r.transaction_hash}`);
  return r;
}

const command = process.argv[2];
assert(['game', 'stub'].includes(command), 'Use game or stub');

async function declare(label, directory, name) {
  const contract = JSON.parse(await readFile(resolve(root, directory, `${name}.contract_class.json`), 'utf8'));
  const casm = JSON.parse(await readFile(resolve(root, directory, `${name}.compiled_contract_class.json`), 'utf8'));
  const classHash = hash.computeContractClassHash(contract);
  try { await node.getClassByHash(classHash); return classHash; } catch (e) { if (e.baseError?.code !== 28) throw e; }
  const id = `declare_${label}`;
  if (!state.transactions[id]) {
    const estimate = await account.estimateDeclareFee({ contract, casm }, { tip: 0n, skipValidate: false });
    const maximum = Object.values(estimate.resourceBounds).reduce((s, b) => s + BigInt(b.max_amount) * BigInt(b.max_price_per_unit), 0n);
    assert(maximum <= declarationCap, `Declaration exceeds ${Number(declarationCap) / 1e18} test STRK cap`);
    console.log(`${label}: declaring, maximum ${Number(maximum) / 1e18} test STRK`);
    const sent = await account.declare({ contract, casm }, { tip: 0n, resourceBounds: estimate.resourceBounds });
    state.transactions[id] = { transaction_hash: sent.transaction_hash }; await save();
  }
  state.transactions[id] = await receipt(state.transactions[id].transaction_hash); await save();
  return classHash;
}
async function deploy(label, classHash, constructorCalldata) {
  const id = `deploy_${label}`;
  if (!state.transactions[id]?.address) {
    const deployed = await account.deployContract({ classHash, constructorCalldata, salt: p.hex(hash.starknetKeccak(label)) },
      { tip: 0n, skipValidate: false });
    state.transactions[id] = { ...(await receipt(deployed.transaction_hash)), address: deployed.contract_address }; await save();
  }
  return state.transactions[id].address;
}

if (command === 'game') {
  if (!state.white) {
    const playerClass = await node.getClassHashAt(deployment.white);
    const deployed = await account.deployContract({ classHash: playerClass, constructorCalldata: [stored.address], salt: '0x5375727230756e64' },
      { tip: 0n, skipValidate: false });
    state.transactions.deploy_white = await receipt(deployed.transaction_hash);
    state.white = deployed.contract_address; state.white_class = playerClass; await save();
    console.log(`white TestPlayer: ${state.white}`);
  }
  for (const fixtureName of process.argv.slice(3).length ? process.argv.slice(3) : ['kgs_2019_04_10_39']) {
    const fixture = JSON.parse(await readFile(resolve(root, `offchain/fixtures/${fixtureName}.json`), 'utf8'));
    const record = state.games[fixtureName] ??= {};
    const created = await execute(`${fixtureName}_create`, c.createChannelCall({ channel: state.channel, size: fixture.terms.config.size,
      komi_half: fixture.terms.config.komi_half, invited_white: state.white, session_key: p.publicKey(keys[0]), prover: state.prover }));
    if (!record.game_id) {
      const trace = await c.rpc(RPC, 'starknet_traceTransaction', { transaction_hash: created.transaction_hash });
      record.game_id = trace.execute_invocation.calls.find(x => BigInt(x.contract_address) === BigInt(state.channel)).result[0]; await save();
    }
    await execute(`${fixtureName}_join`, c.channelCall(state.white, 'join', [state.channel, record.game_id, p.publicKey(keys[1])]));
    record.opened_at ??= new Date().toISOString(); await save();
    console.log(`${fixtureName}: measurement game ${record.game_id} open at epoch 0`);
  }
}

if (command === 'stub') {
  const [label, directory, size, komi] = process.argv.slice(3);
  assert(label && directory && size && komi, 'stub LABEL ARTIFACT_DIR SIZE KOMI_HALF');
  const proverClass = await declare(`${label}_prover`, directory, 'surround_offchain_ChannelProver');
  const stubClass = await declare('snapshot_stub', 'offchain/measure/target/dev', 'surround_measure_SnapshotStub');
  // Adapters from before the OS-program pin have no constructor.
  const abi = JSON.parse(await readFile(resolve(root, directory, 'surround_offchain_ChannelProver.contract_class.json'), 'utf8')).abi;
  const pinned = abi.some(entry => entry.type === 'constructor');
  const prover = await deploy(`${label}_prover`, proverClass, pinned ? [c.VIRTUAL_OS_PROGRAM] : []);
  const channel = await deploy(`${label}_stub_${size}`, stubClass,
    [prover, size, komi, p.hex(p.publicKey(keys[0])), p.hex(p.publicKey(keys[1]))]);
  (state.stubs ??= {})[`${label}_${size}`] = { prover_class: proverClass, prover, channel, size: Number(size), komi_half: Number(komi) };
  await save();
  console.log(`${label}: prover ${prover} (class ${proverClass}), stub channel ${channel}`);
}
