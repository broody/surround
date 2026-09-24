# Move costs and whole-game proving — 2026-09-07

The current Dojo implementation averages **0.368 STRK per placement** when local
execution resources are priced at the sampled mainnet gas prices. The two recorded
19×19 games cost approximately **116 and 123 STRK** each including creation,
joining, every move/pass, dead-group marking and final scoring.

These are estimates for this implementation, not mainnet receipts or fundamental
costs of Go. No public transactions were sent for this move benchmark.

## Measurements

All six SGFs were replayed through the deployed production Dojo actions contract,
using two accounts signing ordinary Invoke V3 transactions with validation and
fee charging enabled. All **1,177 moves** (1,132 placements and 45 passes), final
boards, capture counts and published winning margins were checked successfully.
The 19×19 B+1.5 game includes 16 dead-group marking transactions.

| Action, across the six games | L2 gas | Estimated STRK |
| --- | ---: | ---: |
| Placement, median | 12,171,600 | 0.335 |
| Placement, mean | 13,395,734 | 0.368 |
| Placement, 95th percentile | 20,011,600 | 0.550 |
| Most expensive sampled placement | 38,011,600 | 1.045 |
| Capturing placement, mean | 14,168,234 | 0.390 |
| Pass, observed range | 7,913,360–10,324,400 | 0.218–0.284 |

“Most expensive” refers only to this corpus, not a worst-case bound. Some
noncapturing moves cost more than captures because they traverse large groups.
Passes also include the work needed to enter scoring after a second pass.

| Recorded game | Board | Moves including passes | Moves only, STRK | Complete game, STRK |
| --- | --- | ---: | ---: | ---: |
| cgos_9_1682833 | 9×9 | 66 | 23.50 | 25.22 |
| cgos_9_1682827 | 9×9 | 79 | 27.29 | 29.07 |
| cgos_13_277988 | 13×13 | 201 | 71.37 | 73.33 |
| cgos_13_277982 | 13×13 | 205 | 76.05 | 77.93 |
| kgs_2019_04_10_39 | 19×19 | 309 | 108.82 | 116.15 |
| kgs_2019_04_26_17 | 19×19 | 317 | 120.04 | 123.13 |

Complete-game totals include both players' transactions and final direct scoring.
They exclude the one-time Dojo class declarations/world deployment and any
production wallet deployment, paymaster, relayer or indexing charges. The games
use long development deadlines; this benchmark does not measure network latency.

For a dollar illustration at **$0.03 per STRK**, the average placement is **1.1¢**
and the two complete 19×19 games are **$3.48–$3.69**. This exchange rate is an
explicit scenario, not a live market quote.

## Pricing and reproducibility

Local execution used **Starknet Devnet 0.8.0 / protocol 0.14.2 / BLOB data
availability**, Cairo 2.13.1, Dojo 1.8.0 and the existing Starknet.js 10.5.0
installation. Mainnet was on **0.14.3** at the sampled block. Account choice,
protocol constants, compiler, state and gas prices can change production fees.

The local prices were an artificial 1 FRI per gas to keep disposable accounts
funded. Those local fee amounts are not used as mainnet prices. Each receipt's
three resource quantities were repriced using mainnet block **14,480,560**,
sampled **2026-09-07 00:54:50 UTC**:

- L2 gas: **27,491,408,934 FRI** per unit.
- L1 gas: **81,922,565,303,793 FRI** per unit.
- L1 data gas: **27,351,174,705 FRI** per unit.
- Tip: zero; one STRK is 10¹⁸ FRI.

All modern replay receipts have zero L1 gas; L1 data gas is included in the STRK
figures. The calculation follows the [official fee components and formula](https://docs.starknet.io/learn/protocol/fees).
This is a fixed-price comparison; a live game's transactions occur across many
blocks with changing prices.

An initial Katana 1.7.1 / protocol 0.13.4 replay also passed all six games. Its
resources are retained in `results/moves.json` but are **not** used for the fee
estimates above. It uses an older fee model and a different development account.

From the repository root, with its pinned Sozo/Scarb versions and a Python
environment containing `sgfmill==1.1.1`:

```sh
python benchmarks/run_moves.py
```

The runner builds the actual contracts, starts a fresh local Devnet, migrates the
Dojo world, regenerates validated SGF inputs, replays all games and stops the node.
It deletes temporary disposable keys and logs on exit. `PRIVACY_DIR` can point to
the existing privacy checkout containing the SDK dependency; no wallet files from
that project are read. `SURROUND_MOVE_DEVNET_PORT` selects a free port (default
6071). Reproduction replaces the ignored local `manifest_dev.json` and measurement
JSON files; this dated report describes the recorded run.

Sozo 1.8.6 rejects the Devnet RPC version string. A loopback-only migration adapter
reports RPC 0.9 to that CLI while forwarding execution requests unchanged; the
replay connects directly to the actual RPC 0.10.2 endpoint. This does not change
protocol execution, validation, gas accounting or proof verification. Devnet's
proof support is disabled; this benchmark submits no proofs.

Artifacts: [modern receipts](results/moves-modern.json),
[gas price snapshot](results/mainnet-price-sample.json),
[cost summary](results/move-cost-summary.json),
[validated move inputs](results/move-fixtures.json),
[runner](run_moves.py), [replay worker](moves.mjs).

## Recommendation

**Prototype a whole-game proof next, while retaining the current onchain game as
the reference and dispute engine.** Avoid committing to an offchain redesign
before measuring a legal, authenticated full-game proof.

The existing [real Sepolia scoring proof](SEPOLIA_RESULTS.md) costs 77,738,160 L2
gas plus 480 L1 data gas to settle: **2.137 STRK** at the same mainnet price
snapshot. This is a measured **scoring-only** settlement. It is not a measured
whole-game proof cost. Native verification's 75-million-L2-gas charge creates a
much stronger opportunity when replacing hundreds of transactions instead of one
score calculation. See [SNIP-36](https://community.starknet.io/t/snip-36-in-protocol-proof-verification/116123).

A whole-game prototype should:

1. Open a game onchain with immutable rules, players/session keys, board size,
   komi and settlement/dispute terms. Bind the proof to this exact game and chain.
2. Exchange authenticated moves offchain. The proof checks turns, signatures,
   captures, suicide, positional superko across the full history, pass/resume
   transitions, matching dead-group approvals and the exact final score. The
   existing final-board scorer alone proves none of the preceding move history.
3. Settle the result onchain once. A compact result and transcript commitment
   replace per-move state updates; publish/retain the transcript separately so
   opponents and spectators can retrieve it. A proof does not supply game data.
4. Define an onchain challenge/timeout path for disconnection and withheld
   signatures. An offchain transcript cannot by itself prove that a player
   failed to respond within a real-time deadline. Unilateral settlement must
   account for fresher valid states and the other player's response window.

Measure end-to-end proof generation, memory, signature overhead, native proof
size/limits, settlement gas and prover operating cost. Larger histories may need
chunks or aggregation rather than fitting the current hosted prover's limits.
The 3–4 second hosted timings for scoring cannot be extrapolated to a full game.

If mutually signed results alone are acceptable, cooperative settlement can
omit a proof and be cheaper still. That changes the guarantee: both players
attest to the result rather than the chain verifying every move's legality.
Full-game proving better fits a goal of publicly verifiable legal games, while
moving individual moves offchain changes the original fully onchain gameplay
architecture. Native SNIP-36's current consensus-versus-SNOS security distinction
remains as documented in the Sepolia report.
