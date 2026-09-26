// Onchain calls for Surround's referee channel and its native proof adapter.
import { RpcProvider, shortString } from 'starknet';
import {
  ZERO_SIGNATURE, contextHash, decodeChannelGame, decodeSnapshot, decodeTerms, encodeBatch, encodeEnvelope,
  encodeSignatures, encodeSteps, finalSignatures, go, hex, proofMessageHash, proofPayload, replay, stateHash,
} from './index.mjs';

const tag = text => BigInt(shortString.encodeShortString(text));
const same = (a, b) => a.map(BigInt).join() === b.map(BigInt).join();
const requireThat = (ok, message) => { if (!ok) throw Error(message); };
const span = values => [values.length, ...values];
const noAcks = [ZERO_SIGNATURE, ZERO_SIGNATURE];

/**
 * Replay calldata from a session's step records (`session.steps`): the moves,
 * then each seat's final signature. Intermediate signatures stay offchain.
 */
export function batchOf(records) {
  requireThat(records.every(r => r.seat === 0 || r.seat === 1), 'Step records need their seat; use session.steps');
  return { steps: records.map(r => r.step), signatures: finalSignatures(records) };
}

export const NATIVE_CONFIRMATIONS = 10;
export function nativeProofBlock(head, anchorBlock) {
  requireThat(Number.isSafeInteger(head) && head >= 0 && Number.isSafeInteger(anchorBlock) && anchorBlock >= 0, 'Invalid block number');
  return head - NATIVE_CONFIRMATIONS >= anchorBlock ? head - NATIVE_CONFIRMATIONS : null;
}

export const decodeChannel = values => decodeChannelGame(go, values);
export const channelCall = (channel, entrypoint, calldata = []) => ({ contractAddress: hex(channel), entrypoint, calldata: calldata.map(hex) });
export const createChannelCall = ({ channel, size, komi_half, invited_white = 0n, session_key, prover, response_seconds = 3600 }) =>
  channelCall(channel, 'create_channel', [size, komi_half, invited_white, session_key, prover, response_seconds]);
export const joinChannelCall = (channel, id, sessionKey) => channelCall(channel, 'join_channel', [id, sessionKey]);
export const cancelCall = (channel, id) => channelCall(channel, 'cancel_channel', [id]);
export const disputeCall = (channel, id, epoch) => channelCall(channel, 'open_dispute', [id, epoch]);
export const resolveCall = (channel, id, epoch) => channelCall(channel, 'resolve_dispute', [id, epoch]);
export const timeoutCall = (channel, id, epoch) => channelCall(channel, 'claim_timeout', [id, epoch]);
export const resignCall = (channel, id) => channelCall(channel, 'resign_channel', [id]);
export const allowProverCall = (channel, classHash, allowed = true) => channelCall(channel, 'allow_prover', [classHash, allowed ? 1 : 0]);
export const resumeCall = (channel, id, epoch, acks) => channelCall(channel, 'resume_channel', [id, epoch, ...encodeSignatures(acks)]);
/**
 * Replay a session's steps onchain from the anchor `start`, whose superko
 * witness is `history`. `records` are session step records (`session.steps`).
 */
export const directHistoryCall = (channel, id, epoch, start, history, records, acks = noAcks) =>
  channelCall(channel, 'submit_history', [id, epoch, ...encodeEnvelope(go, start), ...span(history),
    ...encodeBatch(go, batchOf(records)), ...encodeSignatures(acks)]);
/** The due seat's forced steps (unsigned; the wallet call authenticates them). */
export const forceStepsCall = (channel, id, epoch, start, history, steps) =>
  channelCall(channel, 'force_steps', [id, epoch, ...encodeEnvelope(go, start), ...span(history), ...encodeSteps(go, steps)]);
export const settlementCall = (prover, channel, id, epoch, end, acks = noAcks) =>
  channelCall(prover, 'settle', [channel, id, epoch, ...encodeEnvelope(go, end), ...encodeSignatures(acks)]);

export async function rpc(url, method, params = {}, timeout = 30000) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw Object.assign(Error(`${method}: HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`), { httpStatus: response.status });
  const body = await response.json();
  if (body.error) throw Object.assign(Error(`${method}: ${body.error.message}`), { rpcError: body.error });
  return body.result;
}

export async function getChannel(provider, channel, id, block = 'latest') {
  return decodeChannel(await provider.callContract(channelCall(channel, 'get_channel', [id]), block));
}

export async function getTerms(provider, channel, id, block = 'latest') {
  return decodeTerms(go, await provider.callContract(channelCall(channel, 'terms', [id]), block));
}

export async function getSnapshot(provider, channel, id, block = 'latest') {
  const result = decodeSnapshot(go, await provider.callContract(channelCall(channel, 'snapshot', [id]), block));
  requireThat(result.terms.channel === BigInt(channel) && result.terms.game_id === BigInt(id), 'Snapshot identifies another game');
  requireThat(result.terms.chain_id === BigInt(await provider.getChainId()), 'Snapshot identifies another chain');
  return result;
}

// PROOF1 is the small (log20) path, PROOF2 the large path; the adapter accepts both
// and pins the virtual OS program (`osProgram`, read from the adapter).
export const PROOF_VERSIONS = ['PROOF1', 'PROOF2'];
// Virtual OS program attested in Starknet v0.14.4 proof facts (Sepolia, 2026-09).
// Pinned per adapter instance at deployment; a network OS upgrade needs a new instance.
export const VIRTUAL_OS_PROGRAM = '0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1';

export function validateNativeProof(response, { classHash, terms, epoch, startHash, endHash, block, osProgram }) {
  requireThat(typeof response.proof === 'string' && response.proof.length > 0, 'Missing native proof');
  const payload = proofPayload(go, { classHash, prover: terms.prover, terms, context: contextHash(go, terms), epoch, startHash, endHash });
  const messages = response.l2_to_l1_messages;
  requireThat(Array.isArray(messages) && messages.length === 1, 'Unexpected proof messages');
  requireThat(BigInt(messages[0].from_address) === BigInt(terms.prover) && BigInt(messages[0].to_address) === 0n
    && same(messages[0].payload, payload), 'Prover returned another transition');
  const f = response.proof_facts?.map(BigInt);
  requireThat(osProgram !== undefined, 'Supply the adapter\'s pinned OS program');
  requireThat(f?.length === 9 && PROOF_VERSIONS.map(tag).includes(f[0]) && f[1] === tag('VIRTUAL_SNOS')
    && f[2] === BigInt(osProgram) && f[3] === tag('VIRTUAL_SNOS0')
    && f[4] === BigInt(block.block_number) && f[5] === BigInt(block.block_hash) && f[7] === 1n
    && f[8] === proofMessageHash(terms.prover, payload), 'Proof facts do not match the block and transition');
  // These checks prevent mismatched service responses; Starknet must still verify
  // the cryptography when this proof is submitted. A response alone is not finality.
  return { proof: response.proof, proofFacts: response.proof_facts };
}

// The virtual INVOKE_V3 that ChannelProver executes to emit the proved transition.
// It is never broadcast; a prover runs it against a base block and proves it.
export function provingTransaction({ session, epoch, nonce, l2GasLimit = 10_000_000_000 }) {
  const zero = { max_amount: '0x1', max_price_per_unit: '0x0' };
  const { terms } = session;
  return { type: 'INVOKE', version: '0x3', sender_address: hex(terms.prover),
    calldata: [terms.channel, terms.game_id, epoch, ...encodeEnvelope(go, session.start), ...span(session.startWitness),
      ...encodeBatch(go, batchOf(session.steps))].map(hex),
    signature: [], nonce: hex(nonce),
    resource_bounds: { l1_gas: zero, l1_data_gas: zero, l2_gas: { max_amount: hex(l2GasLimit), max_price_per_unit: '0x0' } },
    tip: '0x0', paymaster_data: [], account_deployment_data: [], nonce_data_availability_mode: 'L1', fee_data_availability_mode: 'L1' };
}

export async function proveSession({ rpcUrl, proverUrl, session, epoch, blockNumber, expectedClassHash, l2GasLimit = 10_000_000_000 }) {
  requireThat(expectedClassHash !== undefined, 'Supply the allowlisted prover class hash');
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const { terms } = session;
  // Native verification accepts bases at least ten blocks behind the head.
  // Wait for a fresh create/join/checkpoint to enter that range before proving.
  const anchor = await getSnapshot(provider, terms.channel, terms.game_id);
  let eligible = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    eligible = nativeProofBlock(await provider.getBlockNumber(), anchor.anchor_block);
    if (eligible !== null) break;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  requireThat(eligible !== null, 'Channel anchor is not yet ten blocks deep; retry proving later');
  requireThat(blockNumber === undefined || (Number.isSafeInteger(blockNumber) && blockNumber >= anchor.anchor_block && blockNumber <= eligible),
    'Proof base must follow the anchor and be at least ten blocks deep');
  const block = await provider.getBlockWithTxHashes(blockNumber ?? eligible);
  const current = await getSnapshot(provider, terms.channel, terms.game_id, block.block_hash);
  requireThat(current.epoch === epoch, 'Stale proving epoch');
  const startHash = stateHash(go, session.start);
  requireThat(contextHash(go, current.terms) === contextHash(go, terms) && current.anchor_hash === startHash,
    'Session does not start at the chain anchor');
  requireThat(block.block_number >= current.anchor_block, 'Proof base predates anchor');
  const classHash = await provider.getClassHashAt(hex(terms.prover), block.block_hash);
  requireThat(BigInt(classHash) === BigInt(expectedClassHash), 'Unexpected prover class');
  const end = replay(go, terms, session.start, session.startWitness, session.steps).env;
  const endHash = stateHash(go, end);
  requireThat(endHash === session.stateHash(), 'Session output mismatch');
  const transaction = provingTransaction({ session, epoch, l2GasLimit,
    nonce: await provider.getNonceForAddress(hex(terms.prover), block.block_hash) });
  const started = Date.now();
  const response = await rpc(proverUrl, 'starknet_proveTransaction', { block_id: { block_hash: block.block_hash }, transaction }, 600000);
  const osProgram = BigInt((await provider.callContract(channelCall(terms.prover, 'os_program'), block.block_hash))[0]);
  const options = validateNativeProof(response, { classHash, terms, epoch, startHash, endHash, block, osProgram });
  return { response, options, block, wall_seconds: (Date.now() - started) / 1000,
    call: (acks = noAcks) => settlementCall(terms.prover, terms.channel, terms.game_id, epoch, end, acks) };
}
