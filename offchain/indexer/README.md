# Indexer

Reads SurroundRatings' events into the [Surround database](../db/README.md)'s
rebuildable tables, for players' history and profile pages:
- `rated_games`: each rated game, from its ticket (`TicketUsed`: its seats,
  and the board and clock it names by hash, matched against the matchmaker's
  `boards` and `clocks`), its result (`RatingUpdated`: the winner, steps and
  when it was played) and whether it was voided (`GameVoided`);
- `rank_history`: each player's rank after each rated game (`RatingUpdated`).

Casual games never reach the chain: the matchmaker keeps those itself
(`casual_games`). The matchmaker serves both (`GET /profiles/:id/games` and
`/ranks`).

```sh
node offchain/indexer/server.mjs CONFIG_JSON              # beside the matchmaker, on its config
node offchain/indexer/server.mjs CONFIG_JSON --rebuild    # empty its tables first, and read everything again
node --test offchain/indexer/test/*.test.mjs
```

It reads the matchmaker's config: `rpc_url`, `ratings`, `channel` (the games
it keeps), `from_block` (where it starts), `boards`, `clocks` and `db`, and,
optionally, `indexer: { poll_seconds (5), confirmations (2), rewind (20) }`.
It reads only blocks `confirmations` behind the tip, and remembers the last
one's hash; if that block was replaced, it forgets the last `rewind` blocks
and reads them again. Each round is one write transaction. It runs as a
process of its own, so its writes never hold up the matchmaker's requests; the
local stack (`offchain/anchors/stack.ts`) runs it inside the stack's process instead.

The chain stays the source of truth: losing these tables loses nothing, and
`--rebuild` reads them again from `from_block`.
