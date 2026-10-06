// The matchmaker's view of Starknet: players' ranks, records and the starting
// bands from SurroundRatings, the tickets its channel accepted and the games
// it voided (SurroundRatings' TicketUsed and GameVoided events), each game's
// channel status and `RatedGame`, and `rate` calls sent from the matchmaker's
// own account. Any object with the same methods can stand in for it (the
// tests use a fake).
import { Account, RpcProvider, hash } from '../sdk/node_modules/starknet/dist/index.mjs';
import * as p from '../sdk/src/index.mjs';
import * as c from '../sdk/src/client.mjs';

/** SurroundRatings' `ticket_status` values. */
export const NONE = 0, ACCEPTED = 1, RATED = 2, VOID = 3;
/** `GameVoided.reason` for a game too short to rate: an abort. */
export const VOID_SHORT = 4;

export const TICKET_USED = BigInt(hash.getSelectorFromName('TicketUsed'));
export const GAME_VOIDED = BigInt(hash.getSelectorFromName('GameVoided'));

// The channel's `RatedGame` model, field by field. Only `ratedGame` reads it,
// so a change to the model changes only this list (R0).
const RATED_GAME = ['game_id', 'ticket'];

/**
 * A `RatedGame` from its Serde felts (the channel's `rated_game`), by field
 * name: the ticket's digest (zero for an unrated game).
 */
export function ratedGame(values) {
  return Object.fromEntries(RATED_GAME.map((name, i) => [name, BigInt(values[i])]));
}

/** A ticket from its Serde encoding: the SDK's `decodeTicket`. */
export const decodeTicket = c.decodeTicket;

/** A TicketUsed or GameVoided event from RPC `{ keys, data }`, decoded; null for any other. */
export function ratingEvent({ keys, data, block_number }) {
  const k = keys.map(BigInt), d = data.map(BigInt);
  if (k[0] === TICKET_USED) return { type: 'TicketUsed', digest: k[1], channel: k[2], game_id: d[0], ticket: decodeTicket(d.slice(1)), block: block_number };
  if (k[0] === GAME_VOIDED) return { type: 'GameVoided', digest: k[1], channel: d[0], game_id: d[1], reason: Number(d[2]), block: block_number };
  return null;
}

/** Every page of `getEvents` for `filter`, from block `from` to block `to` (a number or 'latest'). */
export async function allEvents(provider, filter, from, to) {
  const events = [];
  let continuation_token;
  do {
    const page = await provider.getEvents({ ...filter, from_block: { block_number: from },
      to_block: to === 'latest' ? 'latest' : { block_number: to }, chunk_size: 1000, continuation_token });
    events.push(...page.events);
    continuation_token = page.continuation_token;
  } while (continuation_token);
  return events;
}

export function starknetChain({ rpc_url, channel, ratings, account = null }) {
  const provider = new RpcProvider({ nodeUrl: rpc_url });
  const signer = account && new Account({ provider, address: account.address, signer: account.privateKey });
  const call = async (entrypoint, calldata = [], contract = channel) =>
    (await provider.callContract(c.channelCall(contract, entrypoint, calldata))).map(BigInt);
  const rateCalls = games => games.map(g => c.rateCall(channel, g.game_id, g.ticket));
  const readRatedGame = async gameId => ratedGame(await call('rated_game', [gameId]));
  return {
    provider,
    /** Unix seconds at the chain's head. */
    async now() { return BigInt((await provider.getBlockWithTxHashes('latest')).timestamp); },
    /** player -> { rank_tenths, provisional, rated } */
    async ranks(players) {
      const r = await call('ranks', [players.length, ...players], ratings);
      return new Map(players.map((x, i) => [x, { rank_tenths: Number(r[1 + 3 * i]), provisional: r[2 + 3 * i] === 1n, rated: r[3 + 3 * i] === 1n }]));
    },
    /** An anchor's pinned μ (Q32.32), or null if `player` isn't one. */
    async anchor(player) { return c.getAnchor(provider, ratings, player); },
    /** `player`'s rating and record (SurroundRatings `player`, see the SDK's `getPlayerRating`). */
    async player(player) { return c.getPlayerRating(provider, ratings, player); },
    /**
     * Whether an account contract is deployed at `player`. A wallet's account
     * is deployed with its first transaction; until then its signatures can't
     * be checked, so it can't play rated games.
     */
    async deployed(player) {
      try { await provider.getClassHashAt(player); return true; }
      // RPC error 20: CONTRACT_NOT_FOUND.
      catch (e) { if (e.baseError?.code === 20) return false; throw e; }
    },
    /** How many rated games `player` has played (wins, losses and draws). */
    async games(player) { return (await c.getPlayerRating(provider, ratings, player)).games; },
    /** The starting bands a new player may choose: bit b for band b. */
    async startBands() { return Number((await call('start_bands', [], ratings))[0]); },
    /**
     * SurroundRatings' TicketUsed events (a rated game opened, usually in the
     * transaction that settles it) and GameVoided events for this channel,
     * from block `from` on, in chain order, and the block scanned to.
     */
    async ratingEvents(from) {
      const to = await provider.getBlockNumber();
      if (from > to) return { events: [], to: from - 1 };
      const raw = await allEvents(provider, { address: p.hex(ratings), keys: [[p.hex(TICKET_USED), p.hex(GAME_VOIDED)]] }, from, to);
      return { events: raw.map(ratingEvent).filter(e => e && e.channel === BigInt(channel)), to };
    },
    /**
     * A game's channel status (0 for a game nobody opened yet, 4 settled) and
     * winner (1 black, 2 white, 0 a draw).
     */
    async game(gameId) {
      let g;
      try { g = await c.getChannel(provider, channel, gameId); }
      catch (e) { if (c.reverted(e, 'Unknown channel')) return { status: 0, winner: 0 }; throw e; }
      return { status: g.status, winner: g.result.winner };
    },
    ratedGame: readRatedGame,
    /** SurroundRatings' record of a ticket: its status (NONE, ACCEPTED, RATED or VOID) and game. */
    async ticketStatus(digest) {
      const [status, game_id] = await call('ticket_status', [digest], ratings);
      return { status: Number(status), game_id };
    },
    /** The fee (FRI) of rating `games` ([{ game_id, ticket }]) in one transaction, with its resource bounds. */
    async estimateRate(games) {
      if (!signer) throw Error('The matchmaker needs an account to send rate');
      const estimate = await signer.estimateInvokeFee(rateCalls(games), { tip: 0n });
      return { fee: BigInt(estimate.overall_fee), resourceBounds: estimate.resourceBounds };
    },
    /** Rate `games` in one transaction within `estimate`'s bounds; returns its hash. */
    async rate(games, estimate) {
      const tx = await signer.execute(rateCalls(games), { tip: 0n, resourceBounds: estimate.resourceBounds });
      const receipt = await provider.waitForTransaction(tx.transaction_hash, { retryInterval: 1000 });
      if (receipt.execution_status !== 'SUCCEEDED') throw Error(`rate reverted: ${receipt.revert_reason}`);
      return tx.transaction_hash;
    },
    /** Whether `player`'s account signed `typedData` (SNIP-12, through the account contract). */
    verify(player, typedData, signature) { return provider.verifyMessageInStarknet(typedData, signature, player); },
  };
}
