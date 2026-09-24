# Scoring benchmark — 2026-09-07

This records the initial local run. The subsequent [Sepolia native proving
test](SEPOLIA_RESULTS.md) completed real onchain proof settlement for all six games.

**Six real Stwo proofs generated and verified locally; six changed-score proofs rejected.**
All six results match direct contract execution and the published SGF results.

Hardware: Apple M5 Pro, 18 logical CPUs, 64 GiB RAM; macOS ARM64.
Scarb/Cairo 2.18.0, prebuilt Stwo binaries, 8 Rayon threads, sequential proofs.
One measured sample per fixture after a warm-up; build time excluded.

| Game | Board | Result | Prove (s) | Verify (ms) | Proof JSON (MiB) | Direct L2 gas |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| cgos_9_1682833 | 9×9 | W+2.0 | 6.29 | 43.6 | 12.80 | 28,498,160 |
| cgos_9_1682827 | 9×9 | B+8.0 | 6.19 | 35.1 | 13.19 | 30,818,160 |
| cgos_13_277988 | 13×13 | W+20.5 | 6.30 | 33.9 | 13.01 | 37,538,160 |
| cgos_13_277982 | 13×13 | B+31.5 | 7.20 | 34.7 | 12.93 | 34,378,160 |
| kgs_2019_04_10_39 | 19×19 | B+1.50 | 6.97 | 32.2 | 12.99 | 104,298,160 |
| kgs_2019_04_26_17 | 19×19 | B+74.50 | 8.05 | 34.7 | 12.99 | 78,258,160 |

Peak prover resident memory was **16.0–16.3 GiB**. Execution before proving
added 0.12–0.17 seconds. Verification times are local process wall latency,
including CLI startup, not onchain verification gas or network latency.
Raw JSON sizes are diagnostic artifacts; they are not native SNIP-36 wire sizes.

## What these numbers establish

The proof commits to the scorer program and public result. The benchmark binds
board size, rules version, komi, board hash, agreed dead-stone input and both
scores into a Poseidon commitment. Every verified output matches the direct
contract output exactly. The KGS B+1.5 fixture includes 34 marked dead stones;
its proved scores are Black 184 and White 182.5, including komi.

The local contract is an isolated measurement harness: scorer execution plus
a commitment and two score writes, with ordinary account/transaction overhead.
It does not measure the complete Dojo approval/settlement flow. Devnet 0.8.0
reported Starknet 0.14.2 and RPC 0.10.2. Each transaction also used 384 L1 data
gas and zero L1 gas. Local gas prices were artificially set to 1 FRI per unit;
those fees must not be presented as network prices.

## Cost interpretation and remaining native test

For comparison, the sequencer's versioned **0.14.3** constants specify
`gas_per_proof = 75,000,000` L2 gas. That is a proof-related line item, not a
measured total settlement fee. Contract execution, transaction overhead and
prover compute costs also matter. [Versioned constants](https://github.com/starkware-libs/sequencer/blob/main/crates/blockifier/resources/blockifier_versioned_constants_0_14_3.json)

The evidence favors keeping direct scoring as the default while we exercise
proof settlement separately. The 9×9 and 13×13 direct measurements are below
that proof line item alone. The two 19×19 positions justify a native comparison,
but neither has a demonstrated saving: these direct measurements use 0.14.2
pricing, and the complete 0.14.3 native settlement cost has not been measured.

The installed privacy checkout and its Cairo toolchain were reused, along with
its installed Starknet JavaScript library for local transactions. The cached
ARM64 transaction-prover image was found and its CLI checked. It was not used
to produce these Cairo bootloader proofs.

**This local run did not test native SNIP-36 settlement.** Devnet 0.8.0 advertises a `full`
proof mode, but its implementation rejects those operations. Its other modes
provide mocks or ignore proofs. No mocked proof is counted in these results.
The cached transaction prover targets 0.14.3 and needs a compatible node with
real state proofs and native verification; the installed Devnet reports 0.14.2
and does not implement `starknet_getStorageProof`.
[Devnet 0.8.0 proof documentation](https://github.com/starknet-io/starknet-devnet/blob/v0.8.0/website/docs/proofs.md)

The subsequent Sepolia test generated virtual-SNOS transaction proofs, submitted
authenticated facts, and recorded real settlement receipts. These local Cairo
bootloader artifacts cannot be submitted as a substitute. Existing Surround
games continue to score directly onchain.

## Reproduction and evidence

- [Commands and benchmark implementation](README.md)
- [Proof timings, resources, digests and local artifact paths](results/proofs.json)
- [Direct scoring transaction resources](results/direct.json)
- [SGF corpus and provenance](../tests/fixtures/sgf/manifest.json)
- [Native integration design](../STWO_SCORING_PLAN.md)
