# Offchain verification results

Measured 2026-09-07 on Apple M5 Pro, 64 GiB RAM, with eight prover threads.
The signed fixture corpus adds scoring proposal/acceptance actions to the six
published SGFs. These measurements use the implemented full-game protocol,
including signature checks, superko, negotiated dead groups and area scoring.

## Referee protocol v2 (compact steps) on Sepolia, 2026-09-26

Referee's protocol v2 drops the per-step signature, seat and entropy fields from
calldata and proofs, and Go's action became an enum (a stone is 3 felts instead
of 10). The channel was upgraded in place in the same world and a new adapter
was allowlisted ([record](results/sepolia-referee-v2.json)). The same five games
then settled, **each in one PROOF1**, including the board-filling stress games
that needed two checkpoints before:

| Game | Steps | Replay calldata (v1 → v2) | Replay Poseidon (v1 → v2) | One PROOF1 | Proof | Settlement | Per game |
| --- | ---: | ---: | ---: | --- | --- | ---: | ---: |
| cgos_9_1682833 (real, W+2.0) | 68 | 736 → 264 felts | 1,093 → 955 | yes | 4.9 s, 237,300 B | 99.9M L2 gas | 2.785 test STRK |
| kgs_2019_04_26_17 (real 19×19, B+74.5) | 319 | 3,246 → 1,006 | 5,032 → 4,381 | yes | 6.9 s, 218,047 B | 99.0M | 2.765 |
| stress_19_3 (random fill, B+32.5) | 479 | 4,846 → 1,497 | 7,669 → 6,709 | **yes** (v1: no) | 8.4 s, 233,590 B | 99.0M | 2.765 |
| stress_19_1 (random fill, W+45.5) | 526 | 5,316 → 1,631 | — → 7,311 | **yes** | 8.4 s, 231,756 B | 99.9M | 2.785 |
| stress_19_2 (random fill, B+204.5) | 529 | 5,346 → 1,642 | 8,434 → 7,369 | **yes** (v1: 2 checkpoints, 4.79 STRK) | 8.3 s, 232,465 B | 99.0M | 2.765 |

Per game is create + join + settlement. Replay Poseidon is the proving
executable's `poseidon_builtin` count (`scarb execute`), which grows only
slightly less per step in v2 (the action message hashes fewer felts). Most of the
gain is in the virtual OS, which hashes the transaction calldata at about one
permutation per two felts: that input is now roughly a third of its v1 size.
Estimated totals for the stress games are about 7,500–8,200 permutations, below
the 8,289 that already fit one PROOF1 under v1. Settlement stays about 99M L2
gas at any length, because the native proof charge dominates.

So every game we have, including 19×19 games that nearly fill the board after
hundreds of captures, now settles with a single proof; checkpoints are only
needed beyond roughly 550 steps. On Devnet, direct replay of the 68-step game
fell from 43.6M to 39.4M L2 gas; the other channel transactions are unchanged.
The upgrade cost 77.1 test STRK (channel and adapter declarations, the channel
upgrade, adapter deployment and allowlisting).

After the proving client moved into referee (`@referee/sdk/proving`),
`cgos_9_1682827` (81 steps, B+8.0) settled through it the same way: one PROOF1
in 4.3 s (236,256 B), 99.0M L2 gas, with the changed-score and missing-proof
rejections checked onchain first.

## Referee (v1) native settlement on Sepolia, 2026-09-26

The first native proof through referee's adapter: the recorded 9×9 game
`cgos_9_1682833` (68 signed steps, W+2.0) was played offchain, proved by StarkWare's
hosted Sepolia prover from the adapter's virtual replay, and settled on a fresh
Dojo world ([record](results/sepolia-referee.json)). Before settling, a changed
score and a missing proof were both rejected onchain, and a second RPC
confirmed the settlement.

| | pre-referee (2026-09-07) | referee |
| --- | ---: | ---: |
| create | 18.6M L2 gas | 12.4M L2 gas |
| join | 22.3M | 15.5M |
| native proof settlement | 117.9M | 99.9M |
| game total | 4.455 test STRK | 2.782 test STRK |
| proof | 8.52 s, 233,303 B | 6.35 s, 237,756 B |
| one-time setup | 134.45 test STRK | 94.83 test STRK |

The settlement is still dominated by the fixed native proof charge; direct
onchain replay of the same game costs 43.6M L2 gas on Devnet (above).

### PROOF1 capacity (referee protocol v1, Sepolia, 2026-09-26)

The hosted prover produces PROOF1 only (PROOF2 is not yet accepted on Sepolia).
Its limit is Poseidon: `cube_252` exceeds 2²⁰ rows somewhere between 8,289 and
10,396 permutations per proof (replay plus about one permutation per two
calldata felts for the OS). Referee binds each step to the transcript instead of
hashing the full state, which roughly halves Poseidon per step compared with v1.

| Game | Steps | Poseidon (replay / est. total) | One PROOF1 | Settled |
| --- | ---: | --- | --- | --- |
| cgos_9_1682833 (real, W+2.0) | 68 | 1,093 / ~2,400 | yes, 6.4 s | 99.9M L2 gas, 2.78 test STRK per game |
| kgs_2019_04_26_17 (real 19×19, B+74.5) | 319 | 5,032 / ~6,650 | yes, 7.7 s | 99.0M L2 gas, 2.75 test STRK per game |
| stress_19_3 (random fill) | 479 | 7,669 / ~10,100 | no: `Not enough twiddles!` | — |
| stress_19_2 (random fill, B+204.5) | 529 | 8,434 / ~11,100 | no: `Not enough twiddles!` | 2 checkpoints (1–300, 301–529), 4.79 test STRK |

The stress games come from `generate-stress.mjs`: seeded random legal play that
never fills its own eyes, ending with about 300 stones on the board after 170–224
captures and a 520-position superko history. So every recorded real game (at most
319 steps) settles in one PROOF1, while board-filling games of 479+ steps need a
second checkpoint (or PROOF2). Each extra checkpoint costs about 2.1 test STRK.

## Referee (protocol v1) on local Devnet, 2026-09-26

After moving onto [referee](https://github.com/broody/referee), `local.py` ran all
of its scenarios against the actual Dojo world on Devnet 0.8.0 (24 transactions,
10 checks; [record](results/local-integration.json)). The v1 figures are the
2026-09-07 run below, on the same Devnet setup.

| Transaction | v1 L2 gas | v2 L2 gas |
| --- | ---: | ---: |
| create | 16.7M | 10.3M |
| join | 21.2M | 14.1M |
| 68-step game settled by direct replay | 335.8M | 43.6M |
| cooperative 2-step checkpoint | 27.6M | 13.9M |
| open dispute | 19.4M | 10.6M |
| forced move | 20.3M | 12.2M |
| timeout claim | 21.6M | 11.5M |

Direct replay of a short game is now cheaper than one native proof settlement
(105–118M L2 gas below). The proving executable's public output matches the JS
SDK for all six games; they execute in 0.46M (68 steps) to 1.13M (311 steps) VM
steps (`prove.py --execute-only`). The local Stwo proofs and Sepolia runs below
are v1 measurements and have not been repeated for v2.

## Real local Stwo proofs

| Game | Signed actions | Published result | Proving | Peak memory |
| --- | ---: | --- | ---: | ---: |
| cgos_9_1682833 | 68 | W+2.0 | 12.30 s | 19.79 GiB |
| cgos_9_1682827 | 81 | B+8.0 | 12.83 s | 21.48 GiB |
| cgos_13_277988 | 203 | W+20.5 | 25.57 s | 25.16 GiB |
| cgos_13_277982 | 207 | B+31.5 | 24.45 s | 32.99 GiB |
| kgs_2019_04_10_39 | 311 | B+1.50 | 37.67 s | 31.43 GiB |
| kgs_2019_04_26_17 | 319 | B+74.50 | 58.68 s | 34.39 GiB |

All six proofs verified. For each, changing the public Black score made Stwo
verification fail. Cairo's complete public state matched the independently
implemented JavaScript replay. Both KGS games are 19×19; the B+1.5 result includes
34 agreed dead stones. Source hashes, proof hashes, VM resources and execution /
verification timings are in [local-proofs.json](results/local-proofs.json).

These are actual Cairo bootloader proofs generated locally. They are not native
virtual-SNOS wire proofs and cannot be attached directly to settlement transactions.
The local run proves the public fixture input/output; onchain anchor authorization
is separately enforced by the adapter and channel.

## Contracts and client

- Dojo: **69 tests passed**, including 19 channel/authentication/dispute tests and
  all 50 existing Go/onchain regression tests.
- Native adapter: **15 Foundry tests passed**, checking message binding, versions,
  freshness, epochs, wrong outputs and malformed facts. These unit tests use
  explicit proof-fact syscall mocks; they are not cryptographic verification.
- SDK: **13 tests passed**, including independent client exchanges, scoring
  disagreement, signature domain separation, all six SGFs, proof-response checks and native base-block maturity.
- Local integration: **20 signed transactions and 8 recorded checks passed** on a
  freshly deployed Dojo world and real immutable adapter using Devnet 0.8.0. A full
  9×9 transcript settled by direct replay. Checkpoints, continuation, fixed dispute
  windows, forced actions, return to offchain play and timeout settlement passed.
  Missing proof facts and unauthorized adapter callbacks were rejected.
  See [local-integration.json](results/local-integration.json).

No successful native proof acceptance is mocked in the local transaction run.
Normal per-move offchain play generates no transaction and therefore no per-move
chain fee. Creation, joining, checkpoints, proof settlement and disputes still
cost gas. Proving time is separate from network verification/settlement cost.

## Actual Sepolia native proof settlement

Both games settled through the deployed Dojo channel using native SNIP-36 proofs.
The submitted transactions include the exact expected proof facts. Their successful
receipts were also checked through a second RPC provider. All ordinary game moves
were signed and played offchain before settlement.

| Game | Signed actions | Result | Native proofs | Proof settlements, test STRK | Create + join + settlement, test STRK | Final transaction |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| cgos_9_1682833 | 68 | W+2.0 | 1 | 3.2960 | 4.4549 | [receipt](https://sepolia.voyager.online/tx/0x58b0d901cda623e20cf6774a13fb347a89b323d8063b6daf1f58fdb6fa9503b) |
| kgs_2019_04_10_39 | 311 | B+1.50 | 5 | 15.3396 | 16.4738 | [receipt](https://sepolia.voyager.online/tx/0x53c08793992cd0e851aaa0e84a3c33be5a05d002baf92cbe8a396a6f2f5ca9c) |

The full 9×9 proof took 8.52 seconds at the hosted prover. Changing the
public score while retaining that proof was rejected, and omitting the proof was
rejected. The final 19×19 state matched every field of the complete client replay,
including 34 agreed dead stones and the B+1.5 score.

The hosted service rejected the full 311-action 19×19 transcript and a 128-action
prefix with `Not enough twiddles!` (one earlier request returned HTTP 502). The
same contract succeeded with five consecutive checkpoints: 64, 64, 64, 64 and 55
actions. Every checkpoint verified all supplied move signatures and transitions
from the previous onchain anchor; the complete position history remained committed
and available throughout. Each checkpoint had both players' approvals. These are
five genuine native proofs, not five pieces of an unverified proof.

This is a measured limitation of the hosted prover. It means additional settlement
fees today; it does not add per-move transactions or a server-authoritative clock.
A production native prover needs sufficient capacity for the complete trace to
avoid these checkpoints. **Local full-game bootloader proofs already verify, but
those artifacts are not directly usable as native settlement proofs.**

The fees above are actual Sepolia receipts at the observed prices, not mainnet
quotes. One-time declarations, migration, adapter/test-player deployment and one
reverted deployment attempt cost **134.4513 test STRK** separately. This includes
several legacy model declarations from the initial deployment attempt; the final
Sepolia profile only registers the channel and its two resources. This setup cost
is not a recurring per-game charge.

Public deployment:

- World: `0x773ac50e6a35098c73f0adf832ed03d36bcea83227a58c6f3b95808e820b018`
- Channel: `0x27f9a30149742767d26e6c7ef6df929c01bbe47c4a11e3163ac24a3ee9d82e1`
- Immutable adapter: `0x328baef8c399686f027ac9dcbbfd6f9dd55349ee43f3858a0705b9bd5dc94c3`
- Adapter class: `0x317e518fbafa9823d23907351a7322a55e31c4ae978584f7164923623ef663c`

See [sepolia.json](results/sepolia.json) for receipts, proof facts, source hashes,
per-checkpoint timings and the hosted prover error. Raw native proof responses are
saved under ignored `offchain/results/raw/sepolia/`. Both test seats were controlled
by the harness; these results demonstrate protocol correctness, not independent
competitive players or a ratings system.
