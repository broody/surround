// Onchain calls for Surround's referee channel and its native proof adapter.
// Native proving comes from referee (`@referee/sdk/proving`), bound to Go here,
// and so do the session store and the keeper client that timed games use.
import * as proving from '@referee/sdk/proving';
import { parse } from '@referee/sdk/store';
import {
  Reader, ZERO_SIGNATURE, batchOf, decodeChannelGame, decodeTerms, encodeBatch, encodeEnvelope, encodeSignature,
  encodeSignatures, encodeSteps, encodeTimeControl, encodeWitness, felt, go, hex, sign, signingHash, span,
  standardTime, tag,
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
/** A ticket from its Serde encoding (`encodeTicket`'s inverse), e.g. from a `TicketUsed` event. */
export function decodeTicket(values) {
  const r = new Reader(values);
  const ticket = { chain_id: r.next(), channel: r.next(), black: r.next(), white: r.next(), size: r.num(), komi_half: r.num() };
  const referee = r.next(), settings = new Reader(r.span());
  ticket.clock = { referee, settings: (go.time ?? standardTime).decodeSettings(settings), rng_tip: r.next() };
  settings.done();
  Object.assign(ticket, { prover: r.next(), response_seconds: r.num(), source: r.num(), black_band: r.num(),
    white_band: r.num(), matchmaker: r.next(), issued_at: r.next(), expires_at: r.next(), nonce: r.next() });
  r.done();
  return ticket;
}
/** The message the matchmaker signs for a ticket. */
export const ticketDigest = t => signingHash([tag('SURROUND_PAIRING_V1'), ...encodeTicket(t)]);
export const signTicket = (t, privateKey) => sign(ticketDigest(t), privateKey);
/** A ticket as JSON (felts as hex), and back. */
const TICKET_FELTS = ['chain_id', 'channel', 'black', 'white', 'prover', 'matchmaker', 'issued_at', 'expires_at', 'nonce'];
export const ticketJson = t => ({ ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === 'bigint' ? hex(v) : v])),
  clock: { ...t.clock, referee: hex(t.clock.referee), rng_tip: hex(t.clock.rng_tip ?? 0n) } });
export const reviveTicket = t => ({ ...t, ...Object.fromEntries(TICKET_FELTS.map(k => [k, BigInt(t[k])])),
  clock: { ...t.clock, referee: BigInt(t.clock.referee), rng_tip: BigInt(t.clock.rng_tip ?? 0) } });
/**
 * What a player's wallet signs for a matchmaker request (SNIP-12, revision 1):
 * `action` is 'queue', 'leave', 'table', 'join' or 'close'; `at` is Unix seconds;
 * `nonce` is a random felt, never reused by the player (the replay guard).
 * The matchmaker verifies it through the player's account contract.
 */
export function matchmakerRequest({ chainId, action, player, size = 0, clock = '', band = 0, table = '', at, nonce }) {
  return {
    types: {
      StarknetDomain: [{ name: 'name', type: 'shortstring' }, { name: 'version', type: 'shortstring' },
        { name: 'chainId', type: 'shortstring' }, { name: 'revision', type: 'shortstring' }],
      Request: [{ name: 'action', type: 'shortstring' }, { name: 'player', type: 'ContractAddress' },
        { name: 'size', type: 'u128' }, { name: 'clock', type: 'shortstring' }, { name: 'band', type: 'u128' },
        { name: 'table', type: 'shortstring' }, { name: 'at', type: 'timestamp' }, { name: 'nonce', type: 'felt' }],
    },
    primaryType: 'Request',
    domain: { name: 'Surround Matchmaker', version: '2', chainId: hex(chainId), revision: '1' },
    message: { action, player: hex(player), size: String(size), clock, band: String(band), table: String(table), at: String(at),
      nonce: hex(felt(nonce)) },
  };
}
/** Black creates a rated game from a matchmaker-signed ticket; white then joins before it expires. */
export const createRatedChannelCall = ({ channel, ticket, signature, session_key }) =>
  channelCall(channel, 'create_rated_channel', [...encodeTicket(ticket), ...encodeSignature(signature), session_key]);
export const joinChannelCall = (channel, id, sessionKey) => channelCall(channel, 'join_channel', [id, sessionKey]);
/**
 * Report a settled rated game to SurroundRatings with its `ticket` (from the
 * contract's `TicketUsed` event, or the matchmaker) and mirror the new ratings
 * for Torii. Anyone may send it.
 */
export const rateCall = (channel, id, ticket) => channelCall(channel, 'rate', [id, ...encodeTicket(ticket)]);
/** Mirror a player's current rating into this world's events. */
export const syncCall = (channel, player) => channelCall(channel, 'sync', [player]);
export const cancelCall = (channel, id) => channelCall(channel, 'cancel_channel', [id]);
export const disputeCall = (channel, id, epoch) => channelCall(channel, 'open_dispute', [id, epoch]);
export const resolveCall = (channel, id, epoch) => channelCall(channel, 'resolve_dispute', [id, epoch]);
export const timeoutCall = (channel, id, epoch) => channelCall(channel, 'claim_timeout', [id, epoch]);
export const resignCall = (channel, id) => channelCall(channel, 'resign_channel', [id]);
export const allowProverCall = (channel, classHash, allowed = true) => channelCall(channel, 'allow_prover', [classHash, allowed ? 1 : 0]);
export const resumeCall = (channel, id, epoch, acks) => channelCall(channel, 'resume_channel', [id, epoch, ...encodeSignatures(acks)]);
/** The referee of a timed game is live during a dispute (`Referee#acknowledgement`). Anyone may send it. */
export const acknowledgeCall = (channel, id, epoch, signature) => channelCall(channel, 'acknowledge', [id, epoch, ...encodeSignature(signature)]);
/** A timed game's referee returns it from forced play (`Referee#resumeSignature`). Anyone may send it. */
export const resumeByRefereeCall = (channel, id, epoch, signature) =>
  channelCall(channel, 'resume_by_referee', [id, epoch, ...encodeSignature(signature)]);
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
/** The adapter's `settle`: `startHash` is the channel's anchor or candidate the proof starts from. */
export const settlementCall = (prover, channel, id, epoch, startHash, end, acks = noAcks) =>
  proving.settlementCall(go, { prover, channel, gameId: id, epoch, startHash, end, acks });

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

/**
 * A player's rating from SurroundRatings: μ and φ in Q32.32 logits (see
 * rating.mjs), the record, rank in tenths (0 = 30k, 300 = 1d) and "?".
 */
export async function getPlayerRating(provider, ratings, player, block = 'latest') {
  const r = (await provider.callContract(channelCall(ratings, 'player', [player]), block)).map(BigInt);
  const i64 = x => (x >= 1n << 251n ? x - FIELD : x);
  return { mu: i64(r[0]), phi: r[1], last_played: r[2], games: Number(r[3]), wins: Number(r[4]), losses: Number(r[5]),
    draws: Number(r[6]), rank_tenths: Number(r[7]), provisional: r[8] === 1n, established: r[9] === 1n,
    settled: r[10] === 1n, peak: i64(r[11]), has_peak: r[12] === 1n, band: Number(r[13]), params: Number(r[14]) };
}
const FIELD = 2n ** 251n + 17n * 2n ** 192n + 1n;

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
