// Replay every rating from SurroundRatings' events and check them.
//
// Each rated game emits two `RatingUpdated` events, black's then white's, each
// with the side's state before and after. `verifyRatings` checks both things
// the events allow:
//   - each game on its own: from the two pre-game states and the game's ticket
//     (`TicketUsed`), the update `rating.mjs` computes, under the contract's
//     rule for short games, gives the post-game states and `applied` flags the
//     events report;
//   - the chain: each side's pre-game state is the player's previous
//     post-game state, in event order.
// Events must be in chain order, not by `played_at`: a game rated late uses the
// players' states at the time it was rated.
//
//   node offchain/sdk/src/replay.mjs RPC_URL RATINGS_ADDRESS [FROM_BLOCK]
import { hash, RpcProvider } from 'starknet';
import { pathToFileURL } from 'node:url';
import { decodeTicket } from './client.mjs';
import * as r from './rating.mjs';

/** Games shorter than this are void unless forfeited onchain (`ratings::MIN_RATED_STEPS`). */
export const MIN_RATED_STEPS = 20;
const PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const signed = v => (BigInt(v) > (1n << 250n) ? BigInt(v) - PRIME : BigInt(v));
const same = (a, b) => a.mu === b.mu && a.phi === b.phi && a.last === b.last;

/**
 * Check a sequence of decoded events (`decodeEvent`), in chain order. Returns
 * `{ ok, errors, players, games, newcomers }`, where `players` maps each
 * address to its replayed state, `errors` lists `{ digest, player, what }`,
 * and `newcomers` is the drift signal below.
 *
 * `newcomers` compares newcomers' first games against established players
 * with the prediction: `{ games, expected, won }`, in points. New players
 * start at fixed band values, so if the rated pool drifts down, established
 * players are stronger than their ratings and newcomers score less than
 * expected. The gap (won − expected) / games, turned into rank tenths, is what
 * `set_rank_offset` should add (HARDENING_PLAN.md T8).
 */
export function verifyRatings(events) {
  const tickets = new Map(), players = new Map(), errors = [];
  const pending = new Map();
  const newcomers = { games: 0, expected: 0, won: 0 };
  let games = 0;
  const stateOf = player => players.get(player) ?? { rating: { mu: 0n, phi: 0n, last: 0n }, wins: 0, losses: 0, draws: 0 };
  const fail = (digest, player, what) => errors.push({ digest, player, what });

  for (const e of events) {
    if (e.type === 'TicketUsed') tickets.set(e.digest, e);
    if (e.type !== 'RatingUpdated') continue;
    const first = pending.get(e.digest);
    if (!first) { pending.set(e.digest, e); continue; }
    pending.delete(e.digest);
    games++;
    const [black, white] = [first, e];
    const ticket = tickets.get(e.digest);
    if (!ticket) { fail(e.digest, null, 'no TicketUsed before its rating'); continue; }
    if (black.player !== ticket.ticket.black || white.player !== ticket.ticket.white) {
      fail(e.digest, null, 'events name other players than the ticket');
      continue;
    }
    const sides = [[black, ticket.ticket.black_band], [white, ticket.ticket.white_band]];
    // The chain: each pre-game state is the player's last post-game state.
    for (const [side] of sides) {
      const known = stateOf(side.player).rating;
      if (!same(known, pre(side))) fail(e.digest, side.player, 'pre-game state is not the previous post-game state');
      if (side.params !== r.PARAMS) fail(e.digest, side.player, `params ${side.params}, expected ${r.PARAMS}`);
    }
    // The game on its own.
    const t = black.played_at, score = black.score;
    const [bs, ws] = sides.map(([side, band]) => {
      const before = pre(side), isNew = before.phi === 0n;
      return { side, before, isNew, start: isNew ? r.start(band) : before };
    });
    // A short onchain forfeit counts only for the loser.
    const short = black.steps < MIN_RATED_STEPS;
    const applyBlack = !short || score === 0, applyWhite = !short || score === 2;
    const { black: nb, white: nw, p } = r.update(bs.start, ws.start, score, t);
    // Drift: a newcomer's first game against an established player.
    const established = x => (stateOf(x.side.player).wins + stateOf(x.side.player).losses + stateOf(x.side.player).draws) >= r.SETTLED_GAMES;
    if (!short && bs.isNew !== ws.isNew && established(bs.isNew ? ws : bs)) {
      const newBlack = bs.isNew, pBlack = Number(p) / 2 ** 32;
      newcomers.games++;
      newcomers.expected += newBlack ? pBlack : 1 - pBlack;
      newcomers.won += (newBlack ? score : 2 - score) / 2;
    }
    for (const [x, apply, after, points] of [[bs, applyBlack, nb, score], [ws, applyWhite, nw, 2 - score]]) {
      const end = apply ? after : x.isNew ? x.before : r.age(x.before, t);
      if (x.side.applied !== apply) fail(e.digest, x.side.player, `applied ${x.side.applied}, expected ${apply}`);
      if (!same(end, post(x.side))) fail(e.digest, x.side.player, 'post-game state differs from the update');
      const state = stateOf(x.side.player);
      const next = { ...state, rating: post(x.side) };
      if (apply) {
        if (points === 0) next.losses++;
        else if (points === 1) next.draws++;
        else next.wins++;
      }
      players.set(x.side.player, next);
    }
  }
  for (const [digest, side] of pending) fail(digest, side.player, 'a rating with no opposite side');
  return { ok: errors.length === 0, errors, players, games, newcomers };
}

const pre = side => ({ mu: side.pre_mu, phi: side.pre_phi, last: side.pre_last });
const post = side => ({ mu: side.mu, phi: side.phi, last: side.last_played });

const SELECTORS = Object.fromEntries(['RatingUpdated', 'TicketUsed', 'GameVoided', 'PolicySet']
  .map(name => [BigInt(hash.getSelectorFromName(name)), name]));

/**
 * One SurroundRatings event from RPC `{ keys, data }`, decoded, or null for
 * another event. Signed values (μ) come back as BigInt.
 */
export function decodeEvent({ keys, data }) {
  const type = SELECTORS[BigInt(keys[0])];
  const k = keys.map(BigInt), d = data.map(BigInt);
  if (type === 'RatingUpdated') {
    const [channel, game_id, opponent, score, source, steps, played_at, params, band, applied,
      pre_mu, pre_phi, pre_last, mu, phi, last_played, rank_tenths] = d;
    return { type, player: k[1], digest: k[2], channel, game_id, opponent, score: Number(score), source: Number(source),
      steps: Number(steps), played_at, params: Number(params), band: Number(band), applied: applied === 1n,
      pre_mu: signed(pre_mu), pre_phi, pre_last, mu: signed(mu), phi, last_played, rank_tenths: Number(rank_tenths) };
  }
  // The whole ticket, as `rateCall` takes it.
  if (type === 'TicketUsed') return { type, digest: k[1], channel: k[2], game_id: d[0], ticket: decodeTicket(d.slice(1)) };
  if (type === 'GameVoided') return { type, digest: k[1], channel: d[0], game_id: d[1], reason: Number(d[2]) };
  if (type === 'PolicySet') return { type, kind: k[1], value: d[0], extra: d[1], allowed: d[2] === 1n };
  return null;
}

/** Every SurroundRatings event at `address` from `fromBlock`, decoded, in chain order. */
export async function fetchRatingEvents(provider, address, fromBlock = 0) {
  const events = [];
  let continuation_token;
  do {
    const page = await provider.getEvents({ address, from_block: { block_number: fromBlock }, to_block: 'latest',
      chunk_size: 1000, continuation_token });
    for (const event of page.events) {
      const decoded = decodeEvent(event);
      if (decoded) events.push({ ...decoded, block: event.block_number, tx: event.transaction_hash });
    }
    continuation_token = page.continuation_token;
  } while (continuation_token);
  return events;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [rpcUrl, address, fromBlock = '0'] = process.argv.slice(2);
  if (!rpcUrl || !address) { console.error('usage: node replay.mjs RPC_URL RATINGS_ADDRESS [FROM_BLOCK]'); process.exit(2); }
  const events = await fetchRatingEvents(new RpcProvider({ nodeUrl: rpcUrl }), address, Number(fromBlock));
  const { ok, errors, players, games, newcomers } = verifyRatings(events);
  console.log(JSON.stringify({ ok, games, players: players.size, newcomers, errors: errors.slice(0, 20) },
    (_, v) => (typeof v === 'bigint' ? `0x${v.toString(16)}` : v)));
  process.exit(ok ? 0 : 1);
}
