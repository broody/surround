# Matchmaker

Surround's matchmaker pairs players for rated games and reports settled games
to `SurroundRatings` ([plan](../../RANKING_PLAN.md)).
- **Quick match:** a queue. Each player is paired with the closest allowed rank
  on the same board and clock.
- **Open tables:** the host plays black; the matchmaker decides who may join.
- **Tickets:** for every pairing it signs a ticket that black passes to
  `create_rated_channel`.
- **Rating:** it watches the world's `RatedGame` records and sends `rate` for
  each game once it settles.

```sh
MATCHMAKER_KEY=0x… MATCHMAKER_ACCOUNT_KEY=0x… node offchain/matchmaker/server.mjs config.json
node --test offchain/matchmaker/test/*.test.mjs
```

`config.example.json` has the Sepolia ratings world's addresses. Set:
- `referee`: the keeper that referees rated games;
- `account.address`: the matchmaker's account, which pays for `rate`.

`SurroundRatings` must allowlist:
- the public key of `MATCHMAKER_KEY` (`set_matchmaker`);
- the referee key;
- the clock settings in `clocks` (`set_clock_preset`);
- the komi in `boards` (`set_board`).

## API

JSON, with felts as hex strings. A request that changes state carries `at`
(Unix seconds, within two minutes of the matchmaker's clock) and `signature`.
The signature is the player's wallet signature over the SDK's
`matchmakerRequest(...)` typed data (SNIP-12). The matchmaker checks it through
the player's account contract (`is_valid_signature`), so it works for any
Starknet account, Cartridge Controller included, and never needs a player key.

| Request | Body | Returns |
| --- | --- | --- |
| `GET /info` | | chain, channel, prover, matchmaker key, boards, clocks, bands |
| `POST /queue` | `player, size, clock, band` | `waiting`, or the ticket if paired at once |
| `POST /queue/leave` | `player` | `{ left }` |
| `GET /queue/:player` | | `none`, `waiting`, or `paired` with `ticket`, `signature`, `color` |
| `GET /tables` | | open tables |
| `POST /tables` | `player, size, clock, band` | `{ table }` |
| `POST /tables/:id/join` | `player, band` | the joiner's ticket |
| `POST /tables/:id/close` | `player` | `{ closed }` |

Black then:
1. revives the ticket (`reviveTicket`);
2. sends `createRatedChannelCall({ channel, ticket, signature, session_key })`.

White joins with `joinChannelCall` before the ticket expires.

## Rules

`rules` in the config; the defaults come from `pairing.mjs`.

- **Rank gap:** starts at 3 ranks and widens by 1 rank every 30 s, up to 9. Open
  tables allow up to 9.
- **Ranks:** a rated player's rank from `SurroundRatings`. A new player's comes
  from their starting band: 23k, 17k, 6k or 1k.
- **Colors:** the weaker player takes black; at equal rank, the one who waited
  longer does.
- **Repeat pairings:** the same two players at most twice a day.
- **Open games:** one unfinished rated game per player at a time.
- **No-shows:** a black who doesn't create the game before the ticket expires
  (4 minutes), or a white who doesn't join it, waits 15 minutes before playing
  again.
- **Banned players** (`banned`, for example accounts caught using an engine)
  get no rated games. Games they already played stay rated.

## Rating

Each round (`poll_seconds`):
- it reads `StoreSetRecord` events for the world's `RatedGame` model, from
  `from_block` on, and links each game to its ticket;
- once a game is settled and `SurroundRatings` hasn't recorded it, it sends
  `rate` for all such games in one transaction.

`rate` does nothing for a game that isn't rateable, and anyone can send it. So a
restart, a second matchmaker, or a player rating their own game can't
double-count one.

## Trust and limits

- **The matchmaker key decides who plays rated games together.** It can't change
  results or ratings, and the contract's policy fixes the referee, clock, komi,
  prover and response window. Revoking the key (`set_matchmaker`) voids the
  unrated games it paired.
- **Queue, tables, cooldowns and pairing history live in memory.** A restart
  forgets them. Rating doesn't depend on them: it rescans from `from_block`.
- **There is no rate limit on requests,** and each signed request costs one RPC
  call to verify. Put it behind a proxy that limits by client.
