// Replay every rating from SurroundRatings' events and check them: arbiter's
// replay (`verifyRatings` in `@arbiter/sdk/ratings`) under Go's rules
// (rating.mjs's `GO_RULES`), reported for Surround's one pool, 'go'.
//
// Each rated game emits two `RatingUpdated` events, black's (seat 0's) then
// white's, each with the side's state before and after. `verifyRatings`
// checks both things the events allow:
//   - each game on its own: from the two pre-game states and the game's ticket
//     (`TicketUsed`), the update `rating.mjs` computes, under the contract's
//     rule for short games, gives the post-game states, `applied` flags, bands
//     and ranks shown that the events report;
//   - the chain: each side's pre-game state is the player's previous
//     post-game state, in event order.
// Events must be in chain order, not by `played_at`: a game rated late uses the
// players' states at the time it was rated. Each game replays under the rules
// of the version its events carry (`params`): `RULES` maps each to its rules.
//
// An anchor (an AI pinned with `set_anchor`, announced by a `PolicySet` of kind
// 'anchor') is never updated: its side shows its pin before and after, and the
// opponent is rated against it. `anchors` reports how each anchor scores
// against established players, the signal for re-pinning it.
//
//   node offchain/sdk/src/replay.mjs RPC_URL RATINGS_ADDRESS [FROM_BLOCK]
import { RpcProvider } from 'starknet';
import { pathToFileURL } from 'node:url';
import { tag } from '@arbiter/sdk';
import * as engine from '@arbiter/sdk/ratings';
import { GO, GO_RULES, MIN_RATED_STEPS, PARAMS } from './rating.mjs';

export { MIN_RATED_STEPS };
export const { decodeEvent, fetchRatingEvents } = engine;

/** Go's rules by version (`params`): every version SurroundRatings has rated under on this code. */
export const RULES = Object.freeze({ [PARAMS]: GO_RULES });
const GO_ID = tag(GO);

/**
 * Check a sequence of decoded events (`decodeEvent`), in chain order, under
 * `rules` (by version, `RULES` by default). Returns `{ ok, errors, players,
 * games, newcomers, anchors }` for the 'go' pool, where `players` maps each
 * address to its replayed state `{ rating, wins, losses, draws }`, `errors`
 * lists `{ digest, pool, player, what }`, and `newcomers` is the drift signal
 * below.
 *
 * `newcomers` compares newcomers' first games against established players
 * with the prediction: `{ games, expected, won }`, in points. New players
 * start at fixed band values, so if the rated pool drifts down, established
 * players are stronger than their ratings and newcomers score less than
 * expected. The gap (won − expected) / games, turned into rank tenths, is what
 * `set_rank_offset` should add (HARDENING_PLAN.md T8).
 */
export function verifyRatings(events, rules = RULES) {
  const { ok, errors, games, players, newcomers, anchors } = engine.verifyRatings(events, rules);
  return { ok, errors, games, players: players.get(GO_ID) ?? new Map(),
    newcomers: newcomers.get(GO_ID) ?? { games: 0, expected: 0, won: 0 }, anchors: anchors.get(GO_ID) ?? new Map() };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [rpcUrl, address, fromBlock = '0'] = process.argv.slice(2);
  if (!rpcUrl || !address) { console.error('usage: node replay.mjs RPC_URL RATINGS_ADDRESS [FROM_BLOCK]'); process.exit(2); }
  const events = await fetchRatingEvents(new RpcProvider({ nodeUrl: rpcUrl }), address, Number(fromBlock));
  const { ok, errors, players, games, newcomers, anchors } = verifyRatings(events);
  console.log(JSON.stringify({ ok, games, players: players.size, newcomers, anchors: Object.fromEntries([...anchors].map(([k, v]) => [`0x${k.toString(16)}`, v])),
    errors: errors.slice(0, 20) },
    (_, v) => (typeof v === 'bigint' ? `0x${v.toString(16)}` : v)));
  process.exit(ok ? 0 : 1);
}
