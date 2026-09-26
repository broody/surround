# Surround

Surround is Go with offchain play, Cairo rules and Stwo-proved results
settled through a Dojo channel on Starknet. Normal moves require a session
signature and **no blockchain transaction**. Opening a match, checkpoints,
settlement and disputes use transactions.

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
- [Pixel-art web preview](apps/web/README.md) — scrolling animated landing page highlighting Story, AI, kyu/dan progression, beginner learning and Starknet rewards, with an interactive capture lesson and local two-player 19×19 board sandbox; run `npm ci --prefix apps/web && npm run dev --prefix apps/web`. Story gameplay, AI, ranked play and online wallet/reward integration are not enabled in this preview.

## Build and test

The Dojo package uses **Scarb 2.13.1, Sozo 1.8.6 and Dojo 1.8.0**. The immutable
native proof adapter and local executable use **Scarb 2.18.0**; adapter tests use
**Starknet Foundry 0.63.0**. Directory-specific `.tool-versions` files select them.
Node.js 24 or later is required for the SDK.

```sh
npm ci --prefix offchain/sdk
python3 offchain/prepare.py --check
(cd offchain/cairo && scarb build)
node offchain/pin.mjs
scarb fmt
sozo build
sozo test
(cd offchain/cairo && snforge test)
npm test --prefix offchain/sdk
python3 offchain/local.py
python3 offchain/prove.py
```

Run root build/tests sequentially because they share artifacts. The local
integration command starts and stops its own Devnet 0.8.0 with two disposable
wallets. The proving command proves all six recorded games locally with Stwo;
these bootloader proofs are distinct from native SNIP-36 settlement proofs.

## Contract structure

| Path | Responsibility |
| --- | --- |
| `src/rules.cairo` | Captures, suicide prohibition, board commitments and area scoring. |
| `src/channel_protocol.cairo` | Signed transitions, superko, scoring negotiation and checkpoint hashes. |
| `src/channel_models.cairo` | Dojo channel state and update events. |
| `src/systems/channel.cairo` | Match registration, proof settlement, checkpoints, disputes and timeouts. |
| `offchain/cairo/src/adapter.cairo` | Immutable native proof adapter and output binding. |
| `offchain/proving` | Full-game Cairo executable for real local Stwo proofs. |
| `offchain/sdk` | Transport-independent signing, verification, replay and transaction builders. |

`offchain/prepare.py` derives the native rules/protocol sources from the Dojo
sources, removing only Dojo storage derives. `offchain/pin.mjs` pins the resulting
adapter class in the channel. Changing the adapter requires rebuilding and
repinning before deploying a new channel version.

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

The earlier per-move onchain implementation remains as a regression reference.
Its API and original measurements are in [ONCHAIN_REFERENCE.md](ONCHAIN_REFERENCE.md),
[move costs](benchmarks/MOVE_COSTS.md) and the separate
[score-only Sepolia benchmark](benchmarks/SEPOLIA_RESULTS.md).
