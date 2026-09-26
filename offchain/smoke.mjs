// Two disposable local wallets against the real Dojo channel on Devnet. No
// native proof acceptance is simulated here: settlement uses direct onchain
// replay, and the adapter is exercised only for its negative checks.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Account, RpcProvider, hash } from './sdk/node_modules/starknet/dist/index.mjs';
import * as p from './sdk/src/index.mjs';
import * as c from './sdk/src/client.mjs';
import assert from 'node:assert/strict';

const url = process.argv[2], parsed = new URL(url);
assert(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname));
assert.equal(BigInt(await c.rpc(url, 'starknet_chainId')), 0x4b4154414e41n);
const provider = new RpcProvider({ nodeUrl: url });
const stored = await c.rpc(url, 'devnet_getPredeployedAccounts', { with_balance: false });
const accounts = stored.slice(0, 2).map(a => new Account({ provider, address: a.address, signer: a.private_key }));
const manifest = JSON.parse(await readFile(new URL('../manifest_dev.json', import.meta.url), 'utf8'));
const channel = BigInt(manifest.contracts.find(x => x.tag === 'surround-channel').address);
const artifact = JSON.parse(await readFile(new URL('./cairo/target/dev/surround_offchain_ChannelProver.contract_class.json', import.meta.url), 'utf8'));
const casm = JSON.parse(await readFile(new URL('./cairo/target/dev/surround_offchain_ChannelProver.compiled_contract_class.json', import.meta.url), 'utf8'));
const bounds = Object.fromEntries(['l1_gas', 'l1_data_gas', 'l2_gas'].map(k => [k, { max_amount: 10_000_000_000n, max_price_per_unit: 1n }]));
const options = { resourceBounds: bounds, tip: 0n };
const report = { network: 'local Devnet 0.8.0', protocol: 'referee',
  proof_verification: 'No proof fields submitted; direct replay and negative native checks only', transactions: [], checks: [] };

async function receipt(tx) {
  const r = await provider.waitForTransaction(tx.transaction_hash, { retryInterval: 20 });
  assert.equal(r.execution_status, 'SUCCEEDED', p.json(r));
  return r;
}
const invoke = async (player, call, label) => {
  const tx = await accounts[player].execute(call, options), r = await receipt(tx);
  report.transactions.push({ label, hash: tx.transaction_hash, resources: r.execution_resources });
  return r;
};
const expectFailure = async (player, call, reason) => {
  await assert.rejects(accounts[player].estimateInvokeFee(call, { tip: 0n }), e => p.json(e).includes(reason) || String(e).includes(reason));
  report.checks.push(`Rejected ${reason}`);
};
const advance = async time => c.rpc(url, 'devnet_setTime', { time, generate_block: true });
const game = id => c.getChannel(provider, channel, id);

// The adapter: declared, deployed and allowlisted by the namespace owner (the migrating account).
const declared = await accounts[0].declare({ contract: artifact, casm }, options); await receipt(declared);
const deployed = await accounts[0].deployContract({ classHash: declared.class_hash, constructorCalldata: [c.VIRTUAL_OS_PROGRAM] }, options);
await receipt(deployed);
const prover = BigInt(deployed.contract_address);
assert.equal(BigInt(await provider.getClassHashAt(p.hex(prover))), BigInt(hash.computeContractClassHash(artifact)));
await expectFailure(1, c.allowProverCall(channel, declared.class_hash), 'Only namespace owner');
await invoke(0, c.allowProverCall(channel, declared.class_hash), 'allow prover class');
report.prover = p.hex(prover); report.channel = p.hex(channel);

const testKeys = [0x1n, 0x2n]; // Explicit public test keys; no production keys.
async function create(size = 9, komi_half = 13) {
  const r = await invoke(0, c.createChannelCall({ channel, size, komi_half, session_key: p.publicKey(testKeys[0]), prover, response_seconds: 300 }), 'create');
  const trace = await c.rpc(url, 'starknet_traceTransaction', { transaction_hash: r.transaction_hash });
  const id = BigInt(trace.execute_invocation.calls.find(x => BigInt(x.contract_address) === channel).result[0]);
  await invoke(1, c.joinChannelCall(channel, id, p.publicKey(testKeys[1])), 'join');
  const snapshot = await c.getSnapshot(provider, channel, id);
  return { id, snapshot, terms: snapshot.terms };
}
const move = (s, kind, point = p.NO_POINT, dead = 0n) => s.move(p.goStep(s.due(), kind, point, dead), testKeys[s.due()]);
const acks = (s, epoch) => testKeys.map(k => s.checkpointSignature(epoch, k));

// A complete recorded game settles by direct onchain replay of every signed step.
const fixture = JSON.parse(await readFile(new URL('./fixtures/cgos_9_1682833.json', import.meta.url), 'utf8'));
const first = await create(9, 14), session = p.goSession(first.terms);
assert.equal(first.snapshot.anchor_hash, p.stateHash(p.go, session.start));
for (const { step } of fixture.steps) move(session, step.move.action.kind, step.move.action.point, BigInt(step.move.action.dead));
const ok = acks(session, 0);
await expectFailure(0, c.settlementCall(prover, channel, first.id, 0, session.env, ok), 'Missing proof facts');
await expectFailure(0, c.channelCall(channel, 'accept_verified', [first.id, 0, first.snapshot.anchor_hash,
  ...p.encodeEnvelope(p.go, session.env), ...p.encodeSignatures(ok)]), 'Only prover');
await expectFailure(0, c.directHistoryCall(channel, first.id, 0, session.start, session.startWitness, session.steps,
  [ok[0], { ...ok[1], s: ok[1].s ^ 1n }]), 'Invalid session signature');
await invoke(0, c.directHistoryCall(channel, first.id, 0, session.start, session.startWitness, session.steps, ok), 'agreed full-game direct settlement');
let g = await game(first.id);
assert.equal(g.anchor.hash, session.stateHash()); assert.equal(g.status, 4);
assert.deepEqual(g.result, { finished: true, winner: p.WHITE, reason: p.AGREEMENT });
report.checks.push(`All ${session.steps.length} recorded steps, signatures and W+2 result matched in the actual Dojo contract`);

// A cooperative checkpoint, then offchain play continues from the new anchor.
const checkpoint = await create(), part = p.goSession(checkpoint.terms);
move(part, p.PLAY, 40); move(part, p.PLAY, 41);
await invoke(0, c.directHistoryCall(channel, checkpoint.id, 0, part.start, part.startWitness, part.steps, acks(part, 0)), 'cooperative checkpoint');
const anchored = await c.getSnapshot(provider, channel, checkpoint.id);
assert.equal(anchored.epoch, 1); assert.equal(anchored.anchor_hash, part.stateHash());
const tail = p.goSession(checkpoint.terms, { start: part.env, witness: part.witness() });
move(tail, p.PASS); move(tail, p.PASS); move(tail, p.PROPOSE); move(tail, p.ACCEPT);
await expectFailure(0, c.directHistoryCall(channel, checkpoint.id, 0, tail.start, tail.startWitness, tail.steps), 'Stale channel epoch');
await invoke(1, c.directHistoryCall(channel, checkpoint.id, 1, tail.start, tail.startWitness, tail.steps, acks(tail, 1)), 'checkpoint continuation settled');
assert.equal((await game(checkpoint.id)).status, 4);

// Freeze an anchor, submit newer candidates without moving it, resolve to a
// fresh response window, force a legal move, then resume offchain.
const dispute = await create(), prefix = p.goSession(dispute.terms);
move(prefix, p.PLAY, 40); move(prefix, p.PLAY, 41);
await invoke(1, c.disputeCall(channel, dispute.id, 0), 'open dispute');
const deadline = (await game(dispute.id)).deadline;
await invoke(0, c.directHistoryCall(channel, dispute.id, 0, prefix.start, prefix.startWitness, prefix.steps), 'candidate 2');
move(prefix, p.PLAY, 30); move(prefix, p.PLAY, 31);
await invoke(1, c.directHistoryCall(channel, dispute.id, 0, prefix.start, prefix.startWitness, prefix.steps), 'candidate 4');
let pending = await game(dispute.id);
assert.equal(pending.deadline, deadline); assert.equal(pending.anchor.seq, 0); assert.equal(pending.candidate.seq, 4);
await advance(deadline); await invoke(0, c.resolveCall(channel, dispute.id, 0), 'resolve to forced play');
let forced = await game(dispute.id);
assert.equal(forced.epoch, 1); assert(forced.deadline > deadline); assert.equal(forced.anchor.hash, prefix.stateHash());
await expectFailure(1, c.timeoutCall(channel, dispute.id, 1), 'Turn window open');
const anchorEnv = prefix.env, anchorWitness = prefix.witness();
move(prefix, p.PLAY, 20); // black's forced move, applied locally the same way
await expectFailure(1, c.forceStepsCall(channel, dispute.id, 1, anchorEnv, anchorWitness, [p.goStep(0, p.PLAY, 20)]), 'Not your step');
await invoke(0, c.forceStepsCall(channel, dispute.id, 1, anchorEnv, anchorWitness, [p.goStep(0, p.PLAY, 20)]), 'forced move');
forced = await game(dispute.id);
assert.equal(forced.anchor.hash, prefix.stateHash()); assert.equal(forced.anchor.due, 1);
const reopen = testKeys.map(k => prefix.reopenSignature(forced.epoch, forced.anchor.hash, k));
await invoke(0, c.resumeCall(channel, dispute.id, forced.epoch, reopen), 'mutual return to offchain play');
assert.equal((await game(dispute.id)).status, 1);
report.checks.push('Frozen dispute anchor, newer candidates, fresh deadline, forced move and mutual offchain resumption verified');

// Only the onchain response deadline determines a timeout.
const timed = await create(); await invoke(1, c.disputeCall(channel, timed.id, 0), 'timeout dispute');
await advance((await game(timed.id)).deadline); await invoke(1, c.resolveCall(channel, timed.id, 0), 'timeout forced phase');
await advance((await game(timed.id)).deadline); await invoke(1, c.timeoutCall(channel, timed.id, 1), 'timeout claimed');
g = await game(timed.id);
assert.deepEqual(g.result, { finished: true, winner: p.WHITE, reason: p.REASON_TIMEOUT });
report.checks.push('Only the onchain response deadline determines timeout');

// Either wallet can concede without a prover.
const conceded = await create(); await invoke(0, c.resignCall(channel, conceded.id), 'wallet resignation');
assert.deepEqual((await game(conceded.id)).result, { finished: true, winner: p.WHITE, reason: p.REASON_RESIGN });

report.completed_at = new Date().toISOString();
await mkdir(new URL('./results/', import.meta.url), { recursive: true });
await writeFile(new URL('./results/local-integration.json', import.meta.url), p.json(report));
console.log(`Local integration passed: ${report.transactions.length} signed transactions, ${report.checks.length} checks`);
