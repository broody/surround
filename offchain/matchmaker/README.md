# Matchmaker

Surround's matchmaker pairs players for rated games and reports settled games
to `SurroundRatings` ([plan](../../RANKING_PLAN.md), [hardening](../../HARDENING_PLAN.md) O1).
- **Quick match:** a queue. Each player is paired with the closest allowed rank
  on the same board and clock.
- **Open tables:** the host plays black; the matchmaker decides who may join.
- **Tickets:** for every pairing it signs a ticket that black passes to
  `create_rated_channel`.
- **Rating:** it follows `SurroundRatings`' `TicketUsed` events for its channel
  and sends `rate(game_id, ticket)` for each game once it settles.

```sh
MATCHMAKER_KEY=0x… MATCHMAKER_ACCOUNT_KEY=0x… node offchain/matchmaker/server.mjs config.json
node --test offchain/matchmaker/test/*.test.mjs
```

`config.example.json` has the Sepolia ratings world's addresses. Set:
- `referee`: the key of the keeper that referees rated games, and `keeper_url`,
  its HTTP address;
- `account.address`: the matchmaker's account, which pays for `rate`;
- `store`: the file that keeps its state (relative to the config file).

`SurroundRatings` must allowlist:
- the public key of `MATCHMAKER_KEY` (`set_matchmaker`);
- the referee key (`set_referee`);
- the clock settings in `clocks` (`set_clock_preset`);
- the komi in `boards` (`set_board`).

After `seal()`, adding any of these waits 48 hours, so allowlist a standby
matchmaker key before sealing.

## API

JSON, with felts as hex strings. A request that changes state carries `at`
(Unix seconds, within two minutes of the matchmaker's clock), `nonce` (a random
felt the player never uses again) and `signature`. The signature is the
player's wallet signature over the SDK's `matchmakerRequest(...)` typed data
(SNIP-12), which binds every field, the nonce included. The matchmaker checks
it through the player's account contract (`is_valid_signature`), so it works for
any Starknet account, Cartridge Controller included, and never needs a player
key. It refuses a nonce it has seen from that player, across restarts.

| Request | Body | Returns |
| --- | --- | --- |
| `GET /info` | | chain, channel, prover, matchmaker key, boards, clocks, the starting `bands` new players may choose, `min_table_games` |
| `POST /queue` | `player, size, clock, band` | `waiting`, or the ticket if paired at once |
| `POST /queue/leave` | `player` | `{ left }` |
| `GET /queue/:player` | | `none`, `waiting`, or `paired` with `ticket`, `signature`, `color` |
| `GET /tables` | | open tables |
| `POST /tables` | `player, size, clock, band` | `{ table }`, a random id |
| `POST /tables/:id/join` | `player, band` | the joiner's ticket |
| `POST /tables/:id/close` | `player` | `{ closed }` |
| `GET /health` | | `{ ok, pairing, stuck }`: whether pairing is open, and games it stopped trying to rate |

Black then:
1. revives the ticket (`reviveTicket`);
2. sends `createRatedChannelCall({ channel, ticket, signature, session_key })`.

White joins with `joinChannelCall` before the ticket expires.

## Rules

`rules` in the config; the defaults come from `pairing.mjs`.

- **Rank gap:** starts at 3 ranks and widens by 1 rank every 30 s, up to 9. Open
  tables allow up to 9.
- **Ranks:** a rated player's rank from `SurroundRatings`. A new player's comes
  from the starting band they choose, which must be one the contract's
  `start_bands()` allows (23k, 17k and 6k by default). There is no default band.
  A rated player's band isn't used and may be left out.
- **Colors:** the weaker player takes black; at equal rank, the one who waited
  longer does.
- **Repeat pairings:** the same two players at most twice a day.
- **Open games:** one unfinished rated game per player at a time. A game ends,
  for this, when it settles or is cancelled, not when it is rated.
- **Open tables:** hosts and joiners need `min_table_games` (5) rated games.
- **Referee capacity:** with `keeper_url`, it pairs only as many games as the
  keeper's `GET /info` reports free, less its tickets not yet joined. A keeper
  that doesn't answer has no room.
- **No-shows:** after the ticket expires (4 minutes), the player at fault waits
  15 minutes (`cooldown_ms`) before playing again:
  - black, if it never created the game, cancelled it, or created it later than
    `join_seconds` (60) before the deadline, too late for white to join;
  - otherwise white, who never joined.

  A cancellation is black's at once. Each pairing ends once, whatever reports
  it (`Lobby.finished` is keyed by the ticket's digest).
- **Aborts:** `SurroundRatings` voids a game settled from a transcript shorter
  than 20 steps (`GameVoided` reason 4). The matchmaker counts it against
  whoever lost it, both players in a draw. `abort_limit` (3) aborts within
  `abort_window_ms` (a day) cost `abort_cooldown_ms` (an hour).
- **Banned players** (`banned`, for example accounts caught using an engine)
  get no rated games. Games they already played stay rated.

## Rating

Each round (`poll_seconds`):
- it reads `SurroundRatings`' `TicketUsed` and `GameVoided` events for its
  channel from where it stopped (first `from_block`). `TicketUsed` carries the
  whole ticket and the game id;
- it reads each open game's status, and when white joined from the channel's
  `RatedGame` (`times`);
- it frees the players of every game that settled or was cancelled;
- it rates each settled game whose ticket `SurroundRatings` still holds as
  `ACCEPTED` (`ticket_status(digest)`), in batches:
  - a batch whose estimated fee is over `max_fee_fri` is halved, down to one
    game per transaction, so one expensive round never stops rating;
  - it retries until the ticket is `RATED` or `VOID`. After `max_rate_attempts`
    (3) attempts in a row that leave it unrated, it stops, logs an `ALERT` and
    lists the game in `GET /health` under `stuck`. Anyone may still rate it by
    hand, or set its `stuck` to false in the store to retry.

`rate` does nothing for a game that isn't rateable, and anyone can send it. So a
restart, the keeper's `afterSettle`, a second matchmaker, or a player rating
their own game can't double-count one.

## Restarts

`store` (a JSON file, replaced whole on each save) keeps what the chain can't
give back: unused tickets (they aren't in `TicketUsed` until used), open games
and pairings, cooldowns, aborts, the repeat history, the request replay guard
and the block it read to. A ticket is saved before either player sees it. The
queue and open tables aren't kept: players queue or host again.

If the store is lost, or on the very first start, the matchmaker rebuilds its
open games from `TicketUsed` since `from_block` and pairs no one for one ticket
life (5 minutes), until any ticket issued before is used or expired. Cooldowns
and aborts from before are forgotten. To start a new matchmaker key at once,
create the store file holding `{}`.

## Keeper hooks

[`keeper-hooks.mjs`](keeper-hooks.mjs) is Surround's game module for referee's
keeper (plan O2): the Go codec and two hooks.
- `admit(ids, terms)`: a game with a `RatedGame` ranks 1, others 0, so rated
  games get the keeper's reserved capacity (`reserved_games`) when it is near
  full.
- `afterSettle(ids, channel)`: `rate(game_id, ticket)` for a rated game, which
  the keeper sends with the resolve that settles it. The ticket comes from
  `SurroundRatings`' `TicketUsed` events, read from block
  `SURROUND_TICKETS_FROM_BLOCK` (default 0) once, then incrementally.

A keeper game entry for Surround's channel:

```json
{
  "channel": "0x…",
  "module": "../surround/offchain/matchmaker/keeper-hooks.mjs",
  "export": "go",
  "entrypoints": { "resolve": "resolve_dispute" },
  "max_steps": 1148,
  "world": "0x…",
  "namespace": "surround",
  "prover": { "url": "http://127.0.0.1:3100", "class_hash": "0x…" }
}
```

`max_steps` must hold Go's longest transcript on the largest board,
`maxSteps + 1` (19×19: 3 × 361 + 64 + 1 = 1148). Give the keeper a referee key
(`referee.private_key_env`) and a `reserved_games` share for rated games. The matchmaker still rates every
settled game the keeper didn't: one settled with both approvals, or by a
player's own transaction.

## Trust and limits

- **The matchmaker key decides who plays rated games together.** It can't change
  results or ratings, and the contract's policy fixes the referee, clock, komi,
  prover, response window and starting bands. Revoking the key
  (`revoke_matchmaker(key, at)`) voids the unrated games it paired from `at` on;
  retiring it (`retire_matchmaker`) only stops new tickets.
- **The store holds no secrets,** but losing it pauses pairing for a ticket
  life, and editing it can free busy players. Keep it on the matchmaker's host.
- **`GET /queue/:player` is unauthenticated** (RT-I1): anyone can read a
  player's ticket, but only black can create the game from it.
- **There is no rate limit on requests,** and each signed request costs one RPC
  call to verify. Put it behind a proxy that limits by client.
