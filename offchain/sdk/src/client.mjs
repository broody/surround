// Onchain calls for Surround's referee channel and its native proof adapter.
// Native proving comes from referee (`@referee/sdk/proving`), bound to Go here.
import * as proving from '@referee/sdk/proving';
import {
  ZERO_SIGNATURE, batchOf, decodeChannelGame, decodeTerms, encodeBatch, encodeEnvelope, encodeSignatures,
  encodeSteps, encodeWitness, go, hex,
} from './index.mjs';

export { NATIVE_CONFIRMATIONS, PROOF_VERSIONS, VIRTUAL_OS_PROGRAM, nativeProofBlock, rpc } from '@referee/sdk/proving';
export { batchOf };

const noAcks = [ZERO_SIGNATURE, ZERO_SIGNATURE];

export const decodeChannel = values => decodeChannelGame(go, values);
export const channelCall = proving.contractCall;
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
  channelCall(channel, 'submit_history', [id, epoch, ...encodeEnvelope(go, start), ...encodeWitness(go, history),
    ...encodeBatch(go, batchOf(records)), ...encodeSignatures(acks)]);
/** The due seat's forced steps (unsigned; the wallet call authenticates them). */
export const forceStepsCall = (channel, id, epoch, start, history, steps) =>
  channelCall(channel, 'force_steps', [id, epoch, ...encodeEnvelope(go, start), ...encodeWitness(go, history), ...encodeSteps(go, steps)]);
export const settlementCall = (prover, channel, id, epoch, end, acks = noAcks) =>
  proving.settlementCall(go, { prover, channel, gameId: id, epoch, end, acks });

export async function getChannel(provider, channel, id, block = 'latest') {
  return decodeChannel(await provider.callContract(channelCall(channel, 'get_channel', [id]), block));
}

export async function getTerms(provider, channel, id, block = 'latest') {
  return decodeTerms(go, await provider.callContract(channelCall(channel, 'terms', [id]), block));
}

export const getSnapshot = (provider, channel, id, block = 'latest') => proving.getSnapshot(provider, go, channel, id, block);
export const validateNativeProof = (response, expected) => proving.validateNativeProof(go, response, expected);
export const provingTransaction = proving.provingTransaction;
/** Prove a Go session with referee's proving client; see `@referee/sdk/proving`. */
export const proveSession = proving.proveSession;
