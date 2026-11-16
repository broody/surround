# Surround

Surround is Go with offchain play, Cairo rules and Stwo-proved results
settled through a Dojo channel on Starknet. Normal moves require a session
signature and **no blockchain transaction**. Opening a match takes none
either: both wallets sign the game's terms, and the game opens onchain in the
first transaction that needs the chain, usually its settlement. Checkpoints,
settlement and disputes use transactions.

The channel, dispute state machine, proof adapter and SDK protocol come from
[arbiter](https://github.com/broody/arbiter), a library for offchain turn-based
games with onchain settlement. Surround supplies Go: its rules as arbiter's
`GameRules`, a thin Dojo system, a thin proof adapter, and the Go codec for the
JS SDK. Surround is on arbiter protocol v6 (commit
[`efcd918`](https://github.com/broody/arbiter/commit/efcd918)): optional
referee clocks with pluggable time rules since v3, randomness from the referee
(which Go never asks for) since v5, and since v6 games opened on their seats'
signed terms.

Players agree which complete groups are dead after two passes. If they disagree,
play resumes with positional superko history preserved. Cairo verifies every
signed move and computes the agreed area score; the proof does not decide life
and death. Ranked games are timed by referee clocks, scoring steps included,
at 60 s per turn or on Japanese byo-yomi: the keeper named in the game's terms
stamps every step and flags a seat whose time runs out, and the proof checks
its attestation. Casual games are untimed. The default dispute response window is one hour,
configurable from five minutes to seven days.

## Start here

- [Running everything locally](RUN_LOCALLY.md) — the website, keeper, matchmaker and AI on your machine, settling on Sepolia
- [Documentation site](apps/docs/README.md) — settlement, ranking, AI anchors and kifu explained for players and integrators; run `npm ci --prefix apps/docs && npm run dev --prefix apps/docs`
- [Protocol and dispute design](OFFCHAIN_PROTOCOL.md)
- [SDK, local proving and deployment guide](offchain/README.md)
- [Verification results](offchain/RESULTS.md)
- [Proving plan: self-hosted and full-game proofs](PROVING_PLAN.md)
- [Ranking plan: onchain ratings](RANKING_PLAN.md)
- [Recorded games and provenance](tests/fixtures/sgf/README.md)
- [arbiter design](https://github.com/broody/arbiter/blob/main/DESIGN.md)
- [Web app](apps/web/README.md) — the landing page, study, and the Dojo: rated and casual games against people and the AI regulars, with a wallet; run `npm ci --prefix apps/web && npm run dev --prefix apps/web`, beside the stack ([Running everything locally](RUN_LOCALLY.md)). Play is still coming soon on the live site.

## Build and test

The Dojo package uses **Scarb 2.13.1, Sozo 1.8.6 and Dojo 1.8.0**. The native
proof adapter and local proving executable use **Scarb 2.18.0**; adapter tests use
**Starknet Foundry 0.63.0**. The local integration uses **Devnet 0.8.0**.
Directory-specific `.tool-versions` files select them. Node.js 22 or later is
required for the SDK.

```sh
npm ci --prefix offchain/sdk
(cd rules && scarb test)                # Go rules, GoRules, JS/Cairo vectors
(cd ratings && scarb test)              # SurroundRatings and its math, JS/Cairo vectors
scarb fmt && sozo build && sozo test    # the Dojo channel
(cd offchain/cairo && snforge test)     # the proof adapter
npm test --prefix offchain/sdk          # includes ranked games through a keeper
node --test offchain/matchmaker/test/*.test.mjs  # pairing, tickets and rating rounds
node --experimental-strip-types --test offchain/db/test/*.test.mjs  # the Surround database: profiles
node --test offchain/indexer/test/*.test.mjs     # the indexer and players' history
python3 offchain/local.py               # Devnet end-to-end, including a flagged ranked game
python3 offchain/prove.py               # local Stwo proofs (--execute-only to skip proving)
node offchain/generate-fixtures.mjs     # after changing rules or the SDK
node offchain/generate-rating-vectors.mjs  # after changing the rating math
```

Run root build/tests sequentially because they share artifacts. The local
integration command starts and stops its own Devnet 0.8.0 with two disposable
wallets. The proving command proves all six recorded games locally with Stwo;
these bootloader proofs are distinct from native SNIP-36 settlement proofs.

## Structure

| Path | Responsibility |
| --- | --- |
| `rules/` (`surround_rules`) | Go rules (captures, suicide, superko, area scoring) and `GoRules`, Go's arbiter `GameRules`. Dojo-free; everything below builds from it. |
| `ratings/` (`surround_ratings`) | `SurroundRatings`, a plain Starknet contract that keeps players' ratings across Dojo worlds, checks the matchmaker's pairing tickets, and holds its Q32.32 rating math ([plan](RANKING_PLAN.md)). |
| `src/systems/channel.cairo` | The Dojo channel: arbiter_dojo's entrypoints specialized to Go, and `open_rated_game` for matchmaker tickets (`open_rated_game_delegable` for a signed-in player's browser key). |
| `src/systems/kifu.cairo`, `src/kifu/` | Kifu: an ERC-721 of settled ranked games, minted to the winner, whose record, SVG, SGF and metadata live onchain ([below](#kifu)). |
| `src/rank_card/` | Rank cards: a soulbound ERC-721, one per rated player, whose SVG shows their rank, games, wins and losses, read live from `SurroundRatings` ([below](#rank-cards)). |
| `offchain/cairo/src/adapter.cairo` | Native proof adapter: arbiter_adapter specialized to Go. |
| `offchain/proving` | Full-game Cairo executable for real local Stwo proofs. |
| `offchain/matchmaker` | Pairs players for rated games (quick match and open tables), signs their tickets and rates settled games ([README](offchain/matchmaker/README.md)). |
| `offchain/sdk` | Go's codec and rules for arbiter's JS SDK, Surround's call builders and the ranked time controls (`rankedClock`, `byoyomiClock`). |
| `apps/docs` | The documentation site (Vocs): settlement, ranking, AI anchors and kifu. |
| `apps/web` | Pixel-art web preview with its own local rules; not yet wired to the channel. |

The namespace owner allowlists adapter classes with `allow_prover`; a new
adapter needs no new channel. Seat 0 (the creator) plays black. Go never asks for
randomness, so each seat's session key doubles as its referee randomness tip.

## Kifu

Each settled ranked game can be minted once as a Kifu, an ERC-721 (OpenZeppelin's
component in a Dojo contract) owned by the game's winner; a drawn game has none.
Anyone may send `mint(game_id, anchor, record)`, so it can ride in the settlement
multicall. The token ID is the game ID. The matchmaker mints each rated game's,
from the keeper's record, once it has rated the game
([offchain/matchmaker](offchain/matchmaker/README.md#kifu)); it mints none for a
game ratings voided, or one an AI anchor won.

- **Record.** The `Kifu` model stores only the game's packed steps and final
  position (`src/kifu/record.cairo` documents the format): each step one digit in
  base `size² + 8`, dead-stone proposals listed or as a bitmap, whichever is
  shorter, then one bit per played point for the final position. The step count
  is the settled anchor's sequence number. Recorded games take 3 felts on 9×9,
  7 on 13×13 and 12–14 on 19×19; the 529-step stress game takes 20.
- **Verification.** Mint checks the anchor against the channel's settled state
  hash, the unpacked final position against the anchor, and the steps' referee
  transcript against the anchor's. Only the one canonical record decodes.
- **Date.** A kifu is dated by its game's settlement: the channel records the
  block timestamp of the transaction that settled each game (`Settlement`), so
  minting later changes nothing.
- **Queries.** `summary(token_id)` returns the players, winner, loser, board,
  komi, moves, how the game ended, scores, captures and date. Minting emits the
  same fields as the `KifuSummary` event, which Torii indexes for queries
  across kifus.
- **Rendering.** `token_uri`, `svg` and `sgf` build everything on read: the final
  position with each stone's move number, dead stones, territory and the result.
  Metadata is a `data:application/json,` URI with the SVG inside it raw, which
  Torii parses. The heaviest game's `token_uri` costs about 68M gas, inside the
  100M Juno allows a call by default (`test_kifu_stress`).

A kifu's token id is its game's id, which since v6 is a full felt (the seats'
hash): pass it to the ERC-721 reads as a `u256`, low then high 128 bits
(`kifuTokenId(id)`). The SDK's `kifuRecord(session)` packs a finished session
and `mintKifuCall` builds the call; `encodeKifu`/`decodeKifu` pack and read
records directly.

## Rank cards

Each rated player can hold one rank card: a soulbound ERC-721 (OpenZeppelin's
component in a plain Starknet contract, `RankCard`) whose image shows their
rank, games, wins and losses, with draws where there are any: `surround.gg`
at the top, the rank as a large number with `KYU` or `DAN` beside it over a
19×19 board that fades out from its center (star points where a real board
has them), and the record under it. A dan card is foiled: a double gold frame,
gold star points and the number in a gold gradient.

- **Live.** The card stores nothing but its owner. `token_uri` and `svg` read
  the player's rating from `SurroundRatings` each time they are called, so the
  card shows the rank and record of the last rated game the moment it is
  rated, with no transaction per game. A rank that is still provisional shows
  `?` (`12 KYU?`), as in the lobby.
- **Outside the world.** Like `SurroundRatings`, which it takes in its
  constructor, `RankCard` is no Dojo contract: a new world keeps the cards, as
  it keeps the ratings they show.
- **Minting.** Anyone may send `mint(player)`, for a player with a rated game
  who isn't an AI anchor, once. The token ID is the player's address
  (`rankCardTokenId(player)`, low then high 128 bits). The matchmaker mints
  each rated player's after their first rated game
  ([offchain/matchmaker](offchain/matchmaker/README.md#rank-cards)).
- **Soulbound.** Every transfer reverts ('Rank cards are soulbound'), by the
  owner or anyone they approved, and there is no burn. `locked(token_id)` is
  true for every card, as ERC-5192 has it.
- **Rendering.** Metadata is a `data:application/json,` URI with the SVG
  inside it raw, built as kifu's is (`src/rank_card/render.cairo`): only the
  `#`s of its fade, clip and foil are escaped, as `%2523`. Its
  attributes are the rank, whether it is provisional, and the four counts.
  A wallet or marketplace that caches metadata shows the card as it was when
  it last read it.
- **Deploying.** `node offchain/deploy-rank-card.mjs` declares and deploys it
  beside v8's `SurroundRatings` and records it as `rank_card` in
  `offchain/results/sepolia-arbiter-v8.json`; `… check` also mints the funded
  signer's card and reads it back.

## Rules and scope

Boards are 9×9, 13×13 or 19×19. Captures precede the suicide check. Placements obey
positional superko; passes are exempt. Scores count living stones plus exclusively
surrounded empty regions, with komi stored in half-points. Prisoners add no
separate bonus. Shared liberties are neutral; enclosed eyes count. This specified
area ruleset is not Japanese territory scoring. Draws are possible with integer
komi. Handicap and wagers are not implemented. Ratings ([plan](RANKING_PLAN.md))
work onchain: the channel opens rated games on matchmaker tickets
(`open_rated_game`) and reports settled ones (`rate`); the matchmaker service
pairs players, brokers their signed terms to a keeper and rates their games.
The web display is next. Relaying and refereeing ranked games is arbiter's
keeper, run separately, possibly in several regions.
The pixel-art frontend in `apps/web` is a local preview; channel and wallet
integration and final scoring are not implemented in that frontend.

Players must retain transcripts and respond to onchain disputes. An uncooperative
opponent can force onchain play and its costs. Native proof verification and Dojo
administrative authority have the deployment assumptions described in the
[protocol](OFFCHAIN_PROTOCOL.md); the contracts have not had an independent audit.

The earlier per-move onchain system was removed when Surround moved onto arbiter (then named referee).
Its API and measurements remain in [ONCHAIN_REFERENCE.md](ONCHAIN_REFERENCE.md),
[move costs](benchmarks/MOVE_COSTS.md) and the
[score-only Sepolia benchmark](benchmarks/SEPOLIA_RESULTS.md); its code is at
commit `2a56a00`.

## License

Surround is free software: you can redistribute it and/or modify it under the
terms of the GNU Affero General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. See [LICENSE](LICENSE). If you run a modified version as a network
service, you must offer its users the corresponding source.

The Study Room's beginner lessons are adapted from the
[Online-Go.com Learning Hub](https://github.com/online-go/online-go.com)
(Copyright © Online-Go.com, AGPL-3.0-or-later).
