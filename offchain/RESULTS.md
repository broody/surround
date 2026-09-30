# Offchain verification results

Measured 2026-09-07 on Apple M5 Pro, 64 GiB RAM, with eight prover threads.
The signed fixture corpus adds scoring proposal/acceptance actions to the six
published SGFs. These measurements use the implemented full-game protocol,
including signature checks, superko, negotiated dead groups and area scoring.

## Referee v5 on Sepolia, 2026-09-30

Surround on referee protocol v5 (`262873e`), which lets a timed game take its
randomness from its referee. Go takes none, so nothing in a game changes; the
channel, kifu, adapter and `SurroundRatings` classes all do, since the time
control in the terms and in a rated ticket gained a field (`rng_tip`, always 0
here). A new world (seed `surround-sepolia-v5`):
[record](results/sepolia-v5.json). Addresses:

| Contract | Address |
| --- | --- |
| world | `0x33051c29b7c36b6f2b8eb22cb74ff066057c2e10fe1d6f824cf3019e960ba72` |
| channel | `0x3756953756562a79e97367a4a207f09316110ea42ed941747d691cb9d454090` |
| kifu | `0x2a90d77faf5e25d5b6a6376d13f361791f6cfff008cfb69378c5a0c1aeb1d73` |
| SurroundRatings v2, v5 tickets (sealed; bands 23k, 17k, 6k) | `0x218768821e5f4f2c1910c74f673b7cb4b720509c639ae9ae742d269c79a2af4` |
| native proof adapter (v5) | `0x1ac8e6042f0bbbbecebf2978e414ff73aa97b602af59c041f6d637e83f0c02f` |

The same runs as on v4, all with `offchain/sepolia.mjs`, all passing:
- **`rated`:** two rated 9×9 games, settled by replay, rated, mirrored and
  minted as kifu. The onchain ratings equal the SDK's update exactly, and
  `replay.mjs` replays both games from the new contract's events. Ratings
  start over: they are test data.
- **`run`:** an untimed 9×9 game settled by one native proof through the v5
  adapter (5.0 s to prove). A proof of a changed score and a call without a
  proof were rejected.
- **`ranked`:** a 9×9 game refereed live by referee's keeper at `262873e` (68
  steps stamped), settled by native proof (4.4 s); its kifu was refused.
- **`run`, 19×19:** the 311-step game settled by one native proof (7.0 s to
  prove): 87.0M L2 gas and 1.78 STRK, the same as a 68-step 9×9 game.
- **`batch`:** the same game in five chained proofs of up to 64 steps (4.3–4.9 s
  each): 427.3M L2 gas and 8.67 STRK. Checkpoints work, but each proof costs a
  whole settlement, so `batch` is now opt-in and `run` is the way to settle.
- Devnet first (`local.py`): 43 transactions, 22 checks. It caught the one
  thing v5 broke outside the unit tests: `set_clock_preset` takes a time
  control's settings alone, and the scripts cut them out of an encoding that
  now ends with the randomness tip.

Costs against the v4 world's, same fixtures:

| Transaction | L2 gas | v4 | Change | Sepolia fee (STRK) |
| --- | --: | --: | --: | --: |
| rated `create` | 15,945,525 | 15,930,005 | +0.10% | 0.324 |
| rated `join` | 12,695,280 | 12,689,488 | +0.05% | 0.258 |
| settle by replay, 68 steps | 41,367,953 | 41,254,481 | +0.28% | 0.839 |
| `rate`, two new players | 7,633,561 | 7,621,381 | +0.16% | 0.155 |
| `rate`, two rated players | 7,027,461 | 7,021,161 | +0.09% | 0.143 |
| `sync` (optional mirror) | 2,226,361 | 2,226,361 | 0% | 0.045 |
| kifu mint (rated game) | 17,961,162 | 17,951,151 | +0.06% | 0.365 |
| settle by native proof, 68 stamped steps | 87,945,952 | 87,924,489 | +0.02% | 1.784 |
| one 64-step proof of a 19×19 game | 85,066,915 | 85,053,805 | +0.02% | 1.726 |
| a whole 311-step 19×19 game in one proof | 87,022,740 | | | 1.782 |

- **A rated 9×9 game** (create, join, settle by replay, rate) takes 77.64M L2
  gas against 77.50M on v4 (+0.19%): 1.58 STRK on Sepolia, still $0.068 at
  mainnet prices. Data gas is unchanged on every transaction. The gas tests
  (`scarb test -f gas_profile`) put the rise at 0.22% on every board size.
- **The rise is the protocol's one more felt** in the terms and in the
  envelope. Referee's Dojo binding stores a referee's randomness tip only for a
  game that asks for one, so Surround's world has no `ChannelRng` model and its
  channel storage is v4's.
- **The deploy cost 228 test STRK:** declaring the channel 79.1, kifu 69.9,
  `SurroundRatings` 41.8 and the adapter 35.7; the migration's other
  transactions 1.4, since the world and model classes were already declared.
  The six runs cost 20 more.

## Referee v4 and SurroundRatings v2 on Sepolia, 2026-09-29

HARDENING_PLAN.md's fixes, deployed as a new world (seed
`surround-sepolia-v4-hardening`) on referee `49d26e9` and Surround `9e87462`:
[record](results/sepolia-ratings-v2.json). Addresses:

| Contract | Address |
| --- | --- |
| world | `0x1fa982be34a96464546d8953b7294cbd13a5688339d29c74776f4df5927966e` |
| channel | `0x656bc82340e6be26454e1876e4c6c807ae6f1474057acdbde5a93b1be25ea9f` |
| kifu | `0x16dc3ccc5d5542fb87e933317b66cd195f65a0847f6e3706f9e556f64426dfb` |
| SurroundRatings v2 (sealed; bands 23k, 17k, 6k) | `0x70425efb0136f4b794256ace76362cc96ce0cdddb433b04912ae7bd859e5f6f` |
| native proof adapter (v4) | `0x3eb6cd4f5eea4dc2077e443042297719c4e3e070d6ac44c8b8f6f820933b07` |

What ran, all with `offchain/sepolia.mjs`:
- **`rated`:** two rated 9×9 games from matchmaker tickets, settled by replay,
  rated with their ticket, mirrored (`sync`) and minted as kifu to the winner.
  Both times the onchain ratings equal the SDK's update exactly, and
  `replay.mjs` replays both games from the contract's events.
- **`run`:** an untimed 9×9 game settled by one native proof through the v4
  adapter. A proof of a changed score and a call without a proof were
  rejected.
- **`ranked`:** a 9×9 game refereed live by referee's v4 keeper (68 steps
  stamped), settled by native proof; its kifu was refused, since the game
  wasn't rated.
- **`batch`:** a 311-step 19×19 game settled in five consecutive native proofs
  of up to 64 steps (4.2–4.9 s each to prove).
- Devnet first (`local.py`): 43 transactions, 22 checks, including a short
  onchain forfeit (only the loser rated) and a short transcript (void).

Costs, on the same fixtures as the v1 table below. The mainnet estimate uses
that table's prices.

| Transaction | L2 gas | v1 | Change | Sepolia fee (STRK) | Mainnet (USD) |
| --- | --: | --: | --: | --: | --: |
| rated `create` | 15,930,005 | 22,880,109 | −30% | 0.336 | $0.0140 |
| rated `join` | 12,689,488 | 18,359,236 | −31% | 0.267 | $0.0112 |
| settle by replay, 68 steps | 41,254,481 | 53,474,830 | −23% | 0.867 | $0.0363 |
| `rate`, two new players | 7,621,381 | 10,786,698 | −29% | 0.160 | $0.0067 |
| `rate`, two rated players | 7,021,161 | 9,435,458 | −26% | 0.148 | $0.0062 |
| `sync` (optional mirror) | 2,226,361 | 2,379,386 | −6% | 0.047 | $0.0020 |
| kifu mint (rated game) | 17,951,151 | | | 0.378 | $0.0158 |
| settle by native proof, 68 stamped steps | 87,924,489 | | | 1.848 | $0.0774 |
| one 64-step proof of a 19×19 game | 85,053,805 | | | 1.788 | $0.0749 |

- **A rated 9×9 game** (create, join, settle by replay, rate) now takes 77.5M
  L2 gas, down from 105.5M (−27%): 1.63 STRK on Sepolia, $0.068 at mainnet
  prices. Data gas fell too: 1,888 against 2,560 on `create`, and 608 against
  2,080 on the settlement.
- **A proof costs about 85M L2 gas whatever its length,** and replay about
  0.43–0.46M per step, so replay stays cheaper up to about 160 steps
  (`replay_max_steps`); PROVING_PLAN.md has the break-even with batching.
- **The deploy cost 272 test STRK,** nearly all of it declarations: the
  channel 78.9, kifu 71.2, SurroundRatings 43.2 and the adapter 36.3; the
  migration's other transactions 23.9.

**RPCs.** Sepolia's prover now emits version-1 proof facts (`PROOF1`).
Publicnode's RPC accepts them. Cartridge's (v0_10) still expects version 0: it
rejects them at a given block and drops them at `latest`, which the adapter
reports as 'Missing proof facts'. Publicnode, on the other hand, refuses the
large class declarations (a request-size limit). So the deploy ran through
Cartridge (`SURROUND_SEPOLIA_RPC`), and every proof through publicnode, the
script's default. A keeper or client that sends proofs needs an RPC that
accepts the current proof version.

## Rating rule changes against OGS and the synthetic population, 2026-09-28

These are the rating changes HARDENING_PLAN.md proposed (T5–T7), measured two
ways.
- **OGS replay:** the goratings DB of 30.39M games. Log loss is scored on the
  usual split: the last 30% of games, both players with 10 or more prior games.
- **Synthetic population:** the audit's 10-year simulation (5 seeds; seed noise
  0.06 logits or less), reporting mean μ − θ.

The replay's baseline reproduces RANKING_PLAN's 0.620 and slope 1.00. OGS has no
starting bands, so each player's band is the one nearest their final rating.
This flatters newcomers, so band restrictions cost at least what's shown.

| Rules | Even log loss (Δ) | First game | Mean shown rank, 2023 | Active below 30k | 10-year drift: correct bands | 10-year drift: beginners improve |
| --- | --- | --- | --- | --- | --- | --- |
| Four bands (v1) | 0.6193 | 0.663 | 18.3 | 2.9% | +0.51 | −1.92 |
| T7: floor and ceiling at OGS 100 and 3500 | +0.0001 | 0.719 | 16.3 | 14.6% | +0.27 | −2.45 |
| T5: settled players skip unsettled opponents | **+0.0035** | 0.902 | 13.6 | 6.1% | +0.65 | −2.33 |
| T6: bands 23k and 17k only | +0.0038 | 0.709 | 14.4 | 4.2% | −1.47 | −2.94 |
| Three bands, 1k dropped | +0.0005 | 0.683 | 17.6 | 3.0% | +0.23 | −2.04 |
| T6 + T7 | +0.0025 | 0.793 | 10.8 | 24.4% | −2.06 | −3.99 |
| Three bands + T7 | +0.0004 | 0.743 | 15.5 | 15.6% | −0.01 | −2.58 |
| T5 + T6 + T7 | +0.0066 | 1.206 | 4.3 | 58.1% | −1.88 | −4.43 |

- **T5 fails both of the plan's gates:** log loss +0.0035 against a limit of
  +0.002, and drift +0.41 against +0.2 when players improve. It now applies to
  peak only: only queue games between settled players move a peak, and every
  rated game updates both ratings.
- **T7 is kept, with T8's drift monitor and rank offset.** The 30k clamp
  overrated the players pinned there by 10 points of win rate (−0.104 at or
  below 30k); T7 leaves them 1–2 points underrated. The cost is 0.056 in
  first-game log loss, and 0.53 logits of extra deflation where players
  improve, which the clamp had been cancelling. The ceiling never binds (at most
  0.04% of players reach 9d).
- **T6 deflates the whole pool** by about 1.5 logits, about 5 shown ranks, in
  every scenario, including players who have been in it for years: strong
  newcomers enter low and take rating from the pool while they climb. A
  newcomer's first game predicts worse than a coin flip (0.719 against 0.693).
- **The default is three bands, 23k, 17k and 6k** (HARDENING_PLAN.md D1): with
  T7, +0.0004 log loss and no drift while strength is steady. A 6k start makes
  rank farming about 11 ranks cheaper: 10 free accounts lift a main account to
  1d rather than 8k (`offchain/ratings/audit/farm.mjs`, table in T6). Dropping
  6k takes effect at once.
- **T4 (void short games) can't be measured:** the goratings DB has no move
  counts. It stays a policy (D3).

The scripts (`replay.py`, `sim2.py`, `eval_ogs.py`) stayed in the session's
scratch directory; the method is the one in `offchain/ratings/README.md` with
the rules as flags.

## Rated games (SurroundRatings) on Sepolia, 2026-09-28

Two rated 9×9 games on a new world (seed `surround-sepolia-v3-ratings`):
[record](results/sepolia-ratings.json), `node offchain/sepolia.mjs rated`.
Each starts from a matchmaker-signed ticket (`create_rated_channel`). The
harness referees it in process with a test key, settles it by onchain replay
with both approvals, and reports it (`rate`). Both times the ratings stored
onchain equal the SDK's integer update (`rating.mjs`) exactly. The first game
rated two new players, the second the same players with stored ratings. White
is the harness's test-player contract.

Costs per transaction. Sepolia fees are actual. The mainnet estimate applies
mainnet gas prices at block 15,564,518 (L2 2.234×10⁻⁸ STRK per gas, the same as
Sepolia; data gas 1.50×10⁻⁷, 12× cheaper than Sepolia) and $0.0394 per STRK.

| Transaction | L2 gas | Data gas | Sepolia fee (STRK) | Mainnet estimate (STRK) | Mainnet (USD) |
| --- | --: | --: | --: | --: | --: |
| rated `create` (ticket check, `RatedGame`) | 22,880,109 | 2,560 | 0.516 | 0.512 | $0.0202 |
| rated `join` (deadline, join time) | 18,359,236 | 960 | 0.412 | 0.410 | $0.0162 |
| settle by replay, 68 steps | 53,474,830 | 2,080 | 1.199 | 1.195 | $0.0471 |
| `rate`, two new players | 10,786,698 | 672 | 0.242 | 0.241 | $0.0095 |
| `rate`, two rated players | 9,435,458 | 544 | 0.212 | 0.211 | $0.0083 |
| `sync` (optional mirror) | 2,379,386 | 128 | 0.053 | 0.053 | $0.0021 |

**What rating adds to a game** (against the same channel's ranked games in
[results/sepolia-kifu.json](results/sepolia-kifu.json)):
- `create`: +7.7M L2 gas (22.9M against 15.2M), for the ticket's signature
  check, the policy reads, the used-ticket mark and `RatedGame`.
- `join`: +1.3M L2 gas (18.4M against 17.1M), for the deadline and the join time.
- `rate`: 9.4–10.8M L2 gas.

That is about 20M L2 gas per game, 0.44 STRK or $0.017 at mainnet prices,
nearly all of it L2 gas. It adds roughly a fifth to a 9×9 game settled by replay
(create, join, settle and rate: 2.37 STRK on Sepolia).

**One-time costs:**
- declaring `SurroundRatings`: 1.41B L2 gas, 31.5 STRK ($1.24);
- deploying it: 0.045 STRK;
- setting its policy, one multicall: 0.19 STRK;
- pointing the channel at it (`set_ratings`): 0.054 STRK.

The new world's migration, including 74.2 STRK to declare the larger channel
class, is the usual cost of a new channel class, not of ratings.

## Ranked-step latency without a network, 2026-09-27

How long the SDK itself takes to carry one ranked move from the mover to the
opponent, in one process with no transport. Records:
[memory store](results/latency.json), [file store](results/latency-file.json).
Rerun with `node offchain/latency.mjs [--store file] --out FILE` and compare.
Each step of a recorded game, on the 60 s per-turn clock:
- **sign:** the mover checks the move against Go's rules, signs it and marks
  it (`store.move`);
- **stamp:** the referee verifies it, applies it and signs the clock state
  (`Referee.stamp`, what referee's keeper runs as a step arrives);
- **receive:** the opponent verifies the signature and the attestation,
  applies the step and saves it (`store.receive`).

`e2e` is the three in a row: the mover's click to the opponent's board. The
mover applies its own stamped step alongside the opponent, off that path. The
memory store is the in-memory backend; the file store is the Node backend a
keeper or Node client uses, one synced file per key. Medians over three runs,
first step excluded (it warms key caches and the JIT), on an Intel i9-10980XE
with Node 22.22.1 and referee `a2a5269`:

| Game | Store | sign | stamp | receive | e2e (p95) | A then B (p95) | e2e, first vs last 50 steps |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `cgos_9_1682833` (9×9, 68 steps) | memory | 6.1 ms | 9.0 | 9.3 | 24.6 (27.0) | 49.2 (54.0) | 24.6 vs 24.5 |
| `kgs_2019_04_26_17` (19×19, 319) | memory | 6.0 | 8.8 | 10.0 | 24.9 (28.4) | 49.8 (56.1) | 24.2 vs 25.9 |
| `stress_19_2` (19×19, 529) | memory | 6.1 | 8.9 | 10.8 | 26.1 (29.6) | 52.2 (58.1) | 24.1 vs 28.0 |
| `cgos_9_1682833` | file | 8.0 | 9.2 | 11.6 | 28.9 (31.2) | 58.0 (61.9) | 28.8 vs 29.0 |
| `kgs_2019_04_26_17` | file | 7.9 | 9.2 | 13.6 | 31.1 (36.4) | 62.0 (70.6) | 28.5 vs 33.0 |
| `stress_19_2` | file | 8.1 | 9.3 | 15.3 | 33.0 (40.9) | 66.1 (79.4) | 28.8 vs 36.7 |

One late-game step (`stress_19_2` after 400 steps) broken into its parts:

| Part | Time | Per ranked move |
| --- | ---: | --- |
| Poseidon, 2 / 8 / 16 felts | 0.52 / 1.30 / 2.32 ms | about 0.27 ms per permutation in starknet.js |
| Applying a Go move (`applyStep`) | 3.71 ms | 3 times (mover, referee, opponent); almost all of it is four Poseidon hashes: the step's message, the position, the history and the transcript |
| Clock-state hash (`stampHash`) | 1.81 ms | twice (the referee signs it, the opponent checks it) |
| ECDSA sign / verify (cached key) | 0.45 / 0.95 ms | two signs, three verifies |
| Saving one new step: memory / file store | 2.43 / 8.41 ms | once on the path; the store re-exports and rewrites the whole transcript, so it grows with the game |

So about 60% of a move is JavaScript Poseidon, about 15% signatures, and the
rest the store and state copies. Board size hardly matters; the late-game creep
is the store's full rewrite. Runs vary by a few percent.

### Prototype: WebAssembly Poseidon and incremental saves

Both levers are changes to referee's SDK, so they were prototyped on a scratch
copy of referee `a2a5269` (two patches, not in either repository) and measured
with the same script ([memory](results/latency-prototype.json),
[file](results/latency-prototype-file.json)):
1. **Poseidon in WebAssembly:** starknet-crypto's `PoseidonHasher` compiled to
   an 18.9 KB module with no allocator, behind the SDK's `poseidon`, falling
   back to starknet.js where WebAssembly cannot run. Hashes are identical:
   every recorded game's state hash still matches its fixture.
2. **Saving only new steps:** each step is stored once, under a key that
   commits to the history before it, and a small pointer is the only key a save
   overwrites (and the one it checks against another tab). The old whole-record
   format still loads, and is saved in pieces from then on.

| `stress_19_2` | a2a5269 | + WebAssembly Poseidon | + incremental saves |
| --- | ---: | ---: | ---: |
| e2e, memory store (p95) | 26.1 ms (29.6) | 8.3 (10.2) | **6.5** (7.2) |
| A then B, memory store | 52.2 | 16.6 | **13.1** |
| e2e first vs last 50 steps, memory | 24.1 vs 28.0 | 6.7 vs 9.8 | 6.4 vs 6.8 |
| e2e, file store (p95) | 33.0 (40.9) | 14.8 (19.5) | **11.9** (16.0) |
| A then B, file store | 66.1 | 29.8 | **24.0** |
| e2e first vs last 50 steps, file | 28.8 vs 36.7 | 10.8 vs 18.2 | 11.8 vs 12.0 |
| Poseidon of 8 felts | 1.30 ms | 0.12 | 0.12 |
| Applying a Go move | 3.71 ms | 0.35 | 0.35 |
| Saving one new step at step 400, memory / file | 2.43 / 8.41 ms | 2.35 / 7.96 | 0.03 / 2.86 |
| Loading a stored 529-step game (file store) | 4.81 s | 1.47 s | 1.48 s |

- WebAssembly Poseidon is about 11 times faster per hash (0.12 against 1.30 ms
  for 8 felts) and cuts a move by about 70%. ECDSA is now the largest single
  cost (two signs and three verifies, about 3.7 ms of a 6.5 ms move).
- Incremental saves remove the late-game creep. On the file store each save
  syncs two small files (the step and the pointer) instead of one growing one,
  so a short game is about 0.6 ms slower per move than with Poseidon alone,
  and every game from mid-game on is faster.
- A load now reads one key per step (44 ms for 531 keys on the file store,
  against 6 ms for one), which is small next to re-verifying the transcript.
  An IndexedDB store makes one read transaction per step; that was not
  measured in a browser.

## Referee protocol v3 (referee clocks) on Sepolia, 2026-09-27

Referee protocol v3 ([`a2a5269`](https://github.com/broody/referee/commit/a2a5269))
adds optional referee clocks with pluggable time rules; Go uses referee's
`StandardTime` (per-turn timers, main time, increments, byo-yomi). Each v3
change to `ChannelGame` inserted members mid-struct, which a Dojo model upgrade
cannot do, so v3 runs in a new world (seed `surround-sepolia-v3-a2a5269`) with
a new channel system and a new adapter class, allowlisted
([record](results/sepolia-referee-v3.json), [trace](results/sepolia-referee-v3-trace.json)).
The largest game that fit one PROOF1 under v2, `stress_19_2` (529 steps,
B+204.5), was played twice:
- **untimed**, as before;
- **ranked**, on Surround's per-turn timer (60 s per turn), every step stamped
  live by referee's keeper (`keeper/server.mjs` at `a2a5269`, with a fresh
  referee key): each seat signed its step (`store.move`), the keeper stamped
  it (`KeeperClient.submit`), and both seats pulled it back. The harness
  answered within 114 ms, so the 529 steps took 26.1 s (55.7 s at `f407755`,
  before referee's faster signature checks).

Both games were proved by referee's self-hosted prover (PROOF1, `standard`
memory, the a2a5269 gateway with one cgroup-isolated worker, allowlisting only
the new class) and settled, each **in one PROOF1**, after the changed-score and
missing-proof rejections were checked onchain as for v2.

v3 was first deployed at referee [`f407755`](https://github.com/broody/referee/commit/f407755)
(fixed per-turn and bank clocks, before pluggable time rules) the same day, in
world `surround-referee-sepolia-v3`, and measured the same way
([record](results/sepolia-referee-v3-f407755.json), [trace](results/sepolia-referee-v3-f407755-trace.json)).
Its figures are kept for comparison.

| `stress_19_2`, 529 steps | v2 | v3 untimed | v3 ranked | f407755 untimed | f407755 ranked |
| --- | ---: | ---: | ---: | ---: | ---: |
| Adapter `__execute__` calldata (felts) | 1,629 | 1,633 | 2,169 | 1,633 | 2,167 |
| Replay executable: VM steps | 1,835,800 | 1,997,956 | 2,228,282 | 1,984,931 | 2,143,472 |
| Replay executable: Poseidon | 7,369 | 7,370 | 7,383 | 7,370 | 7,380 |
| Virtual OS: PIE steps | — | 2,497,090 | 2,784,279 | 2,510,260 | 2,701,201 |
| Virtual OS: Poseidon | — | 8,498 | 8,798 | 8,502 | 8,781 |
| Virtual OS: `ec_op` (ECDSA checks) | — | 6 (2) | 9 (3) | 6 (2) | 9 (3) |
| Stwo trace instructions | — | 2,748,145 | 3,061,006 | 2,761,515 | 2,978,640 |
| Largest opcode component (of 2²⁰ rows) | — | 62% | 67% | 63% | 66% |
| One PROOF1 | yes | yes | yes | yes | yes |
| Proof size (bytes) | 232,465 | 236,351 | 232,762 | 231,893 | 238,132 |
| Self-hosted proof: OS + proof (s) | 4.8 + 14.1 | 9.6 + 15.1 (first job) | 5.8 + 17.4 | 9.3 + 14.9 (first job) | 5.1 + 16.5 |
| Settlement (L2 gas) | 99.0M | 99.8M | 101.3M | 100.8M | 100.9M |
| Create / join (L2 gas) | 12.0M / 15.5M | 12.8M / 16.0M | 14.8M / 17.1M | 13.1M / 16.7M | 13.7M / 16.8M |
| Per game: create, join, settle (test STRK) | 2.765 | 2.837 | 2.939 | 2.867 | 2.891 |

v2's OS-level figures were not recorded; its self-hosted proof time is the
re-proof in referee's prover README (its hosted proof took 8.3 s). Replay
executable figures are `scarb execute` of `offchain/proving` on the same
transcript. Virtual OS figures are from the prover's log and from re-running
each proof's OS job at its base block (`server/tools/os-job.mjs --session`, then
`server/capacity`). Proof size moves by a few percent between runs of the same
game and is not a clock cost.

**What a timed game costs** (v3 ranked against v3 untimed, same deployment):
- **Per step:** one felt of calldata (its stamp; 536 felts in all, with the
  clock and the attestation) and about 435 Cairo steps of replay for the
  standard time rules (230,326 VM steps over 529 steps, the attestation check
  included). Referee measured about 500 on its counter game (+50k
  cairo-test gas).
- **Per proof:** one ECDSA check (the referee's final attestation, 3 `ec_op`)
  and 300 more OS Poseidon permutations (about one per two calldata felts). In
  all 11.5% more PIE steps and 11.4% more trace instructions.
- **Onchain:** 1.5M more L2 gas to settle and 0.10 test STRK more per game.
  Creating a ranked game costs 2.0M more L2 gas (its settings are stored and
  checked) and joining 1.05M more.
- **Against f407755:** pluggable time rules cost a timed step about 135 more
  Cairo steps (435 against 300) and the ranked proof 3% more trace, while
  untimed games got slightly cheaper to settle (99.8M against 100.8M): the
  model now stores the referee key and an empty settings span instead of a
  four-field time control.

**Capacity.** Poseidon (`cube_252`) is still the binding component, now at
8,798 permutations in one PROOF1, the most so far (8,289 was the known fit
before v3). It fails somewhere below 10,396 (v1). Every other component is at
or below 2²⁰ rows, the largest opcode at 67%. A ranked 529-step game, near a
full 19×19 board, still settles in one proof.

Deploying cost 104.4 test STRK: the channel class (1.39 MB) 61.4, the adapter
class 33.6, the world migration 9.3, and adapter deployment and allowlisting
0.1 (the f407755 deployment cost 100.7). Publicnode refuses a request that
size, so deployments go through Cartridge's RPC node; games settled through
publicnode as before.

On Devnet (`local.py`, [record](results/local-integration.json)), untimed v3
channel transactions cost about 0.5M more L2 gas than v2 for the referee key and
settings span in `ChannelGame` (about 1.06M at f407755): join 14.1M → 14.6M,
open dispute 10.6M → 11.1M, resolve 11.5M → 12.0M, timeout claim 11.5M → 12.0M,
and the 68-step direct settlement 39.4M → 41.2M. A ranked game refereed by the
SDK's `Referee`, with a flag, settled as a timeout through `submit_history`
(15.9M) and `resolve` (15.4M).

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

**Self-hosted proving (2026-09-26).** `cgos_13_277988` (203 steps, W+20.5)
was proved by referee's self-hosted prover ([`prover/`](https://github.com/broody/referee/tree/main/prover):
StarkWare's transaction prover built from source behind an allowlisting
gateway) and settled on Sepolia. Re-proving five recorded settlements at their
original base blocks (`server/tools/prove-bench.mjs`) gave proofs byte-identical
to the hosted prover's, in 15–20 s against the hosted 5–8 s, with up to about
54 GiB of memory. Measurements are in referee's prover README.

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
