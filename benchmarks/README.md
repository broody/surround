# Local scoring and Stwo benchmark

> **Status (2026-09-26):** these benchmarks measured the per-move onchain system and the pre-referee channel, both since removed. The scripts target commit `2a56a00`; the results stay as the cost baseline.

For per-move costs, complete-game fees and the whole-game proving recommendation,
see [MOVE_COSTS.md](MOVE_COSTS.md). Its runner replays the real Dojo game locally.

Run results: [RESULTS.md](RESULTS.md). All six recorded games passed direct
scoring, real Stwo proving, local verification, and rejection of a changed score.

This exercises Scarb's Cairo bootloader proof path. It does **not** implement
native SNIP-36 settlement or change Surround's existing Dojo game contracts.
The subsequent [native Sepolia benchmark](SEPOLIA_RESULTS.md) exercises real
network settlement; see [its implementation and commands](native/README.md).

## Reproduce

Requirements: Scarb **2.18.0**, Python with `sgfmill==1.1.1`, Node >=24,
Starknet Devnet **0.8.0**, and the installed `starknet` JavaScript dependency in
the sibling `starknet-privacy/sdk` checkout. The benchmark inherits neither that
project's environment files nor its wallet keys. Set `PRIVACY_DIR` if the
checkout lives elsewhere. Root Dojo contracts retain Cairo 2.13.1.

From the Surround root, prepare inputs and build the measurement contract:

```sh
python3 -m venv .venv-fixtures
.venv-fixtures/bin/pip install sgfmill==1.1.1
.venv-fixtures/bin/python benchmarks/prepare.py
(cd benchmarks/settlement && scarb build)
```

In a separate terminal, start a **fresh** local devnet (stop it with Ctrl-C
after measuring). No proof fields are submitted to this node; it measures only
ordinary direct execution. Devnet's `devnet` proof mode is a mock facility and
is not used to claim proof verification.

```sh
starknet-devnet --host 127.0.0.1 --port 6060 --seed 42 --accounts 3 \
  --chain-id SN_SURROUND --state-archive-capacity full --proof-mode devnet \
  --gas-price-fri 1 --data-gas-price-fri 1 --l2-gas-price-fri 1 >/dev/null 2>&1
```

Then run from the Surround root:

```sh
node benchmarks/direct.mjs
RAYON_NUM_THREADS=8 python3 benchmarks/prove.py
.venv-fixtures/bin/python benchmarks/prepare.py --check
```

The proof run is sequential and uses roughly 16 GiB of peak resident memory
per proof in this recorded environment. `scarb` is invoked inside the benchmark
package so asdf selects its local `.tool-versions`, not the root Dojo version.
Do not run concurrent benchmark processes against the same output directories.

## What is checked

`prepare.py` replays the existing SGF corpus with its independent Python
reference. It copies the exact production rules into the isolated Cairo package,
removing only two Dojo-specific storage derives. `--check` detects stale copies
and fixture inputs without writing files.

`direct.mjs` declares a benchmark contract and submits six ordinary transactions
on localhost. Each transaction runs the same scorer and stores the statement
commitment and both half-point scores. It checks the recorded winning margin
and saves actual local receipts in `results/direct.json`.

`prove.py` builds once, executes the six inputs, generates real Stwo proofs with
`scarb prove`, and verifies them with `scarb verify`. It checks all public output
felts against execution output, matches the statement and both scores against
direct contract results, checks a common executable program hash, and mutates
the public black score in each proof to require cryptographic rejection.

Scarb 2.18.0's standalone target has a public-segment adapter bug. The explicit
`--target bootloader` wraps the scorer and produces valid proofs with the existing
installation. This is the Cairo bootloader, **not virtual SNOS**. The source and
workaround are discussed in [upstream issue #1733](https://github.com/starkware-libs/stwo-cairo/issues/1733).

The benchmark commitment binds rules/domain version, board size, komi, position
hash, dead-stone mask and both scores. It is an input/output consistency check;
the isolated contract does not authenticate players, game IDs or agreed proposals.
The production integration needs those bindings and native verified facts as
described in [the scoring plan](../STWO_SCORING_PLAN.md).

## Artifacts and timing

- `results/proofs.json`: per-fixture resources, wall times, process peak RSS,
  source/executable hashes, proof paths and SHA-256 digests.
- `results/direct.json`: actual local transaction resources and result felts.
- `scoring/target/execute/…/proof/proof.json`: real proof artifacts.
- `results/raw/`: execution, proving, verification and tampering logs.

Large proof artifacts and logs are gitignored. Proof sizes refer to the raw JSON
artifact, not compressed native transaction payloads. Timings include CLI startup;
execution, proving and verification are recorded separately. Compilation is
excluded. These are single samples with a warm-up run on one machine, not a
statistical throughput study or a production latency promise. Re-running scripts
refreshes JSON measurements; the checked-in RESULTS.md describes the dated run.
