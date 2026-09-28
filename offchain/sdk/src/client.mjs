// Onchain calls for Surround's referee channel and its native proof adapter.
// Native proving comes from referee (`@referee/sdk/proving`), bound to Go here,
// and so do the session store and the keeper client that timed games use.
import * as proving from '@referee/sdk/proving';
import { parse } from '@referee/sdk/store';
import {
  ZERO_SIGNATURE, batchOf, decodeChannelGame, decodeTerms, encodeBatch, encodeEnvelope, encodeSignature,
  encodeSignatures, encodeSteps, encodeTimeControl, encodeWitness, felt, go, hex, sign, signingHash, span, tag,
} from './index.mjs';
import { encodeKifu } from './kifu.mjs';

export { NATIVE_CONFIRMATIONS, PROOF_VERSIONS, VIRTUAL_OS_PROGRAM, nativeProofBlock, rpc } from '@referee/sdk/proving';
export { SessionStore, memoryBackend, indexedDbBackend } from '@referee/sdk/store';
export { KeeperClient } from '@referee/sdk/keeper';
export { batchOf };
export { encodeKifu, decodeKifu } from './kifu.mjs';

const noAcks = [ZERO_SIGNATURE, ZERO_SIGNATURE];

export const decodeChannel = values => decodeChannelGame(go, values);
export const channelCall = proving.contractCall;
/**
 * `clock` is the game's time control, null for an untimed game. A ranked game
 * passes `rankedClock(await keeperReferee(keeperUrl))` (60 s per turn) or
 * `byoyomiClock(...)`: the keeper that referees it stamps every step.
 */
export const createChannelCall = ({ channel, size, komi_half, invited_white = 0n, session_key, prover, response_seconds = 3600, clock = null }) =>
  channelCall(channel, 'create_channel', [size, komi_half, invited_white, session_key, prover, response_seconds,
    ...(clock == null ? [1n] : [0n, ...encodeTimeControl(go, clock)])]);
/** A rated ticket's source: the quick-match queue or a brokered open table. */
export const QUEUE = 1, TABLE = 2;
/**
 * A rated pairing's Serde encoding, field for field `surround_ratings::ticket::Ticket`:
 * { chain_id, channel, black, white, size, komi_half, clock, prover,
 *   response_seconds, source, black_band, white_band, matchmaker, issued_at,
 *   expires_at, nonce }, where `clock` is a time control (`rankedClock(...)`).
 */
export const encodeTicket = t => [t.chain_id, t.channel, t.black, t.white, t.size, t.komi_half,
  ...encodeTimeControl(go, t.clock), t.prover, t.response_seconds, t.source, t.black_band, t.white_band,
  t.matchmaker, t.issued_at, t.expires_at, t.nonce].map(felt);
/** The message the matchmaker signs for a ticket. */
export const ticketDigest = t => signingHash([tag('SURROUND_PAIRING_V1'), ...encodeTicket(t)]);
export const signTicket = (t, privateKey) => sign(ticketDigest(t), privateKey);
/** Black creates a rated game from a matchmaker-signed ticket; white then joins before it expires. */
export const createRatedChannelCall = ({ channel, ticket, signature, session_key }) =>
  channelCall(channel, 'create_rated_channel', [...encodeTicket(ticket), ...encodeSignature(signature), session_key]);
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
 * witness is `history`. `records` are session step records (`session.steps`);
 * in a timed game their stamps and the last record's referee attestation go too.
 */
export const directHistoryCall = (channel, id, epoch, start, history, records, acks = noAcks) =>
  channelCall(channel, 'submit_history', [id, epoch, ...encodeEnvelope(go, start), ...encodeWitness(go, history),
    ...encodeBatch(go, batchOf(records)), ...encodeSignatures(acks)]);
/**
 * The due seat's forced steps (unsigned; the wallet call authenticates them).
 * They carry no stamps, so a timed game's clock pauses until the next stamp.
 */
export const forceStepsCall = (channel, id, epoch, start, history, steps) =>
  channelCall(channel, 'force_steps', [id, epoch, ...encodeEnvelope(go, start), ...encodeWitness(go, history), ...encodeSteps(go, steps)]);
export const settlementCall = (prover, channel, id, epoch, end, acks = noAcks) =>
  proving.settlementCall(go, { prover, channel, gameId: id, epoch, end, acks });

/**
 * A settled ranked game's kifu record, from a session that holds every step
 * since the opening; its end state is the settled anchor `mintKifuCall` takes.
 */
export function kifuRecord(session) {
  if (session.start.seq !== 0) throw Error('Kifu needs every step from the opening');
  return encodeKifu(session.terms.config.size, session.steps.map(r => r.step), session.env.game.board);
}
/** Mint a settled ranked game's kifu to its winner. Anyone may send it. */
export const mintKifuCall = (kifu, id, anchor, record) =>
  channelCall(kifu, 'mint', [id, ...encodeEnvelope(go, anchor), ...span(record)]);

/** The referee public key a keeper reports (`GET /info`), or null if it referees no games. */
export async function keeperReferee(url, { fetch = globalThis.fetch } = {}) {
  const response = await fetch(`${url.replace(/\/$/, '')}/info`);
  if (!response.ok) throw Error(`Keeper /info: HTTP ${response.status}`);
  const { referee } = parse(await response.text());
  return referee == null ? null : felt(referee);
}

export async function getChannel(provider, channel, id, block = 'latest') {
  return decodeChannel(await provider.callContract(channelCall(channel, 'get_channel', [id]), block));
}

export async function getTerms(provider, channel, id, block = 'latest') {
  return decodeTerms(go, await provider.callContract(channelCall(channel, 'terms', [id]), block));
}

export const getSnapshot = (provider, channel, id, block = 'latest') => proving.getSnapshot(provider, go, channel, id, block);
export const validateNativeProof = (response, expected) => proving.validateNativeProof(go, response, expected);
export const provingTransaction = proving.provingTransaction;
/** The adapter's virtual `__execute__` calldata for a session: what the OS hashes and the proof carries. */
export const provingCalldata = proving.provingCalldata;
/** Prove a Go session with referee's proving client; see `@referee/sdk/proving`. */
export const proveSession = proving.proveSession;
