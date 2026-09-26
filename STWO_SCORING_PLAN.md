> Historical score-only exploration. Surround now proves full offchain games;

> **Status (2026-09-26):** historical plan. Surround now settles full games through referee's proof adapter; see [PROVING_PLAN.md](PROVING_PLAN.md).

> see [OFFCHAIN_PROTOCOL.md](OFFCHAIN_PROTOCOL.md).

# Surround: Stwo scoring through SNIP-36

Research updated: 2026-09-07. Status: local and native Sepolia Stwo benchmarks
completed; production Dojo integration remains a design. Existing games still
score directly onchain.

The [local benchmark](benchmarks/RESULTS.md) generated and verified six real Cairo
bootloader proofs, matched all published scores, and rejected changed scores.
It also measured direct scoring on a temporary local Devnet. That initial run
was not native SNIP-36 settlement.

The subsequent [Sepolia benchmark](benchmarks/SEPOLIA_RESULTS.md) deployed the
isolated native scorer, generated six real virtual-SNOS proofs with StarkWare's
public alpha-Sepolia prover (found in Stake Wars), and settled all six onchain.
It matched the recorded scores and direct onchain results. The native gateway
rejected an authentic proof paired with altered message facts (RPC error 69).
There are 18 passing native-contract tests. This harness uses administrator-sealed
fixtures; it has not connected proof settlement to the Dojo player agreement flow.

## Decision

Target Starknet's native Stwo transaction-proving path, using the STRK20
implementation as a reference for generating and consuming proof facts.
Surround's objective is verifiable scoring of a public Go position. Token pools,
shielding, viewing keys, and private transfers are outside this change.

This supersedes the earlier Stone/Integrity recommendation. The relevant STRK20
references are its [proving workflow](https://strk20-by-example.org/sdk/proving-config)
and the [Starknet transaction prover](https://github.com/starkware-libs/sequencer/tree/main/crates/starknet_transaction_prover).

## Release context

- **0.14.2:** introduced native Stwo verification through SNIP-36, optional
  `proof` / `proof_facts` fields on Invoke V3, and execution-info v3 for accessing
  facts in contracts. The release notes list April 13, 2026 for mainnet.
  [Release notes](https://community.starknet.io/t/0-14-2-pre-release-notes/116146)
- **0.14.3:** the latest detailed protocol release notes found in this review;
  they list July 6, 2026 for mainnet. The verifier adds Keccak support and rejects
  proofs produced for 0.14.2, so the prover must be upgraded with the network.
  RPC 0.8 is deprecated. The release also changes storage pricing/block cadence,
  so earlier local gas measurements need remeasurement on the target version.
  [Release notes](https://community.starknet.io/t/starknet-0-14-3-pre-release-notes/116211)
- The official roadmap lists **0.15 for September 2026**. That is a roadmap,
  not evidence that a particular node has upgraded. This review did not obtain
  a successful live RPC version check; verify the target node's block version,
  RPC version, and accepted prover revision before pinning the integration.
  [Version roadmap](https://www.starknet.io/developers/version-releases/)

SNIP-36's documented first phase verifies proofs in Starknet consensus; it does
not yet prove their verification to Ethereum through SNOS. No source examined
here established that this limitation has been removed. This distinction must
remain explicit when describing the proof mode's security.
[SNIP-36](https://community.starknet.io/t/snip-36-in-protocol-proof-verification/116123)

## Concrete flow

```mermaid
sequenceDiagram
    participant Players
    participant Game as Surround contracts
    participant Prover as Stwo transaction prover
    participant Network as Starknet native verifier
    Players->>Game: Approve the same dead-group proposal
    Note over Game: Seal the scoring statement for proof settlement
    Prover->>Prover: Execute scoring transaction in virtual SNOS
    Prover-->>Players: Proof, facts, scoring message
    Players->>Network: Submit settlement Invoke V3 with proof and facts
    Network->>Network: Verify proof and its facts
    Network->>Game: Execute settlement with verified facts available
    Game->>Game: Match message to sealed statement; record scores
```

The transaction prover runs an **Invoke V3 against an anchored Starknet block**;
it is not an endpoint for arbitrary standalone Cairo proofs. A successful local
`scarb prove` / `scarb verify` round trip alone does not exercise this network path.
Use its documented `starknet_proveTransaction` request and retain its actual
proof, facts, and messages. Bind to a specific block hash that contains the
sealed proposal; do not copy STRK20's note-maturity policy into a Go game.
[Prover API](https://github.com/starkware-libs/sequencer/tree/main/crates/starknet_transaction_prover)

The scoring entry point must emit a committed result from virtual execution,
following STRK20's virtual L2-to-L1 message pattern. Returning `preview_score`
values alone does not produce the required result message. In the reference,
the message hash binds the emitting contract, destination, payload length,
contract class hash, and serialized actions.
[Reference message handling](https://github.com/starkware-libs/starknet-privacy/blob/bc75e4bac71ad0ce10c6e63effc33b5b25131a4f/packages/privacy/src/utils.cairo)

## Surround changes to implement

| Location | Intended change |
| --- | --- |
| `src/rules.cairo` | Reuse the existing deterministic scorer for virtual execution and direct-scoring comparison. |
| `src/models.cairo` | Add explicit proof settlement mode and a sealed statement/deadline after matching approvals. |
| `src/systems/actions.cairo` | In proof mode, the second approval seals the proposal; a separate settlement call consumes authenticated facts and records the score. |
| New scoring/proof adapter | Compute the score in virtual execution, publish the committed message, and validate native proof facts during settlement. |
| New prover client | Construct the virtual Invoke V3, call the Stwo service, validate returned messages, and submit the real settlement transaction. |
| `src/tests/test_sgf.cairo` and SGF corpus | Compare the same recorded results across direct and proof settlement, starting with KGS B+1.5 / 34 dead stones. |

The statement should bind a domain/version, chain ID, world and actions addresses,
authorized scorer address and class hash, game ID, rules version, board size,
komi, board hash, dead-stone mask, scoring round/revision, and both half-point
scores. The virtual scorer must derive these fields from the game snapshot and
compute the scores itself, rather than merely echoing prover-supplied claims.

At settlement, read facts through `get_execution_info_v3_syscall`; calldata that
looks like proof facts is not authentication. Validate the exact supported
schema and message, then compare the statement with current stored game state.
Reject missing/malformed facts, extra unparsed data, wrong senders/classes,
changed scores, another game/world/chain, stale proposals, and duplicate
settlement. Apply an explicit base-block freshness policy.
[STRK20 consumer reference](https://github.com/starkware-libs/starknet-privacy/blob/bc75e4bac71ad0ce10c6e63effc33b5b25131a4f/packages/privacy/src/privacy.cairo#L808)

Disputes before matching approvals continue to resume play. After agreement,
freeze the statement for a bounded proving window. Proposed liveness fallback:
anyone can trigger the existing direct scorer against that same sealed statement
after the proof deadline. The proof exercise must demonstrate settlement before
that fallback; direct scoring is not evidence of successful proof verification.

## Compatibility work before implementation

Surround currently pins **Scarb/Cairo 2.13.1, Dojo 1.8.0, Sozo 1.8.6** and was
tested with Katana 1.7.1. Cairo 2.13.1's syscall module does not expose execution
info v3, so it cannot compile the native fact reader unchanged.
[Pinned Cairo source](https://github.com/starkware-libs/cairo/blob/v2.13.1/corelib/src/starknet/syscalls.cairo)

The STRK20 source inspected at commit
`bc75e4bac71ad0ce10c6e63effc33b5b25131a4f` uses Scarb **2.18.0** and Foundry
**0.63.0**. Its compatibility matrix lists transaction prover
`PRIVACY-0.14.3-RC.2` with SDK `PRIVACY-0.14.3-RC.6`; these are reference versions,
not yet tested pins for Surround. Check a Dojo/toolchain combination supporting
the syscall; if that requires an incompatible Dojo migration, isolate the
adapter in a separately compiled Cairo package with a narrow authenticated ABI.
[Toolchain](https://github.com/starkware-libs/starknet-privacy/blob/bc75e4bac71ad0ce10c6e63effc33b5b25131a4f/.tool-versions)
· [Compatibility matrix](https://github.com/starkware-libs/starknet-privacy)

The skill's freshness script was run: it found wallet-package and anonymizer-path
drift, and one unrelated AVNU registry lookup failed. The repository changelog
confirms that sub-accounts were renamed to shadow accounts. These privacy APIs
are not dependencies of the scoring design; do not adopt the skill's old pins
as a proving compatibility guarantee.

## Validation milestone

1. Compile and test the native fact consumer with a compatible toolchain while
   retaining the existing 50 passing tests as the regression baseline.
2. Exercise statement encoding and rejection cases locally; label any injected
   proof facts as mocks, not cryptographic verification.
3. On a SNIP-36-capable development network or Sepolia, deploy the scorer and
   game, agree the KGS fixture's markings, generate a real Stwo proof, and settle
   using native verification. Record the actual network version, pinned prover,
   base block, proof digest, and transaction receipt.
4. Confirm the recorded B+1.5 result and that changed scores or stale statements
   fail. Extend to all six SGFs and measure proving latency, proof size, and
   settlement cost on the actual environment.

The native proof/settlement path has now been measured on Sepolia in the isolated
harness. All six settlements used 77,738,160 L2 gas. Compared with direct scoring,
the 19×19 position with 34 dead stones saved 25.5%; the other 19×19 fixture saved
0.7%, while the smaller boards cost more to settle by proof. See the dated report
for receipts and limits. The remaining production milestone is connecting this
authenticated path to actual Dojo game snapshots, matching player approvals,
proposal revisions and fallback deadlines, then exercising that complete flow.
