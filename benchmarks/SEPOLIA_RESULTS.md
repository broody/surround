# Native Stwo scoring on Sepolia — 2026-09-07

**All six recorded games settled successfully using real native SNIP-36 proofs.**
StarkWare generated virtual-SNOS proofs, Sepolia accepted them, and Surround’s
scoring harness consumed authenticated facts to record the exact expected scores.

[Deployed scorer](https://sepolia.voyager.online/contract/0x204931c3149d6804a8115f98fbb72d2bd669f3519048216b5b3a1d166b022e) · [Declaration](https://sepolia.voyager.online/tx/0x6caabb358506f2766a6e328941a2cf02874f1aa33ece3e54e81dd9ab72b138f) · [Deployment](https://sepolia.voyager.online/tx/0x19a88465aaa49bf95e940a99f01dd86d205dd3d8d0a12b86fb096f5465817e3)

## Measured comparison

Both paths used the same immutable input commitments, contract, Cairo compiler
and Sepolia network version. Positive savings mean native proof settlement used
less L2 gas than direct scoring.

| Recorded game | Board | Result | Remote prove (s) | Proof (KiB) | Direct L2 gas | Proof settlement L2 gas | L2 gas saving |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| [cgos_9_1682833](https://sepolia.voyager.online/tx/0x3a2a15a2ebe24555142a00193b4a12e67f962d8fd461bbe5cfc95aefd5a8e45) | 9×9 | W+2.0 | 3.12 | 228.8 | 28,538,160 | 77,738,160 | -172.4% |
| [cgos_9_1682827](https://sepolia.voyager.online/tx/0x7b1889d0ce255de3865eab96b579bc48039ccd6cb6c86288607a6a155c5d1b2) | 9×9 | B+8.0 | 3.00 | 233.0 | 30,858,160 | 77,738,160 | -151.9% |
| [cgos_13_277988](https://sepolia.voyager.online/tx/0x75309261cc0d9a4028d7518a9b4be99bc41b2fbacbc9bf1f9bc07482c779b78) | 13×13 | W+20.5 | 3.00 | 230.2 | 37,578,160 | 77,738,160 | -106.9% |
| [cgos_13_277982](https://sepolia.voyager.online/tx/0x5a1e94212142f4f56f75047268b45e648b46e68865d9929da9e4f4a3161f06f) | 13×13 | B+31.5 | 3.37 | 221.6 | 34,418,160 | 77,738,160 | -125.9% |
| [kgs_2019_04_10_39](https://sepolia.voyager.online/tx/0x4543daf0854a5f95ce309b690037971504947fde931138be79cbacba13bc8c9) | 19×19 | B+1.50 | 3.57 | 230.3 | 104,298,160 | 77,738,160 | +25.5% |
| [kgs_2019_04_26_17](https://sepolia.voyager.online/tx/0x613a1aa8a5b9e86b3010eb2324223a140a7db2e78788a2d66d5ce2197119fdf) | 19×19 | B+74.50 | 3.78 | 224.7 | 78,258,160 | 77,738,160 | +0.7% |

For the 19×19 KGS game with **34 dead stones**, proof settlement saved **25.5%**
of L2 gas while preserving B+1.5 (Black 184, White 182.5 including komi). The
other 19×19 game saved only **0.7%**. Direct scoring was cheaper for the smaller
boards. These six examples support offering proof settlement as an optional
path; they do not establish a saving for every 19×19 position.

Each direct and proved settlement also consumed 480 L1 data gas and zero L1 gas.
Native settlement’s total includes the proof charge and contract/account work;
it is an actual receipt measurement, not the earlier 75-million-gas estimate.
At the observed Sepolia gas price, proof settlement cost about **2.11 test STRK**
per game. Hosted-prover compute pricing is not included; no service price was
provided. Proof timings are one request per game, including HTTP latency, with
no throughput or production availability guarantee.

One-time setup: declaration **16.1112 test STRK**, deployment **0.0465**, and sealing all six snapshots **0.2492**. These setup costs are excluded
from the per-settlement gas comparison. The full run spent **37.6115 test STRK**
including setup, six direct transactions and six proof settlements. No mainnet
funds or deployments were used.

## Verification

- All six onchain scores match the published SGF results and direct contract output.
- All six altered-score fee simulations fail with `Wrong proved message`.
- An actual submission with an authentic proof but altered message facts was
  rejected by the native gateway with **RPC error 69: invalid proof field**.
  The signer’s nonce remained unchanged; this is distinct from a simulated rejection.
- A second RPC independently confirmed the deployed class, all six successful
  receipts, settled scores and exact onchain proof facts.
- All **18 Foundry tests** pass, covering immutable snapshots, owner access,
  input/score/game binding, malformed/extra facts, versions, age and replay.
  These unit tests inject facts and are not themselves cryptographic verification.

## Exact environment and artifacts

- Network: **SN_SEPOLIA / Starknet 0.14.3**.
- Submission RPC: `https://starknet-sepolia-rpc.publicnode.com` (RPC 0.10.2).
- Independent RPC: `https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10`.
- Prover: `https://transaction-prover.alpha-sepolia.sw-dev.io` (API 0.10.3-rc.2),
  recovered from Stake Wars’ `vendor/whisper/operator/src/networks.ts`.
- Scarb/Cairo **2.18.0**, Foundry **0.63.0**, existing privacy checkout’s
  Starknet.js **10.5.0**. Root Dojo contracts retain their existing toolchain.
- The proving blocks were anchored by hash and at least ten blocks deep.
  Returned proof versions, block hashes, message hashes and result payloads
  were checked before submission. Binary proof sizes are base64-decoded bytes,
  not the large JSON artifacts from the earlier local Cairo bootloader test.
- [Deployment, receipts, fees, proof facts and digests](results/sepolia.json)
- [Second-RPC verification](results/sepolia-verification.json)
- [Native contract and reproduction commands](native/README.md)
- [Earlier local benchmark](RESULTS.md)

## Integration boundary

This is an immutable scoring harness whose administrator seals recorded-game
inputs. **The Dojo game still scores directly onchain.** Production integration
must connect native settlement to player-approved snapshots, game revisions,
proof deadlines and the direct-scoring fallback. No Stake Wars contract was
changed, and no privacy pool, wallet registration or private token operation
was needed for proving public Go scores.

SNIP-36 currently authenticates these proofs in Starknet consensus. Its documented
first phase does not prove their verification to Ethereum through SNOS; successful
Sepolia settlement does not remove that protocol distinction.
[SNIP-36 specification](https://community.starknet.io/t/snip-36-in-protocol-proof-verification/116123)
