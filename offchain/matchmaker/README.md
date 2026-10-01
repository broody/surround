# Matchmaker

Surround's matchmaker pairs players for rated games, brokers each game's
agreement, and reports settled games to `SurroundRatings`
([plan](../../RANKING_PLAN.md), [hardening](../../HARDENING_PLAN.md) O1).
- **Quick match:** a queue. Each player is paired with the closest allowed rank
  on the same board and clock.
- **Open tables:** the host plays black; the matchmaker decides who may join.
- **Tickets and terms:** for every pairing it signs a ticket, picks a keeper to
  referee the game, and builds the game's terms from the ticket and both
  players' session keys. Both wallets sign the terms, and the matchmaker
  registers the game with its keeper. Nothing goes onchain until the game
  settles: the keeper then opens it with `open_rated_game` in the transaction
  that settles it.
- **Rating:** it follows `SurroundRatings`' `TicketUsed` events for its channel
  and sends `rate(game_id, ticket)` for each game once it settles, unless the
  keeper's `afterSettle` already did.

One matchmaker serves every region; keepers may run in several.

```sh
MATCHMAKER_KEY=0x… MATCHMAKER_ACCOUNT_KEY=0x… node offchain/matchmaker/server.mjs config.json
node --test offchain/matchmaker/test/*.test.mjs
```

`config.example.json` has the Sepolia ratings world's addresses. Set:
- `keepers`: the keepers that referee rated games, in order of preference, each
  `{ url, referee }`, `referee` being its referee public key (`referee` in its
  `GET /info`). An older config's `keeper_url` and `referee` count as a list of
  one;
- `clocks`: each clock preset's time control settings. A ticket's clock is
  `{ referee, settings, rng_tip: 0 }`, `referee` being its keeper's;
- `sign_seconds` (60; `join_seconds` is its old name): how long both players
  have to sign the terms once paired;
- `ticket_seconds` (240): a ticket's life. It must exceed `sign_seconds` plus
  the keepers' `start_grace_seconds` (120 by default): a game must start, at its
  referee's first stamp, inside its ticket's window, and a referee starts the
  clock itself only after that grace. Tickets are dated on the chain's clock
  (the latest block), stamps on the referee's: `issued_at` is a minute early
  and `SurroundRatings` allows 60 s of skew, so the two clocks may differ by
  up to two minutes. Don't tighten either without the other;
- `account.address`: the matchmaker's account, which pays for `rate`;
- `store`: the file that keeps its state (relative to the config file).

`SurroundRatings` must allowlist:
- the public key of `MATCHMAKER_KEY` (`set_matchmaker`);
- every keeper's referee key (`set_referee`);
- the clock settings in `clocks` (`set_clock_preset`);
- the komi in `boards` (`set_board`).

After `seal()`, adding any of these waits 48 hours, so allowlist a standby
matchmaker key, and the referee key of any keeper you may add, before sealing.

## A rated game

1. Each player queues (or hosts or joins a table) with a fresh session key,
   `key`, the public key it will sign its moves with.
2. Once paired, `GET /queue/:player` returns the ticket, the matchmaker's
   signature over it, and the game's `terms`, `game_id` and `keeper`. The terms
   are the ticket's (players black then white, board, komi, clock, prover,
   response window), carry its digest in `config.ticket`, and hold both
   session keys; the game id is the seats' (`gameIdOf(players, keys)`), the
   only one the channel opens the game under. The client checks them
   before signing:
   - revive both: `reviveTicket(ticket)`, and `goTerms({ ...terms, ...terms.config })`;
   - the terms must equal `ratedTerms(ticket, terms.keys)`;
   - its own session key must be at its seat (`color`);
   - the clock's referee is the keeper's (its `GET /info`).
3. Its wallet signs `goTermsTypedData(terms)`, and the client sends the
   signature to `POST /games/:digest/sign` within `sign_seconds`.
4. With both signatures in, the matchmaker registers the game with its keeper
   (`register(goSession(terms), { authorizations, extras })`): the
   authorizations are both wallets' signatures in seat order, and the extras
   the ticket and the matchmaker's signature, which the keeper's `openCall` hook
   opens the game with. The status then says `ready`.
5. The players play through the keeper (`KeeperClient`), which stamps every
   step and starts the clock itself if nobody moves within its start grace.
   When the game ends, the keeper opens it and settles it onchain, and rates it.

## API

JSON, with felts as hex strings. A lobby request (queue, leave, table, join,
close) carries `at` (Unix seconds, within two minutes of the matchmaker's
clock), `nonce` (a random felt the player never uses again) and `signature`.
The signature is the player's wallet signature over the SDK's
`matchmakerRequest(...)` typed data (SNIP-12), which binds every field, the
session `key` and the nonce included (`key` is 0 for leave and close). The
matchmaker checks it through the player's account contract
(`is_valid_signature`), so it works for any Starknet account, Cartridge
Controller included, and never needs a player key. It refuses a nonce it has
seen from that player, across restarts.

| Request | Body | Returns |
| --- | --- | --- |
| `GET /info` | | chain, channel, prover, matchmaker key, boards, clock settings, `keepers`, `sign_seconds`, the starting `bands` new players may choose, `min_table_games` |
| `POST /queue` | `player, key, size, clock, band` | `waiting`, or the pairing if paired at once |
| `POST /queue/leave` | `player` | `{ left }` |
| `GET /queue/:player` | | `none`, `waiting`, or `paired` (below) |
| `POST /games/:digest/sign` | `player, signature` | the player's status |
| `GET /tables` | | open tables |
| `POST /tables` | `player, key, size, clock, band` | `{ table }`, a random id |
| `POST /tables/:id/join` | `player, key, band` | the joiner's status |
| `POST /tables/:id/close` | `player` | `{ closed }` |
| `GET /health` | | `{ ok, pairing, stuck }`: whether pairing is open, and games it stopped trying to rate |

A paired player's status, until the game is over: `color`, `ticket`,
`signature` (the matchmaker's, `{ r, s }`), `digest`, `game_id`, `terms`,
`keeper` (its URL), `sign_by` (milliseconds), `signed: { black, white }` and
`ready` (the keeper holds the game).

`POST /games/:digest/sign` takes the wallet's signature as it returned it (an
array of felts, or `{ r, s }`). The signature authenticates the request: the
matchmaker checks it through the player's account against the terms' typed
data, and refuses anyone but the pairing's two players (401). After `sign_by`,
a player who hasn't signed is refused (409).

A session key that another player waiting, hosting a table or paired already
uses is refused (409, `Session key in use`): the two seats of a game must not
share one.

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
  for this, when its keeper's copy is finished or the chain shows it settled,
  not when it is rated.
- **Open tables:** hosts and joiners need `min_table_games` (5) rated games.
- **Keepers:** each pairing goes to the first keeper, in config order, with
  room: its `GET /info` free capacity, less this matchmaker's games it doesn't
  hold yet (paired, not registered). A keeper that doesn't answer, or that
  reports another referee key than configured, has no room. With no room
  anywhere, nobody is paired.
- **No-shows:** a player who hasn't signed the terms `sign_seconds` (60) after
  pairing waits 15 minutes (`cooldown_ms`) before playing again; both, if
  neither signed. The pairing ends and the other player is free.
- **Keepers that don't take a game:** a registration that fails is retried each
  round until the ticket expires; then the pairing ends, nobody at fault. A
  registered game its keeper doesn't hold 30 s after its ticket expired is over,
  nobody at fault. Each pairing ends once, whatever reports it
  (`Lobby.finished` is keyed by the ticket's digest).
- **Aborts:** `SurroundRatings` voids a game settled from a transcript shorter
  than 20 steps (`GameVoided` reason 4), unless it was forfeited onchain. The
  matchmaker counts it against whoever lost it, both players in a draw.
  `abort_limit` (3) aborts within `abort_window_ms` (a day) cost
  `abort_cooldown_ms` (an hour). A game is dated by when it started (its
  referee's first stamp); one that never started, or started outside its
  ticket's window (60 s of skew allowed), is void.
- **Banned players** (`banned`, for example accounts caught using an engine)
  get no rated games. Games they already played stay rated.

## Following games

Each round (`poll_seconds`):
- it reads `SurroundRatings`' `TicketUsed` and `GameVoided` events for its
  channel from where it stopped (first `from_block`). `TicketUsed` carries the
  whole ticket and the game id; a game opens, and so emits it, usually in the
  transaction that settles it;
- it registers each game both players signed that its keeper doesn't hold yet,
  and ends each pairing whose time to sign ran out;
- it follows each registered game on its keeper
  (`GET /games/:channel/:game`, then its new steps), verifying every step, and
  frees the players as soon as the keeper's copy is finished;
- it reads each opened game's channel status, and frees the players of every
  game that settled;
- it rates each settled game whose ticket `SurroundRatings` still holds as
  `ACCEPTED` (`ticket_status(digest)`), in batches:
  - a batch whose estimated fee is over `max_fee_fri` is halved, down to one
    game per transaction, so one expensive round never stops rating;
  - it retries until the ticket is `RATED` or `VOID`. After `max_rate_attempts`
    (3) attempts in a row that leave it unrated, it stops, logs an `ALERT` and
    lists the game in `GET /health` under `stuck`. Anyone may still rate it by
    hand, or set its `stuck` to false in the store to retry.

`rate` does nothing for a game that isn't rateable, and anyone can send it. So a
restart, the keeper's `afterSettle` (which usually rates a game first), a
second matchmaker, or a player rating their own game can't double-count one.

## Restarts

`store` (a JSON file, replaced whole on each save) keeps what the chain can't
give back: every pairing still in play (its ticket, terms, keeper, the
signatures received and whether the keeper holds it; none of it is onchain
until the game settles), opened games not yet rated, cooldowns, aborts, the
repeat history, the request replay guard and the block it read to. A ticket is
saved before either player sees it, and each signature before it is answered.
The queue and open tables aren't kept: players queue or host again. A store
from another version of the matchmaker is refused.

If the store is lost, or on the very first start, the matchmaker rebuilds the
games it must rate from `TicketUsed` since `from_block` and pairs no one for one
ticket life (5 minutes), until any ticket issued before is played or expired.
Games still in play then aren't onchain, so their players may be paired again
before they settle. Cooldowns and aborts from before are forgotten. To start a
new matchmaker key at once, create the store file holding `{}`.

## Keeper hooks

[`keeper-hooks.mjs`](keeper-hooks.mjs) is Surround's game module for arbiter's
keeper (plan O2): the Go codec and three hooks.
- `admit(ids, terms)`: a game whose terms carry a ticket digest
  (`config.ticket`) ranks 1, others 0, so rated games get the keeper's reserved
  capacity (`reserved_games`) when it is near full.
- `openCall(ids, terms, { signatures, extras })`: opens a game nobody opened yet
  in the transaction that settles it: `open_rated_game` with the ticket and the
  matchmaker's signature the matchmaker registered it with (`extras: { ticket,
  signature }`), or `open_game` for an unrated game.
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
(`referee.private_key_env`), whose public key goes in the matchmaker's
`keepers`, and a `reserved_games` share for rated games. The keeper rate-limits
POSTs per client (`rate_per_minute`, 120 by default), and the matchmaker
registers every rated game it pairs there from one address: allow for it. Each
wallet may hold `max_open_per_player` (4) games nobody opened yet on a keeper,
more than the matchmaker's one open rated game per player. The matchmaker still
rates every settled game the keeper didn't: one settled by a player's own
transaction, say.

## Trust and limits

- **The matchmaker key decides who plays rated games together,** and which
  keeper referees them. It can't change results or ratings, and the contract's
  policy fixes the referees, clocks, komi, prover, response window and starting
  bands. Revoking the key (`revoke_matchmaker(key, at)`) voids the unrated games
  of its tickets that started from `at` on; retiring it (`retire_matchmaker`)
  only stops new tickets.
- **It sees both players' signed terms.** Each wallet signature binds only that
  game's terms, which the matchmaker built and the player checked; with the
  ticket, it lets anyone open that game onchain, which is how its keeper settles
  it. The matchmaker passes the signatures to the game's keeper and publishes
  only whether each player signed.
- **Players trust the keeper it picks with time,** as in any refereed game
  (see arbiter's keeper README). The clock names the keeper's referee key, which
  the player sees before signing and `SurroundRatings` allowlists.
- **The store holds no secrets,** but losing it pauses pairing for a ticket
  life, and editing it can free busy players. Keep it on the matchmaker's host.
- **`GET /queue/:player` is unauthenticated** (RT-I1): anyone can read a
  player's ticket and terms, but only the players' wallets can sign the terms,
  and only their session keys can move.
- **There is no rate limit on requests,** and each signed request costs one RPC
  call to verify. Put it behind a proxy that limits by client.
