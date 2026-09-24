// Real SNIP-36 benchmark. Uses public SGFs and a Sepolia-only signer.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(process.env.PRIVACY_DIR ?? resolve(here, '../../starknet-privacy'), 'sdk/package.json'));
const { Account, RpcProvider, hash, ec, shortString } = require('starknet');
const RPC = process.env.SURROUND_SEPOLIA_RPC ?? 'https://starknet-sepolia-rpc.publicnode.com';
const PROVER = process.env.SURROUND_SEPOLIA_PROVER ?? 'https://transaction-prover.alpha-sepolia.sw-dev.io';
const CHAIN = 0x534e5f5345504f4c4941n;
const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const EXPECTED_ACCOUNT = '0x3209826d1cdd1ff0f034b64f2df829d9bd39d62f6ec2ab913a32c741b6a7119';
const MAX_TRANSACTION_FEE = 10n * 10n ** 18n; // Disposable Sepolia STRK only.
const MAX_DECLARATION_FEE = 50n * 10n ** 18n;
const resultFile = resolve(here, 'results/sepolia.json');
const rawDirectory = resolve(here, 'results/raw/sepolia');
const json = x => JSON.stringify(x, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
const hex = x => '0x' + BigInt(x).toString(16);
const felt = x => BigInt(shortString.encodeShortString(x));
const sha = data => createHash('sha256').update(data).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const node = new RpcProvider({ nodeUrl: RPC, transactionRetryIntervalFallback: 1500 });

async function indexedRead(operation) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (error.baseError?.code !== 24 || attempt >= 20) throw error;
      await pause(1500);
    }
  }
}

async function rpc(url, method, params = [], timeout = 30_000) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: json({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) {
    const error = new Error(`${method}: RPC ${body.error.code} ${body.error.message}`);
    error.baseError = body.error;
    throw error;
  }
  return body.result;
}

function safeError(error) {
  const base = error.baseError;
  if (base) return { code: base.code, message: base.message,
    ...(base.data === undefined ? {} : { data: json(base.data).slice(0, 1200) }) };
  return { message: String(error.message).slice(0, 300) };
}

async function main() {
  const command = process.argv[2] ?? 'preflight';
  if (!['preflight', 'deploy', 'run', 'negative'].includes(command)) throw Error('Use preflight, deploy, run, or negative');
  if (BigInt(await node.getChainId()) !== CHAIN) throw Error('Refusing a non-Sepolia RPC');
  const version = await rpc(PROVER, 'starknet_specVersion');
  const accountPath = process.env.SURROUND_ACCOUNT_FILE ?? resolve(homedir(), '.starknet_accounts/starknet_open_zeppelin_accounts.json');
  if (((await stat(accountPath)).mode & 0o777) !== 0o600) throw Error('Signer file must be owner-only (0600)');
  const stored = JSON.parse(await readFile(accountPath, 'utf8'))['alpha-sepolia'].stakewars_sepolia_deployer;
  if (BigInt(stored.address) !== BigInt(EXPECTED_ACCOUNT)) throw Error('Unexpected Sepolia signer');
  const onchainKey = await node.callContract({ contractAddress: stored.address, entrypoint: 'get_public_key', calldata: [] });
  if (BigInt(onchainKey[0]) !== BigInt(ec.starkCurve.getStarkKey(stored.private_key))) throw Error('Signer key mismatch');
  const account = new Account({ provider: node, address: stored.address, signer: stored.private_key });
  const balance = await node.callContract({ contractAddress: STRK, entrypoint: 'balance_of', calldata: [stored.address] });
  const balanceWei = BigInt(balance[0]) + (BigInt(balance[1]) << 128n);
  console.log(`Sepolia verified; prover ${version}; deployer ${stored.address}; ${Number(balanceWei) / 1e18} test STRK`);
  if (command === 'preflight') return;

  const artifactDirectory = resolve(here, 'native/target/dev');
  const contractBytes = await readFile(resolve(artifactDirectory, 'surround_native_bench_NativeScoring.contract_class.json'));
  const contract = JSON.parse(contractBytes);
  const casm = JSON.parse(await readFile(resolve(artifactDirectory, 'surround_native_bench_NativeScoring.compiled_contract_class.json')));
  const classHash = hash.computeContractClassHash(contract);
  await mkdir(rawDirectory, { recursive: true });
  let state;
  try { state = JSON.parse(await readFile(resultFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  state ??= { network: 'SN_SEPOLIA', rpc_url: RPC, prover_url: PROVER, prover_spec: version,
    created_at: new Date().toISOString(), deployer: stored.address, class_hash: classHash,
    contract_artifact_sha256: sha(contractBytes), records: {} };
  if (BigInt(state.class_hash) !== BigInt(classHash)) throw Error('Artifact changed; preserve existing deployment and choose a new run explicitly');
  const save = () => writeFile(resultFile, json(state));
  await save();

  function bounds(estimate, cap = MAX_TRANSACTION_FEE) {
    const rb = estimate.resourceBounds;
    const maximum = Object.values(rb).reduce((s, r) => s + BigInt(r.max_amount) * BigInt(r.max_price_per_unit), 0n);
    if (maximum > cap) throw Error(`Transaction exceeds ${Number(cap) / 1e18} test STRK fee cap (${Number(maximum) / 1e18})`);
    return rb;
  }
  async function receipt(txHash) {
    const start = Date.now();
    while (Date.now() - start < 300_000) {
      let result;
      try { result = await node.getTransactionReceipt(txHash); }
      catch (error) { if (error.baseError?.code !== 29) throw error; }
      if (result?.execution_status === 'REVERTED') throw Error(`Transaction reverted: ${txHash}; ${String(result.revert_reason).slice(0, 250)}`);
      if (result?.block_number && result.execution_status === 'SUCCEEDED') return {
        transaction_hash: txHash, block_number: result.block_number, block_hash: result.block_hash,
        execution_status: result.execution_status, finality_status: result.finality_status,
        execution_resources: result.execution_resources, actual_fee: result.actual_fee,
      };
      await pause(1500);
    }
    throw Error(`Receipt pending; resume with saved transaction ${txHash}`);
  }
  async function execute(label, calls, options = {}) {
    state.transactions ??= {};
    const old = state.transactions[label];
    if (old?.transaction_hash) {
      if (!old.block_number) { state.transactions[label] = await receipt(old.transaction_hash); await save(); }
      return state.transactions[label];
    }
    // Public RPC backends can briefly serve an older preconfirmed state after
    // returning a successful receipt. Estimate against an explicit visible block.
    const minimumBlock = Math.max(state.deployment?.block_number ?? 0,
      ...Object.values(state.transactions).map(r => r.block_number ?? 0));
    let blockIdentifier;
    for (let attempt = 0; attempt < 30; attempt++) {
      blockIdentifier = await node.getBlockNumber();
      if (blockIdentifier >= minimumBlock) break;
      await pause(1500);
    }
    if (blockIdentifier < minimumBlock) throw Error('RPC has not caught up to confirmed transactions');
    const estimate = await indexedRead(() => account.estimateInvokeFee(calls, { tip: 0n, blockIdentifier, ...options }));
    const tx = await account.execute(calls, { tip: 0n, ...options, resourceBounds: bounds(estimate) });
    state.transactions[label] = { transaction_hash: tx.transaction_hash }; await save();
    const result = await receipt(tx.transaction_hash);
    state.transactions[label] = result; await save();
    console.log(`${label}: ${tx.transaction_hash} in block ${result.block_number}`);
    return result;
  }

  if (!state.declaration) {
    const estimate = await account.estimateDeclareFee({ contract, casm }, { tip: 0n });
    const tx = await account.declare({ contract, casm }, { tip: 0n, resourceBounds: bounds(estimate, MAX_DECLARATION_FEE) });
    state.declaration = { transaction_hash: tx.transaction_hash }; await save();
  }
  if (!state.declaration.block_number) { state.declaration = await receipt(state.declaration.transaction_hash); await save(); }
  if (!state.deployment) {
    const payload = { classHash, salt: '0x135288b', constructorCalldata: [stored.address] };
    const estimate = await account.estimateDeployFee(payload, { tip: 0n });
    const tx = await account.deployContract(payload, { tip: 0n, resourceBounds: bounds(estimate) });
    state.contract_address = tx.contract_address;
    state.deployment = { transaction_hash: tx.transaction_hash }; await save();
  }
  if (!state.deployment.block_number) { state.deployment = await receipt(state.deployment.transaction_hash); await save(); }
  const address = state.contract_address;
  if (BigInt(await node.getClassHashAt(address)) !== BigInt(classHash)) throw Error('Deployed class mismatch');
  console.log(`Verified Surround native scorer ${address}`);
  if (command === 'deploy') return;

  if (command === 'negative') {
    if (state.invalid_facts_rejected) { console.log('Native rejection already verified'); return; }
    const record = Object.values(state.records).find(r => r.settlement);
    if (!record) throw Error('Complete a real proof settlement first');
    const bytes = await readFile(resolve(here, record.proof.path));
    if (sha(bytes) !== record.proof.response_sha256) throw Error('Proof response digest mismatch');
    const proof = JSON.parse(bytes);
    // A different message fact forces a different proof-cache key. Reusing the
    // authentic proof must not authenticate this altered statement.
    const changedFacts = [...proof.proof_facts];
    changedFacts[8] = hex(BigInt(changedFacts[8]) ^ 1n);
    const block = await node.getBlockWithTxHashes('latest');
    const resourceBounds = {
      l1_gas: { max_amount: 1000n, max_price_per_unit: BigInt(block.l1_gas_price.price_in_fri) * 2n },
      l1_data_gas: { max_amount: 1000n, max_price_per_unit: BigInt(block.l1_data_gas_price.price_in_fri) * 2n },
      l2_gas: { max_amount: 120_000_000n, max_price_per_unit: BigInt(block.l2_gas_price.price_in_fri) * 2n },
    };
    bounds({ resourceBounds });
    const nonce = await node.getNonceForAddress(stored.address, 'latest');
    let rejected;
    try {
      const tx = await account.execute({ contractAddress: address, entrypoint: 'settle',
        calldata: [record.id, ...record.proof.output_half_points] }, {
        tip: 0n, nonce, resourceBounds, proof: proof.proof, proofFacts: changedFacts,
      });
      state.unexpected_negative_transaction = tx.transaction_hash; await save();
      throw Error(`Altered facts unexpectedly submitted: ${tx.transaction_hash}`);
    } catch (error) {
      if (!error.baseError || !/proof|fact/i.test(json(error.baseError))) throw error;
      rejected = safeError(error);
    }
    const after = await node.getNonceForAddress(stored.address, 'latest');
    if (BigInt(after) !== BigInt(nonce)) throw Error('Signer nonce changed during rejected proof test');
    state.invalid_facts_rejected = { stage: 'actual Sepolia submission', error: rejected,
      signer_nonce_unchanged: true, tested_at: new Date().toISOString() };
    await save();
    console.log(`Native gateway rejected altered proof facts: ${json(rejected)}`);
    return;
  }

  const fixtures = JSON.parse(await readFile(resolve(here, 'fixtures.json'), 'utf8'));
  const expected = Object.fromEntries(JSON.parse(await readFile(resolve(here, 'results/direct.json'), 'utf8')).records.map(r => [r.id, r.output.slice(1)]));
  const call = (entrypoint, calldata) => ({ contractAddress: address, entrypoint, calldata });
  const seals = fixtures.map((fixture, index) => call('seal', [index + 1, ...fixture.arguments]));
  await execute('seal-recorded-games', seals);
  for (const [index, fixture] of fixtures.entries()) {
    const id = index + 1;
    const record = state.records[fixture.id] ??= { id, size: fixture.size, result: fixture.result };
    record.direct = await execute(`direct-${fixture.id}`, call('direct', [id, ...fixture.arguments]));
    const directOutput = await indexedRead(() => node.callContract(call('result', [id, 0]), record.direct.block_number));
    if (directOutput.map(BigInt).join() !== [1n, ...expected[fixture.id].map(BigInt)].join()) throw Error('Direct score differs from recorded result');
    await save();
    if (record.settlement) continue;
    const proofFile = resolve(rawDirectory, `${fixture.id}.json`);
    let proof;
    if (record.proof) {
      const bytes = await readFile(proofFile);
      if (sha(bytes) !== record.proof.response_sha256) throw Error('Saved proof response changed');
      proof = JSON.parse(bytes);
    } else {
      const [commitment, sealedBlock] = await node.callContract(call('snapshot', [id]), state.transactions['seal-recorded-games'].block_number);
      let block;
      do {
        const head = await node.getBlockNumber();
        if (head - 10 >= Number(sealedBlock)) {
          block = await node.getBlockWithTxHashes(head - 10); break;
        }
        console.log('Waiting for sealed snapshot to be 10 blocks deep'); await pause(10_000);
      } while (true);
      const nonce = await node.getNonceForAddress(address, block.block_hash);
      const zero = { max_amount: '0x1', max_price_per_unit: '0x0' };
      const transaction = { type: 'INVOKE', version: '0x3', sender_address: address,
        calldata: [id, ...fixture.arguments].map(hex), signature: [], nonce: hex(nonce),
        resource_bounds: { l1_gas: zero, l1_data_gas: zero,
          l2_gas: { max_amount: hex(500_000_000), max_price_per_unit: '0x0' } },
        tip: '0x0', paymaster_data: [], account_deployment_data: [],
        nonce_data_availability_mode: 'L1', fee_data_availability_mode: 'L1' };
      console.log(`${fixture.id}: requesting real Stwo transaction proof at block ${block.block_number}`);
      const started = performance.now();
      proof = await rpc(PROVER, 'starknet_proveTransaction', { block_id: { block_hash: block.block_hash }, transaction }, 600_000);
      const elapsed = (performance.now() - started) / 1000;
      const [black, white] = expected[fixture.id].map(BigInt);
      const payload = [BigInt(classHash), felt('SURROUND_NATIVE_SCORE_V1'), CHAIN, BigInt(address), BigInt(id), BigInt(commitment), black, white];
      const messages = proof.l2_to_l1_messages;
      if (messages.length !== 1 || BigInt(messages[0].from_address) !== BigInt(address)
          || BigInt(messages[0].to_address) !== 0n || messages[0].payload.map(BigInt).join() !== payload.join()) throw Error('Prover returned an unexpected scoring message');
      const facts = proof.proof_facts.map(BigInt);
      const messageHash = ec.starkCurve.poseidonHashMany([BigInt(address), 0n, BigInt(payload.length), ...payload]);
      if (facts.length !== 9 || facts[0] !== felt('PROOF1') || facts[1] !== felt('VIRTUAL_SNOS')
          || facts[3] !== felt('VIRTUAL_SNOS0') || facts[4] !== BigInt(block.block_number)
          || facts[5] !== BigInt(block.block_hash) || facts[7] !== 1n || facts[8] !== messageHash) throw Error('Prover facts do not bind the expected block/message');
      const responseBytes = json(proof); await writeFile(proofFile, responseBytes);
      record.proof = { wall_seconds: elapsed, base_block_number: block.block_number,
        base_block_hash: block.block_hash, starknet_version: block.starknet_version,
        response_sha256: sha(responseBytes), proof_sha256: sha(Buffer.from(proof.proof, 'base64')),
        proof_bytes: Buffer.from(proof.proof, 'base64').length, proof_facts: proof.proof_facts,
        output_half_points: [black, white].map(String), path: proofFile.slice(here.length + 1) };
      await save();
      console.log(`${fixture.id}: proof received in ${elapsed.toFixed(2)}s (${record.proof.proof_bytes} bytes)`);
    }
    const settlement = call('settle', [id, ...expected[fixture.id]]);
    const proofOptions = { proof: proof.proof, proofFacts: proof.proof_facts };
    if (!record.changed_score_rejected) {
      try {
        await account.estimateInvokeFee(call('settle', [id, BigInt(expected[fixture.id][0]) + 1n, expected[fixture.id][1]]), { tip: 0n, ...proofOptions });
      } catch (error) {
        if (!json(error.baseError).includes('Wrong proved message')) throw error;
        record.changed_score_rejected = { stage: 'Sepolia fee simulation', reason: 'Wrong proved message' };
      }
      if (!record.changed_score_rejected) throw Error('Changed score accepted in simulation');
      await save();
    }
    record.settlement = await execute(`proof-${fixture.id}`, settlement, proofOptions);
    const output = await indexedRead(() => node.callContract(call('result', [id, 1]), record.settlement.block_number));
    if (output.map(BigInt).join() !== directOutput.map(BigInt).join()) throw Error('Native settled score differs from direct execution');
    record.verified_output = output.map(x => BigInt(x).toString());
    await save();
  }
  state.completed_at = new Date().toISOString(); await save();
  console.log('All six native proof settlements verified on Sepolia');
}

main().catch(error => { console.error(json(safeError(error))); process.exitCode = 1; });
