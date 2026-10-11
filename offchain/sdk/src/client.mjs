// Onchain calls for Surround's arbiter channel and its native proof adapter.
// Native proving comes from arbiter (`@arbiter/sdk/proving`), bound to Go here,
// and so do the session store and the keeper client that timed games use. A
// game reaches the chain only when it first needs it: `openGameCall` (or
// `openRatedGameCall`) goes first in that transaction.
import { typedData } from 'starknet';
import * as proving from '@arbiter/sdk/proving';
import * as arbiterRatings from '@arbiter/sdk/ratings';
import { parse } from '@arbiter/sdk/store';
import {
  ZERO_SIGNATURE, batchOf, contextHash, decodeChannelGame, decodeTerms, encodeApprovals, encodeBatch, encodeEnvelope,
  encodeSignature, encodeSignatures, encodeSteps, encodeTerms, encodeWitness, felt, go, goTerms, hex, sign, span,
  standardTime, tag, termsMessageHash, termsTypedData,
} from './index.mjs';
import { encodeKifu } from './kifu.mjs';
import { GO, GO_RULES } from './rating.mjs';

export { NATIVE_CONFIRMATIONS, PROOF_VERSIONS, VIRTUAL_OS_PROGRAM, nativeProofBlock, reverted, rpc } from '@arbiter/sdk/proving';
export { SessionStore, memoryBackend, indexedDbBackend } from '@arbiter/sdk/store';
export { KeeperClient } from '@arbiter/sdk/keeper';
export { batchOf };
export { encodeKifu, decodeKifu } from './kifu.mjs';

const noAcks = [ZERO_SIGNATURE, ZERO_SIGNATURE];

export const decodeChannel = values => decodeChannelGame(go, values);
export const channelCall = proving.contractCall;
/**
 * What each player's wallet signs to agree to a game (`goTerms(...)`), and the
 * message hash its account checks (SNIP-12): sign `termsTypedData(go, terms)`
 * with the wallet (`account.signMessage`).
 */
export const goTermsTypedData = terms => termsTypedData(go, terms);
export const goTermsMessageHash = (terms, account) => termsMessageHash(go, terms, account);
/**
 * Open an unrated game on its `terms` (`goTerms(...)`, `ticket` 0) and both
 * wallets' signatures over them, each the array its wallet returns: the first
 * call of the transaction that first needs the chain. A ranked game's clock is
 * `rankedClock(await keeperReferee(keeperUrl))` (60 s per turn) or
 * `byoyomiClock(...)`; the keeper that referees it stamps every step.
 */
export const openGameCall = (terms, signatures) => proving.openGameCall(go, terms, signatures);
/**
 * Open a rated game: `terms` are the ticket's (`ratedTerms`): its players
 * (black then white), board and komi, clock, prover and response window, with
 * its digest in the config; `signature` is the matchmaker's over the ticket.
 */
export const openRatedGameCall = (terms, signatures, ticket, signature) =>
  channelCall(terms.channel, 'open_rated_game', [...encodeTerms(go, terms), BigInt(signatures.length),
    ...signatures.flatMap(s => [BigInt(s.length), ...s.map(felt)]), ...encodeTicket(ticket), ...encodeSignature(signature)]);
/**
 * `open_rated_game_delegable`: `openRatedGameCall` with each seat's approval,
 * its wallet's signature or, for a player signed in, a delegated approval
 * (`delegatedApproval(go, terms, seat, ...)`) whose delegation runs at most
 * `DELEGATION_SECONDS` more.
 */
export const openRatedGameDelegableCall = (terms, approvals, ticket, signature) =>
  channelCall(terms.channel, 'open_rated_game_delegable', [...encodeTerms(go, terms), ...encodeApprovals(approvals),
    ...encodeTicket(ticket), ...encodeSignature(signature)]);
/**
 * The longest a delegation Surround's channel takes may still run: a week's
 * sign-in, and an hour's slack. Keep it equal to `DELEGATION_SECONDS` in
 * src/systems/channel.cairo, or the matchmaker admits sign-ins the chain refuses.
 */
export const DELEGATION_SECONDS = 7 * 24 * 3600 + 3600;

// ---- Rated games: SurroundRatings, arbiter's ratings with Go's rules ----

/** A rated ticket's source: the quick-match queue or a brokered open table. */
export const { QUEUE, TABLE } = arbiterRatings;
/** Surround's one rated pool, 'go', as a felt: every board size shares it. */
export const GO_POOL = tag(GO);
/**
 * The tag of SurroundRatings' rules (`GoRatingRules::TAG`), in every ticket
 * digest and admin op, and of Go's rules (`GoRules::TAG`), in config hashes.
 */
export const RATINGS_TAG = GO_RULES.tag;
/**
 * The starting bands SurroundRatings allows new players in 'go' as deployed:
 * 23k, 17k and 6k (bit b for band b). The contract allows none until its owner
 * sets them (`setStartBandsCall`).
 */
export const GO_START_BANDS = 0b1110;
const TICKET_FIELDS = arbiterRatings.TICKET_FORMATS[arbiterRatings.PAIRING_V1];
const TICKET_NUMBERS = new Set(['response_seconds', 'source', 'band_0', 'band_1']);
/**
 * A rated pairing's Serde encoding, field for field `arbiter_ratings::Ticket`:
 * { chain_id, channel, player_0, player_1, pool, config, referee, clock,
 *   prover, response_seconds, source, band_0, band_1, matchmaker, issued_at,
 *   expires_at, nonce }. Seat 0 (`player_0`) plays black; `pool` is 'go'
 * (`GO_POOL`); `config` is the board and komi's hash (`goConfigHash`),
 * `referee` the key that referees the game and `clock` its settings' hash
 * (`clockHash`), so the ticket alone can't rebuild the game's terms: those
 * travel beside it (`ratedTerms`).
 */
export const encodeTicket = t => arbiterRatings.ticketFields(t);
/** A ticket from its Serde encoding (`encodeTicket`'s inverse), e.g. from a `TicketUsed` event. */
export const decodeTicket = values => arbiterRatings.decodeTicket(values);
/**
 * The message the matchmaker signs for a ticket: it binds the ratings contract
 * `ratings` that accepts it (the channel's `ratings()`), so a ticket is good on
 * one deployment only.
 */
export const ticketDigest = (t, ratings) => arbiterRatings.ticketDigest(t, RATINGS_TAG, ratings);
export const signTicket = (t, ratings, privateKey) => arbiterRatings.signTicket(t, RATINGS_TAG, ratings, privateKey);
/** The hash a ticket names a board and komi by (`arbiter::config_hash::<GoRules>` of the `GoConfig`, ticket 0). */
export const goConfigHash = (size, komi_half) =>
  arbiterRatings.configHash(go.tag, go.encodeConfig({ size: Number(size), komi_half: Number(komi_half), ticket: 0n }));
/** The hash a ticket names a clock's settings by, as `set_clock_preset` keys them: Poseidon over their Serde, no length. */
export const clockHash = settings => arbiterRatings.clockHash((go.time ?? standardTime).encodeSettings(settings));
const reviveSettings = s => ({ turn_ms: Number(s.turn_ms), bank_ms: Number(s.bank_ms), increment_ms: Number(s.increment_ms),
  byoyomi: s.byoyomi == null ? null : { periods: Number(s.byoyomi.periods), period_ms: Number(s.byoyomi.period_ms) } });
/**
 * What a ticket names only by hash, and the ratings contract its digest binds:
 * `{ ratings, size, komi_half, settings }`, the board and komi (`ticket.config`)
 * and the clock's settings (`ticket.clock`). The matchmaker sends it beside
 * every ticket (a pairing's `game`), as JSON (`ticketGameJson`).
 */
export const ticketGameJson = g => ({ ratings: hex(g.ratings), size: Number(g.size), komi_half: Number(g.komi_half),
  settings: reviveSettings(g.settings) });
export const reviveTicketGame = g => ({ ratings: felt(g.ratings), size: Number(g.size), komi_half: Number(g.komi_half),
  settings: reviveSettings(g.settings) });
/** A rated game's `ticketGame`, read from its terms and the ratings contract. */
export const ticketGameOf = (terms, ratings) => ({ ratings: felt(ratings), size: terms.config.size,
  komi_half: terms.config.komi_half, settings: terms.clock?.settings ?? null });
/**
 * A rated game's terms: the ticket's (players black then white, prover,
 * response window, the referee on a clock with no randomness tip) on the board,
 * komi and clock settings the ticket names by hash (`game`, a `ticketGame`),
 * which must hash to its `config` and `clock`; its digest for `game.ratings` in
 * the config; and the seats' session keys, black's then white's, which with the
 * players make the game's id (`gameIdOf`). Throws if `game` isn't the ticket's.
 * A player checks the terms the matchmaker sends against `ratedTerms(ticket,
 * terms.keys, game)` (or `isTicketTerms`) and its own key before its wallet
 * signs them.
 */
export function ratedTerms(ticket, keys, { ratings, size, komi_half, settings }) {
  if (arbiterRatings.poolId(ticket.pool) !== GO_POOL) throw Error('Not a ticket for Go\'s pool');
  if (goConfigHash(size, komi_half) !== felt(ticket.config)) throw Error('Not the ticket\'s board and komi');
  if (settings == null || clockHash(settings) !== felt(ticket.clock)) throw Error('Not the ticket\'s clock');
  return goTerms({ chain_id: ticket.chain_id, channel: ticket.channel, prover: ticket.prover,
    response_seconds: ticket.response_seconds, clock: { referee: ticket.referee, settings, rng_tip: 0n },
    players: [ticket.player_0, ticket.player_1], keys, size, komi_half, ticket: ticketDigest(ticket, ratings) });
}
/**
 * Whether `terms` are `ticket`'s game under the ratings contract `ratings`:
 * `ratedTerms` on the terms' own board, komi, clock and keys gives the same
 * context. It checks the ticket's hashes and its referee against the terms.
 */
export function isTicketTerms(terms, ticket, ratings) {
  try {
    return contextHash(go, terms) === contextHash(go, ratedTerms(ticket, terms.keys, ticketGameOf(terms, ratings)));
  } catch {
    return false;
  }
}
/** A ticket as JSON (felts as hex), and back. */
export const ticketJson = t => Object.fromEntries(TICKET_FIELDS.map(k =>
  [k, TICKET_NUMBERS.has(k) ? Number(t[k]) : hex(k === 'pool' ? arbiterRatings.poolId(t.pool) : t[k])]));
export const reviveTicket = t => Object.fromEntries(TICKET_FIELDS.map(k => [k, TICKET_NUMBERS.has(k) ? Number(t[k]) : felt(t[k])]));
/**
 * What a player's wallet signs for a matchmaker request (SNIP-12, revision 1):
 * `action` is 'queue', 'leave', 'table', 'join', 'close', 'anchor_key' (an
 * anchor offers a session key for a future game) or 'revoke' (sign a browser
 * out); `key` is the player's fresh session public key for the game it asks
 * for (queue, table, join and anchor_key), the browser key to revoke (0 for
 * all of them), or 0; `opponent` is always 0 (an AI game's request is
 * unsigned); `at` is Unix seconds; `nonce` is a random felt, never reused by
 * the player (the replay guard). The matchmaker verifies it through the
 * player's account contract, or, signed with `signRequest` by a signed-in
 * browser's key (`delegationTypedData`), against that key.
 */
export function matchmakerRequest({ chainId, action, player, size = 0, clock = '', band = 0, table = '', key = 0, opponent = 0, at, nonce }) {
  return {
    types: {
      StarknetDomain: [{ name: 'name', type: 'shortstring' }, { name: 'version', type: 'shortstring' },
        { name: 'chainId', type: 'shortstring' }, { name: 'revision', type: 'shortstring' }],
      Request: [{ name: 'action', type: 'shortstring' }, { name: 'player', type: 'ContractAddress' },
        { name: 'size', type: 'u128' }, { name: 'clock', type: 'shortstring' }, { name: 'band', type: 'u128' },
        { name: 'table', type: 'shortstring' }, { name: 'key', type: 'felt' }, { name: 'opponent', type: 'ContractAddress' },
        { name: 'at', type: 'timestamp' }, { name: 'nonce', type: 'felt' }],
    },
    primaryType: 'Request',
    domain: { name: 'Surround Matchmaker', version: '4', chainId: hex(chainId), revision: '1' },
    message: { action, player: hex(player), size: String(size), clock, band: String(band), table: String(table),
      key: hex(felt(key)), opponent: hex(felt(opponent)), at: String(at), nonce: hex(felt(nonce)) },
  };
}
/** A matchmaker request's SNIP-12 hash for `player`: what a wallet's account signs. */
export const requestHash = (typed, player) => BigInt(typedData.getMessageHash(typed, hex(felt(player))));
/**
 * A browser key's signature over a matchmaker request for `player`, once the
 * player's wallet delegated it: a plain Stark signature over `requestHash`.
 */
export function signRequest(typed, player, privateKey) {
  const { r, s } = sign(requestHash(typed, player), privateKey);
  return [hex(r), hex(s)];
}
/**
 * Report a settled rated game to SurroundRatings with its `ticket` (from the
 * contract's `TicketUsed` event, or the matchmaker) and mirror the new ratings
 * for Torii. Anyone may send it.
 */
export const rateCall = (channel, id, ticket) => arbiterRatings.rateCall(channel, id, ticket);
/** Mirror a player's current rating into this world's events. */
export const syncCall = (channel, player) => channelCall(channel, 'sync', [player]);
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
/**
 * A kifu's token id, its game's id, as the `u256` calldata the ERC-721 reads
 * take (`owner_of`, `token_uri`, `summary`, `svg`, `sgf`): low then high 128
 * bits. Game ids are the seats' hash, so the high half is rarely zero.
 */
export const kifuTokenId = id => [felt(id) & (1n << 128n) - 1n, felt(id) >> 128n];

/** The referee public key a keeper reports (`GET /info`), or null if it referees no games. */
export async function keeperReferee(url, { fetch = globalThis.fetch } = {}) {
  const response = await fetch(`${url.replace(/\/$/, '')}/info`);
  if (!response.ok) throw Error(`Keeper /info: HTTP ${response.status}`);
  const { referee } = parse(await response.text());
  return referee == null ? null : felt(referee);
}

/**
 * A player's rating in 'go' from SurroundRatings: μ and φ in Q32.32 logits
 * (see rating.mjs), the record, the rank `shown` in tenths (0 = 30k, 300 =
 * 1d, with the contract's offset) and "?". An anchor (an AI pinned at a fixed
 * rating) shows its pin, with no games. For another pool, use
 * `@arbiter/sdk/ratings`' `getPlayerRating`.
 */
export const getPlayerRating = (provider, ratings, player, block = 'latest') =>
  arbiterRatings.getPlayerRating(provider, ratings, GO_POOL, player, block);

/** An anchor's pinned μ (Q32.32) in 'go' from SurroundRatings, or null if `player` isn't one. */
export const getAnchor = (provider, ratings, player, block = 'latest') =>
  arbiterRatings.getAnchor(provider, ratings, GO_POOL, player, block);

// SurroundRatings' policy for 'go', as its owner sets it (each loosening waits
// for the timelock once the contract is sealed).
const FIELD = 2n ** 251n + 17n * 2n ** 192n + 1n;
const i64 = x => (BigInt(x) < 0n ? FIELD + BigInt(x) : BigInt(x));
/** Allow (or forbid) a clock's settings in rated games: `set_clock_preset` takes them serialized, with their length. */
export const setClockPresetCall = (ratings, settings, allowed = true) =>
  channelCall(ratings, 'set_clock_preset', [GO_POOL, ...span((go.time ?? standardTime).encodeSettings(settings)), allowed ? 1n : 0n]);
/** Allow (or forbid) a board and komi in rated games, by their config hash (`goConfigHash`). */
export const setConfigCall = (ratings, size, komi_half, allowed = true) =>
  channelCall(ratings, 'set_config', [GO_POOL, goConfigHash(size, komi_half), allowed ? 1n : 0n]);
/** The starting bands new players may choose: bit b for band b (`GO_START_BANDS`). */
export const setStartBandsCall = (ratings, bands = GO_START_BANDS) => channelCall(ratings, 'set_start_bands', [GO_POOL, bands]);
/** Pin a player never rated as an anchor at μ (Q32.32). */
export const setAnchorCall = (ratings, player, mu) => channelCall(ratings, 'set_anchor', [GO_POOL, player, i64(mu)]);
/** Shift every rank shown by `offset` tenths. */
export const setRankOffsetCall = (ratings, offset) => channelCall(ratings, 'set_rank_offset', [GO_POOL, i64(offset)]);
/** `ranks` for 'go': each player's `{ shown, provisional, rated }`, in order. */
export async function getRanks(provider, ratings, players, block = 'latest') {
  const r = (await provider.callContract(channelCall(ratings, 'ranks', [GO_POOL, players.length, ...players]), block)).map(BigInt);
  return players.map((_, i) => ({ shown: Number(r[1 + 3 * i]), provisional: r[2 + 3 * i] === 1n, rated: r[3 + 3 * i] === 1n }));
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
/** Prove a Go session with referee's proving client; see `@arbiter/sdk/proving`. */
export const proveSession = proving.proveSession;
