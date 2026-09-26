# Surround

Surround is Go with offchain play, Cairo rules and Stwo-proved results
settled through a Dojo channel on Starknet. Normal moves require a session
signature and **no blockchain transaction**. Opening a match, checkpoints,
settlement and disputes use transactions.

The channel, dispute state machine, proof adapter and SDK protocol come from
[referee](https://github.com/broody/referee), a library for offchain turn-based
games with onchain settlement. Surround supplies Go: its rules as referee's
`GameRules`, a thin Dojo system, a thin proof adapter, and the Go codec for the
JS SDK.

Players agree which complete groups are dead after two passes. If they disagree,
play resumes with positional superko history preserved. Cairo verifies every
signed move and computes the agreed area score; the proof does not decide life
and death. No blitz or server-authoritative clock is used. The default dispute
response window is one hour, configurable from five minutes to seven days.

## Start here

- [Protocol and dispute design](OFFCHAIN_PROTOCOL.md)
- [SDK, local proving and deployment guide](offchain/README.md)
- [Verification results](offchain/RESULTS.md)
- [Proving plan: self-hosted and full-game proofs](PROVING_PLAN.md)
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
scarb fmt && sozo build && sozo test    # the Dojo channel
(cd offchain/cairo && snforge test)     # the proof adapter
npm test --prefix offchain/sdk
python3 offchain/local.py               # Devnet end-to-end
python3 offchain/prove.py               # local Stwo proofs (--execute-only to skip proving)
node offchain/generate-fixtures.mjs     # after changing rules or the SDK
```

Run root build/tests sequentially because they share artifacts. The local
integration command starts and stops its own Devnet 0.8.0 with two disposable
wallets. The proving command proves all six recorded games locally with Stwo;
these bootloader proofs are distinct from native SNIP-36 settlement proofs.

## Structure

| Path | Responsibility |
| --- | --- |
| `rules/` (`surround_rules`) | Go rules (captures, suicide, superko, area scoring) and `GoRules`, Go's referee `GameRules`. Dojo-free; everything below builds from it. |
| `src/systems/channel.cairo` | The Dojo channel: referee_dojo's entrypoints specialized to Go. |
| `offchain/cairo/src/adapter.cairo` | Native proof adapter: referee_adapter specialized to Go. |
| `offchain/proving` | Full-game Cairo executable for real local Stwo proofs. |
| `offchain/sdk` | Go's codec and rules for referee's JS SDK, and Surround's call builders. |
| `apps/web` | Pixel-art web preview with its own local rules; not yet wired to the channel. |

The namespace owner allowlists adapter classes with `allow_prover`; a new
adapter needs no new channel. Seat 0 (the creator) plays black. Go never asks for
randomness, so each seat's session key doubles as its referee randomness tip.

## Rules and scope

Boards are 9×9, 13×13 or 19×19. Captures precede the suicide check. Placements obey
positional superko; passes are exempt. Scores count living stones plus exclusively
surrounded empty regions, with komi stored in half-points. Prisoners add no
separate bonus. Shared liberties are neutral; enclosed eyes count. This specified
area ruleset is not Japanese territory scoring. Draws are possible with integer
komi. Handicap, a ratings engine, wagers and relay transport are not implemented.
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
