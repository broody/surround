# Proving plan: self-hosted native proofs and full-game settlement

> **Status (2026-09-26):** Surround now runs on [referee](https://github.com/broody/referee). The channel, adapter and proving executable build from the Dojo-free `rules/` crate, and an adapter allowlist replaces the class pin (`pin.mjs` and `prepare.py` are gone). Measurements below predate that move. The 68-step 9×9 game now executes in 0.46M VM steps and the 311-step 19×19 game in 1.13M (`offchain/prove.py --execute-only`).

Created 2026-09-24. Status: in progress. Measurement tooling and the v2 rules
implementation exist locally and are not committed; see the update below.

Goal: settle a complete 19×19 game with **one** native proof from a prover we
operate. Today we use StarkWare's hosted alpha prover, which rejects transcripts
above about 64–128 actions (`Not enough twiddles!`). The 311-action KGS game
therefore needed five checkpoint proofs and 15.34 test STRK
([results](offchain/RESULTS.md#actual-sepolia-native-proof-settlement)).

The approach reuses Templar's server-side proving work
(`~/development/templar`). Proving stays **server side**. Surround's transcripts
are public, so we need no client-side proving, blinding or hiding argument. See
[Decisions](#decisions).

## Workstreams

| # | Workstream | Depends on | Network gate |
| --- | --- | --- | --- |
| A | Self-hosted prover server | — | none (PROOF1 works today) |
| B | Bounded-memory proving | A (prove binary) | none |
| C | Trace sizing for the PROOF1 small path | A (os-runner) | none |
| D | PROOF2 large path for full games | A, B, new adapter | Sepolia gateway accepting PROOF2; mainnet 0.14.4 |
| — | Batching several games per proof | D | deferred until usage justifies it |

A, B and C run on Sepolia today. D needs the adapter changes below, and settlement
waits on the network.

### Update 2026-09-24: aim for a full game in PROOF1

Templar's original felt252 pipeline (its ADR-0018) worked like this: a Cairo
account runs in the virtual OS, and that run is proved with PROOF1
(`privacy_recursive_prove`). It used about 13–14 GiB with stock allocations,
or 6–9 GiB with bounded memory. **Surround's hosted-prover route is the same
pipeline.** Templar's statement fit PROOF1 because it was small (about 0.5M
steps). Its 7.3M-step bridge failed with the same `Not enough twiddles!` error
that Surround hits. PROOF1's limit is the size of each trace component,
not total memory.

#### Measurements (KGS 311-action game)

All measurements run the real `ChannelProver` in the pinned virtual OS against
Sepolia state (`offchain/server/tools/os-job.mjs`). The trace is measured with
`offchain/server/capacity`, which runs the privacy bootloader on the PIE and
reports instructions per opcode and every component's log size. PROOF1 allows
2²⁰ rows per component.

| Adapter | PIE steps | Trace instructions | Poseidon | Components over 2²⁰ |
| --- | ---: | ---: | ---: | --- |
| v1, 64 actions (hosted prover: fit) | 1.21M | — | 4,385 | none |
| v1, 128 actions (hosted prover: failed) | 2.14M | 5.66M | 8,289 | `add_opcode` 2²¹ |
| v1, 311 actions | 6.16M | — | 19,424 | eight components, up to 2²² |
| v2 (bitboard rules), 128 actions | 0.80M | 4.31M | 4,385 | `add_opcode` 2²¹ |
| v2, 311 actions | 1.66M | 9.90M | 10,396 | `add_opcode`, `memory_id_to_big` 2²²; five more at 2²¹ |
| **v3** (v2 plus final-signature authentication), 311 actions | 1.32M | **1.57M** | 10,396 | `cube_252`, `range_check_252_width_27` (Poseidon) 2²¹ |
| v3, 319 actions (KGS B+74.5) | 1.31M | 1.56M | 10,583 | the same two |

v2 and v3 figures use a measurement stub instead of the Dojo channel (`offchain/measure`).
Measured with v1, the Dojo read costs about 0.3M more PIE steps.

**Signatures dominate the trace.** The virtual OS checks each ECDSA signature
with three `ec_op` builtin calls. Stwo has no `ec_op` component, so the
bootloader emulates each call in Cairo, at about 8.8k instructions. That is
about 26k trace instructions per signed action, or 8.2M of the v2 game's 9.9M.
PIE step counts do not show this cost.

**v2 rules (done, uncommitted).** `rules::play` and `rules::score` use bitboards:
dilation by `u128` wide multiplications with row and column masks, early-exit
liberty searches and a SWAR popcount. `transition` reuses the action hash that
`replay` already computed. The replay dropped from 5.21M to 1.11M steps (4.7×).
Semantics are unchanged:
- all seven fixtures match the JS replay;
- 69 Dojo tests and 15 adapter tests pass.

The adapter class changes (`0x2d60dd…`), so settlement needs a repin and a new
channel version.

#### Remaining levers for one PROOF1 per game

1. **Verify only each player's final signature per proof** (**done**; see
   [OFFCHAIN_PROTOCOL.md](OFFCHAIN_PROTOCOL.md#final-signature-authentication)).
   It removes about 8.1M trace instructions from the full game. Signed messages
   are unchanged.
2. **Poseidon is now the only limit.** With v3, every other component is at
   2¹⁹ or less. `cube_252` passed 2²⁰ between 8,289
   and 10,396 permutations. A full game uses about 9,000 in the replay plus
   about 1,400 in the OS (hashing the transaction's calldata). Per action,
   `state_hash` (about 17 permutations over 31 fields) is the largest cost.
   Options:
   - omit intermediate signatures from calldata, once (1) lands;
   - hash a packed state encoding (a protocol version change);
   - accept two checkpoints for long 19×19 games.
3. If neither suffices, D (PROOF2) proves any game length in one proof.

If a full game fits PROOF1, **D becomes a fallback**. It would also make the
~8 GiB proof feasible on a player's own desktop, which removes the dependency
on a prover service for players who have the hardware.

### A. Self-hosted prover server

Adapt `templar/server/` (≈1,500 lines of Rust across three binaries) into
`offchain/server/`.

| Templar binary | Reuse for Surround |
| --- | --- |
| `templar-os-runner` | **Nearly as is.** Its input is `{rpc_url, chain_id, block_number, transaction}` with an `INVOKE_V3`, which is exactly the transaction `proveSession` builds. It runs the virtual OS and writes the Cairo PIE plus L2→L1 messages. Pinned on `broody/sequencer@625929a`; needs `cairo-lang==0.14.3a3` at build time. |
| `templar-prove` | Large-path (PROOF2) prover on `broody/proving@b54ed94f8` with bounded storage. Used for D. For PROOF1 in the meantime, either self-host upstream `starknet_transaction_prover` or add a small-path entry point; decide in A.1. |
| `templar-prover` (HTTP) | Keep: job queue, per-job cgroup v2 sandbox and timeouts, no-network proving, rate limits, dedup, startup pin checks. **Drop:** OHTTP and the client-proof bridge pre-check (privacy features). **Replace:** relation config with Surround's channel/adapter config, and the pre-check with a Surround replay (see A.3). |

Tasks:

- [ ] A.1 Decide the PROOF1 route for the server: self-host StarkWare's
      `starknet_transaction_prover` (a drop-in for today's `proverUrl`) or a
      small-path mode in our prove binary. Record the pinned revisions.
- [ ] A.2 Port the os-runner. Verify its virtual-OS program hash matches what
      the network accepts, and that a Surround 9×9 transcript produces exactly
      the message `validateNativeProof` expects.
- [ ] A.3 Pre-check: before spending proving time, run the transcript through
      the SDK `replay` or the `offchain/proving` executable, and reject
      malformed or illegal submissions cheaply. The pre-check has no authority;
      the network verifies the proof.
- [ ] A.4 API. Proofs take minutes, so use an async job API (submit, then poll
      status) instead of one blocking `starknet_proveTransaction` call. Either
      add a job mode to `proveSession` or offer a
      `starknet_proveTransaction`-compatible shim for short PROOF1 jobs.
- [ ] A.5 Startup checks: chain ID, channel and adapter class hashes against
      the pin, OS program hash, RPC version (v0.10). Refuse to start on any
      mismatch, as Templar does.
- [ ] A.6 Deployment: systemd unit with `Delegate=yes` or Docker, from
      Templar's `deploy/`. Budget 4 cores / 32 GiB per concurrent job. Build
      with `RUSTFLAGS="-C target-cpu=native"` (about 1.7× faster).
- [ ] A.7 Acceptance: settle `cgos_9_1682833` on Sepolia through our own
      server, and match the hosted-prover result (W+2.0, same facts layout).

### B. Bounded-memory proving

Templar's fork of `starkware-libs/proving` streams commitment trees and FRI
columns. Its proofs are byte-identical to upstream. On Templar's workloads it
used about 37% less RAM and took about 38% longer (9.00 → 5.69 GiB).

- [ ] B.1 Build our prove binary against the bounded branch, configured with
      `cairo_fri_columns`, `circuit_fri_columns` and `stream_commitments`.
- [ ] B.2 Re-measure `offchain/prove.py` (local bootloader proofs, currently
      19.8–34.4 GiB) with bounded storage on and off. Confirm the proofs are
      identical and still reject the mutated score.
- [ ] B.3 Measure the server's virtual-OS proofs for all six fixtures, both
      modes. Pick the server default and record peak RSS and time in
      `offchain/RESULTS.md`.
- [ ] B.4 Track the fork's upstream status (Templar's draft `broody/templar#2`);
      the fork is unreviewed.

### C. Trace sizing for the PROOF1 small path

Until D is available, find how many actions fit in one PROOF1 checkpoint and
raise that number. The replay currently costs about 42–46k Cairo steps per
action: 3.1M steps for 68 actions, 14.7M for 319.

- [x] C.1 Capacity tooling: `offchain/server/capacity` (trace per opcode and
      component), `offchain/server/tools/os-job.mjs` (virtual-OS job for any
      fixture prefix), `offchain/server/tools/measure.mjs` (Sepolia measurement
      games and adapter stubs), and Templar's `templar-os-runner`. See the
      measurements above.
- [x] C.2 Profile the adapter's replay by cost: ECDSA session signatures,
      capture flood fill, superko set, Poseidon state hashing. Note that the
      OS also hashes the executed adapter bytecode (Templar's main Blake2s
      cost), so smaller executed code helps too.
- [ ] C.3 Optimize the largest contributors. Bitboard rules and the action-hash
      dedupe are done; final-signature authentication awaits review. Any adapter change needs a
      rebuild, repin and new channel version (`offchain/pin.mjs`), so group
      these with the D adapter change where possible.
- [ ] C.4 Set the SDK/runner default checkpoint size from the measured
      limit instead of the hard-coded 64 in `offchain/sepolia.mjs`.

### D. PROOF2 large path for full games

Starknet v0.14.4's large path (`privacy_recursive_prove_large`) accepts traces
up to 2²⁵–2²⁹. Templar proves 3–7M-step transactions on it at about 2 min and
50–60 GiB. That trace is independent of any client proof, so Surround's
13–15M-step 19×19 replays should fit in a single proof. This needs measuring
(D.3).

- [x] D.1 Adapter (class `0x3ae841…`, pinned in `src/channel_prover_pin.cairo`):
  - accepts `'PROOF1'` and `'PROOF2'` facts;
  - checks `virtual_program_hash` against an OS program fixed by a constructor
    argument, so an OS upgrade needs a new instance of the same pinned class
    rather than a new channel version;
  - exposes `os_program()`;
  - 19 Foundry tests, 4 of them new.
- [x] D.2 SDK: `validateNativeProof` accepts both versions and requires the
      adapter's `os_program`, which `proveSession` reads. `VIRTUAL_OS_PROGRAM` is
      the v0.14.4 value that deployment scripts pass. Still open: remove the fixed
      checkpoint size when the configured prover supports the large path.
- [x] D.3 Both 19×19 games proved as one PROOF2 each: the v3 adapter run in the
      virtual OS on Sepolia state, proved with Templar's `templar-prove` (large path,
      bounded storage, 8 threads). Each proof verified, and each attested message
      hash equals the expected transition. The smaller boards remain to be run.

      | Game | Actions | Proving | Peak RSS | Proof |
      | --- | ---: | ---: | ---: | ---: |
      | kgs_2019_04_10_39 (B+1.5) | 311 | 86 s | 28.3 GiB | 251,435 B |
      | kgs_2019_04_26_17 (B+74.5) | 319 | 80 s | 26.1 GiB | 256,049 B |

      Both proofs are well under the gateway's 480,000-byte cap.
- [ ] D.4 Repin, deploy a new channel version on Sepolia, and settle the KGS
      game in one transaction once the gateway accepts PROOF2. It rejected
      PROOF2 with `PROOF_VERSION_NOT_ALLOWED` on 2026-09-20 and 2026-09-23.
      Compare the fee with the five-checkpoint 15.34 STRK. Templar measured a
      fixed per-proof charge of about 75M L2 gas.
- [ ] D.5 Mainnet: 0.14.4 is scheduled for 2026-10-05, pending governance.
      Confirm the node, RPC and accepted prover revisions before pinning.

## Deferred: batching

One large proof over several games' settlements would spread the fixed cost
(about 87 s / 42 GiB per proof and the per-proof gas) across them. Games are
public and independent, so this fits naturally. Revisit it when concurrent
settlements regularly queue behind one another on the server. Batching needs an
adapter that can verify several messages, and a policy for how long to hold a
settlement while a batch fills.

## Decisions

- **No client-side proving.** Templar's compact client proof exists so a
  private witness never leaves the device. Surround's transcripts are public,
  so the server can prove the Cairo replay directly. A client proof would add
  a Go circuit and a verifier step whose fixed cost exceeds the whole 9×9 proof
  today, and it would not remove the server.
- **Prover trust stays unchanged.** The server sees public transcripts and
  signatures only, never session keys. It can delay or refuse service, but it
  cannot forge a result. Anyone can run one, and disputes plus direct replay
  remain the liveness fallback (see [protocol](OFFCHAIN_PROTOCOL.md)).

## References (Templar)

- `server/`, `docs/prover-server-spec.md` and its design review: server
  design and threat model.
- `bench/m31-private-wrapper/proof2-large/README.md`: large-path build and results.
- `bench/bounded-memory/README.md`: bounded storage design and measurements.
- `bench/m31-private-wrapper/server-log20/README.md`: PROOF1 budget analysis.
- `bench/m31-pool/cairo/src/adapter.cairo`: PROOF2 fact adapter to model D.1 on.
