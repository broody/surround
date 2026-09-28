# Surround

Surround is Go with offchain play, Cairo rules and Stwo-proved results
settled through a Dojo channel on Starknet. Normal moves require a session
signature and **no blockchain transaction**. Opening a match, checkpoints,
settlement and disputes use transactions.

The channel, dispute state machine, proof adapter and SDK protocol come from
[referee](https://github.com/broody/referee), a library for offchain turn-based
games with onchain settlement. Surround supplies Go: its rules as referee's
`GameRules`, a thin Dojo system, a thin proof adapter, and the Go codec for the
JS SDK. Surround is on referee protocol v3 (commit
[`a2a5269`](https://github.com/broody/referee/commit/a2a5269)), which adds
optional referee clocks with pluggable time rules.

Players agree which complete groups are dead after two passes. If they disagree,
play resumes with positional superko history preserved. Cairo verifies every
signed move and computes the agreed area score; the proof does not decide life
and death. Ranked games are timed by referee's clocks, scoring steps included,
at 60 s per turn or on Japanese byo-yomi: the keeper named in the game's terms
stamps every step and flags a seat whose time runs out, and the proof checks
its attestation. Casual games are untimed. The default dispute response window is one hour,
configurable from five minutes to seven days.

## Start here

- [Protocol and dispute design](OFFCHAIN_PROTOCOL.md)
- [SDK, local proving and deployment guide](offchain/README.md)
- [Verification results](offchain/RESULTS.md)
- [Proving plan: self-hosted and full-game proofs](PROVING_PLAN.md)
- [Ranking plan: onchain ratings](RANKING_PLAN.md)
- [Recorded games and provenance](tests/fixtures/sgf/README.md)
- [referee design](https://github.com/broody/referee/blob/main/DESIGN.md)
- [Pixel-art web preview](apps/web/README.md) — scrolling animated landing page highlighting Story, AI, kyu/dan progression, beginner learning and Starknet rewards, with an interactive capture lesson and local two-player 19×19 board sandbox; run `npm ci --prefix apps/web && npm run dev --prefix apps/web`. Story gameplay, AI, ranked play and online wallet/reward integration are not enabled in this preview.

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
| `rules/` (`surround_rules`) | Go rules (captures, suicide, superko, area scoring) and `GoRules`, Go's referee `GameRules`. Dojo-free; everything below builds from it. |
| `ratings/` (`surround_ratings`) | `SurroundRatings`, a plain Starknet contract that keeps players' ratings across Dojo worlds, checks the matchmaker's pairing tickets, and holds its Q32.32 rating math ([plan](RANKING_PLAN.md)). |
| `src/systems/channel.cairo` | The Dojo channel: referee_dojo's entrypoints specialized to Go. |
| `src/systems/kifu.cairo`, `src/kifu/` | Kifu: an ERC-721 of settled ranked games, minted to the winner, whose record, SVG, SGF and metadata live onchain ([below](#kifu)). |
| `offchain/cairo/src/adapter.cairo` | Native proof adapter: referee_adapter specialized to Go. |
| `offchain/proving` | Full-game Cairo executable for real local Stwo proofs. |
| `offchain/sdk` | Go's codec and rules for referee's JS SDK, Surround's call builders and the ranked time controls (`rankedClock`, `byoyomiClock`). |
| `apps/web` | Pixel-art web preview with its own local rules; not yet wired to the channel. |

The namespace owner allowlists adapter classes with `allow_prover`; a new
adapter needs no new channel. Seat 0 (the creator) plays black. Go never asks for
randomness, so each seat's session key doubles as its referee randomness tip.

## Kifu

Each settled ranked game can be minted once as a Kifu, an ERC-721 (OpenZeppelin's
component in a Dojo contract) owned by the game's winner; a drawn game has none.
Anyone may send `mint(game_id, anchor, record)`, so it can ride in the settlement
multicall. The token ID is the game ID.

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

The SDK's `kifuRecord(session)` packs a finished session and `mintKifuCall`
builds the call; `encodeKifu`/`decodeKifu` pack and read records directly.

## Rules and scope

Boards are 9×9, 13×13 or 19×19. Captures precede the suicide check. Placements obey
positional superko; passes are exempt. Scores count living stones plus exclusively
surrounded empty regions, with komi stored in half-points. Prisoners add no
separate bonus. Shared liberties are neutral; enclosed eyes count. This specified
area ruleset is not Japanese territory scoring. Draws are possible with integer
komi. Handicap and wagers are not implemented; ratings are in progress
([plan](RANKING_PLAN.md)): the channel creates rated games from matchmaker
tickets (`create_rated_channel`), but does not report settled ones yet. Relaying and
refereeing ranked games is referee's keeper, run separately.
The pixel-art frontend in `apps/web` is a local preview; channel and wallet
integration and final scoring are not implemented in that frontend.

Players must retain transcripts and respond to onchain disputes. An uncooperative
opponent can force onchain play and its costs. Native proof verification and Dojo
administrative authority have the deployment assumptions described in the
[protocol](OFFCHAIN_PROTOCOL.md); the contracts have not had an independent audit.

The earlier per-move onchain system was removed when Surround moved onto referee.
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
