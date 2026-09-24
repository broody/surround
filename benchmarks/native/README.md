# Native Sepolia scoring test

This package exercises Starknet's SNIP-36 transaction proving and settlement
with Surround's unchanged deterministic area scorer. It is a measurement
contract with administrator-sealed SGF snapshots; it does not implement the
production Dojo player-agreement flow.

The prover endpoint was recovered from Stake Wars' Whisper operator network
preset: `https://transaction-prover.alpha-sepolia.sw-dev.io`. The network RPC
defaults to `https://starknet-sepolia-rpc.publicnode.com`. Both are configurable
with `SURROUND_SEPOLIA_PROVER` and `SURROUND_SEPOLIA_RPC`. The runner checks
`SN_SEPOLIA` before loading the signing account or sending transactions.

## Contract flow

1. `seal` records an immutable commitment to the complete scoring inputs,
   game/fixture ID, chain, contract address and rules version. Only the owner
   can seal a fixture. Board data is included in the sealing transaction.
2. The prover invokes the contract's restricted account `__execute__` against
   an anchored block at least ten blocks deep. It validates the supplied board
   against the commitment, computes the score, and emits a virtual L2-to-L1
   message binding the scorer class, contract, chain, ID, commitment and scores.
3. `settle` reads native authenticated facts from `get_execution_info_v3_syscall`,
   checks the message and proof schema, and stores the scores without recounting
   the board. The seal cannot change, facts cannot predate it, proof age is
   limited to 4,000 blocks, and a second settlement is rejected.
4. `direct` scores the same sealed inputs onchain into a separate result slot
   for a comparison on the same network and compiler version.

The virtual account cannot execute arbitrary calls or transfer tokens. It
accepts only OS calls with zero resource prices and zero tip, following the
privacy pool's virtual execution pattern. Its input data is public, so it
does not need a privacy key or user signature. Native verification authenticates
the virtual OS/configuration and canonical base block; the contract checks the
application statement. A mock or calldata array is not an alternative to the
transaction's verified facts.

## Commands

Run from this directory with Scarb 2.18.0 and Foundry 0.63.0:

```sh
snforge test
scarb fmt --check
scarb build
```

From the Surround root:

```sh
node benchmarks/sepolia.mjs preflight
node benchmarks/sepolia.mjs deploy
node benchmarks/sepolia.mjs run
node benchmarks/sepolia.mjs negative
node benchmarks/verify_sepolia.mjs
```

**`deploy` and `run` send Sepolia transactions and spend test STRK.** `negative`
submits an authentic proof with an altered message fact and requires rejection
by the native gateway without consuming the signer's nonce. The runner
uses the existing owner-only Starknet account file outside the repository,
selects only `alpha-sepolia.stakewars_sepolia_deployer`, verifies its address and
onchain public key, and keeps its key inside the signing process. It does not
load Stake Wars environment files, use privacy vault keys, or change Stake Wars
contracts. Declaration has a 50 test STRK maximum-fee ceiling; other transactions
have a 10 test STRK ceiling. Actual resource bounds are based on current estimates.

The runner uses the existing `starknet-privacy/sdk` installation for Starknet.js;
`PRIVACY_DIR` can override the sibling checkout path. Proof generation calls the
public prover directly with the documented Invoke V3 protocol, not privacy-pool
actions. Zero-priced virtual resource bounds are distinct from the real
settlement transaction's fee bounds.

Deployment, transaction hashes, receipts, proof facts, proof sizes and timings
are saved incrementally to `../results/sepolia.json`. Re-running resumes recorded
transactions instead of replaying completed actions. Do not delete that state
file or run concurrent copies. Proof responses for these public SGFs are stored
under gitignored `../results/raw/sepolia/`; their digests are in the results file.

The Foundry suite uses injected facts to test contract behavior. The network
runner requires real successful receipts and independently reads settled scores;
only those receipts demonstrate native settlement. Changed-score tests through
fee estimation demonstrate contract rejection in simulation, not proof rejection
by consensus. Neither mode automatically upgrades the production Dojo contracts.

References: [StarkWare transaction prover API](https://github.com/starkware-libs/sequencer/tree/main/crates/starknet_transaction_prover),
[SNIP-36](https://community.starknet.io/t/snip-36-in-protocol-proof-verification/116123),
[STRK20 proving configuration](https://strk20-by-example.org/sdk/proving-config).
