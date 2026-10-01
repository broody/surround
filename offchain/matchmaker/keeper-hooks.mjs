// Surround's game module for arbiter's keeper (HARDENING_PLAN.md, O2): the Go
// codec, and the hooks a keeper game entry may export beside it. Point an
// entry at this file with `"export": "go"` (see README.md).
//   admit        rated games (whose signed terms carry a ticket digest) rank
//                first for the keeper's reserved capacity;
//   openCall     the call that opens a game nobody opened yet, in the
//                transaction that settles it: `open_rated_game` with the
//                ticket and the matchmaker's signature the game registered
//                with (`extras: { ticket, signature }`), else `open_game`;
//   afterSettle  the `rate(game_id, ticket)` call for a rated game the keeper
//                settles, sent with the resolve that settles it. The ticket
//                comes from SurroundRatings' `TicketUsed` events, read from
//                block SURROUND_TICKETS_FROM_BLOCK (default 0) on, once, then
//                incrementally.
import * as p from '../sdk/src/index.mjs';
import * as c from '../sdk/src/client.mjs';
import { TICKET_USED, allEvents, ratedGame, ratingEvent } from './chain.mjs';

export { go } from '../sdk/src/index.mjs';

const read = async (provider, contract, entrypoint, calldata = []) =>
  (await provider.callContract(c.channelCall(contract, entrypoint, calldata))).map(BigInt);
const ratedGameOf = async (provider, channel, gameId) => ratedGame(await read(provider, channel, 'rated_game', [gameId]));

/** Priority for the keeper's reserved capacity: 1 for a rated game, 0 otherwise. */
export async function admit(ids, terms) {
  return p.felt(terms.config.ticket ?? 0) !== 0n ? 1 : 0;
}

/**
 * The call that opens a game nobody opened yet. A rated game opens with its
 * ticket and the matchmaker's signature, which it registered with as
 * `extras: { ticket: ticketJson(ticket), signature: { r, s } }`.
 */
export async function openCall(ids, terms, { signatures, extras }) {
  const digest = p.felt(terms.config.ticket ?? 0);
  if (digest === 0n) return c.openGameCall(terms, signatures);
  if (!extras?.ticket || !extras?.signature) throw Error(`Rated game ${p.hex(ids.game_id)} registered without its ticket`);
  const ticket = c.reviveTicket(extras.ticket);
  if (c.ticketDigest(ticket) !== digest) throw Error(`The ticket game ${p.hex(ids.game_id)} registered with is not its terms'`);
  const signature = { r: p.felt(extras.signature.r), s: p.felt(extras.signature.s) };
  return c.openRatedGameCall(terms, signatures, ticket, signature);
}

/** The calls to send with the resolve that settles a game: `rate` for a rated game, none otherwise. */
export async function afterSettle(ids, channel, { provider }) {
  const game = await ratedGameOf(provider, ids.channel, ids.game_id);
  if (game.ticket === 0n) return [];
  const ticket = await ticketOf(provider, ids.channel, game.ticket);
  if (!ticket) throw Error(`No TicketUsed for ticket ${p.hex(game.ticket)} of game ${p.hex(ids.game_id)}`);
  return [c.rateCall(ids.channel, ids.game_id, ticket)];
}

// Per channel: its ratings contract, the next block to scan, and the tickets
// seen and not yet used, by digest.
const scans = new Map();

/** The ticket with this digest that `channel` accepted, from `TicketUsed`; null if there is none. */
async function ticketOf(provider, channel, digest) {
  const from = Number(process.env.SURROUND_TICKETS_FROM_BLOCK ?? 0);
  let scan = scans.get(channel);
  if (!scan) scans.set(channel, scan = { ratings: (await read(provider, channel, 'ratings'))[0], next: from, tickets: new Map() });
  const used = async (digests, since, to) => (await allEvents(provider,
    { address: p.hex(scan.ratings), keys: [[p.hex(TICKET_USED)], digests.map(p.hex), [p.hex(channel)]] }, since, to))
    .map(ratingEvent).filter(e => e?.type === 'TicketUsed');
  if (!scan.tickets.has(digest)) {
    const to = await provider.getBlockNumber();
    if (scan.next <= to) for (const e of await used([], scan.next, to)) scan.tickets.set(e.digest, e.ticket);
    scan.next = Math.max(scan.next, to + 1);
  }
  // A game settles once, but a resolve that failed is tried again: then look its ticket up alone.
  const ticket = scan.tickets.get(digest) ?? (await used([digest], from, 'latest'))[0]?.ticket ?? null;
  scan.tickets.delete(digest);
  return ticket;
}
