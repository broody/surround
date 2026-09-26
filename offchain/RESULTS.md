# Offchain verification results

Measured 2026-09-07 on Apple M5 Pro, 64 GiB RAM, with eight prover threads.
The signed fixture corpus adds scoring proposal/acceptance actions to the six
published SGFs. These measurements use the implemented full-game protocol,
including signature checks, superko, negotiated dead groups and area scoring.

## Referee (v2) on local Devnet, 2026-09-26

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
