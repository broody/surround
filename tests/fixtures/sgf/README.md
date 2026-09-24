# Recorded-game regression fixtures

Six completed, numerically scored games replay **1,177 moves** through Surround's
public Dojo entry points. The original SGFs are vendored unchanged. Normal Cairo
tests work offline and do not need Python, a wallet, or a running node.

| Fixture | Board | Published result | Moves (including passes) | Captures, Black / White | Agreed dead stones |
| --- | --- | --- | --- | --- | --- |
| [CGOS 1682833](cgos_9_1682833.sgf) | 9×9 | W+2.0 | 66 | 0 / 0 | 0 |
| [CGOS 1682827](cgos_9_1682827.sgf) | 9×9 | B+8.0 | 79 | 5 / 8 | 0 |
| [CGOS 277988](cgos_13_277988.sgf) | 13×13 | W+20.5 | 201 | 11 / 35 | 0 |
| [CGOS 277982](cgos_13_277982.sgf) | 13×13 | B+31.5 | 205 | 43 / 11 | 0 |
| [KGS 2019-04-10-39](kgs_2019_04_10_39.sgf) | 19×19 | B+1.50 | 309 | 15 / 10 | 34 |
| [KGS 2019-04-26-17](kgs_2019_04_26_17.sgf) | 19×19 | B+74.50 | 317 | 51 / 2 | 0 |

The close KGS game, TieBot2 versus okahachi, is the key settlement regression.
Treating every stone as alive produces **B+2.5**. Its final territory annotations
identify **34 dead stones in 16 complete groups**. Marking those groups and
obtaining both approvals produces the published **B+1.5**. This validates counting
from an agreed proposal; it does not ask the contract to infer life or death.

## Sources and compatibility

- [CGOS](http://www.yss-aya.com/cgos/) publishes computer games and specifies area
  scoring, no suicide, positional superko, and termination after two passes with
  no further stone removals. These four games are from September 6, 2026. Their
  SGFs label the rules `Chinese`; the server's more specific rules explain why
  these records are useful as all-alive area-scoring fixtures.
- [u-go's public KGS archive](https://u-go.net/gamerecords/) supplies the two 19×19
  records, from its April 2019 collection. Both specify `RU[Chinese]` and include
  final `TB`/`TW` annotations. Each selected mainline was separately checked for
  Surround-compatible moves and scoring. This does not assert that every KGS
  Chinese-rules game uses exactly Surround's rules.
- The [SGF Go specification](https://www.red-bean.com/sgf/go.html) defines moves,
  passes, and `TB`/`TW`. These marks can denote territory or area, including stones.
  An opponent-colored stone inside the marked area is treated as an agreed dead
  stone in these KGS fixtures. No heuristic territory estimator is used.

[manifest.json](manifest.json) records exact source URLs, KGS archive member
names, original published results, retrieval date, and SHA-256 checksums. The
SGFs are third-party game records retained for reproducible tests; this project
does not assert ownership of the source collections.

Resignations and time losses cannot validate a numeric margin. Japanese territory
scores, handicap/setup positions, variations, missing final passes, and KGS games
without explicit final scoring annotations are excluded from this initial corpus.
There are no published draw fixtures here; synthetic tests cover draws, ko,
suicide, seki-style shared regions, and dispute handling separately.

## What is checked

[`test_sgf.cairo`](../../../src/tests/test_sgf.cairo) creates and joins each game,
replays every move and pass, then checks:

- The resulting board and captures against an independent replay.
- The contract's normal turn, capture, suicide, superko, and two-pass checks.
- The initial all-alive score margin.
- Whole-group markings against the exact SGF-derived dead-stone mask.
- A single approval leaves the game unsettled; the second finalizes it.
- The final winner and margin against the original SGF **`RE` result**.
- The canonical played board remains intact after settlement.

SGFs do not contain onchain approvals. The test accounts simulate those approvals
using the recorded scoring annotations. CGOS records get two approvals of an
empty dead-stone selection. Game clocks are held fixed during replay.

## Reproduce the independent reference

From the repository root, with the pinned Scarb version installed:

```sh
python3 -m venv .venv-fixtures
.venv-fixtures/bin/pip install -r scripts/requirements-fixtures.txt
.venv-fixtures/bin/python scripts/generate_sgf_fixtures.py --check
sozo test -f test_sgf
```

The generator uses **sgfmill 1.1.1**, not Surround, to parse SGF, replay captures,
and cross-check the area margin. It independently rejects suicide and positional
repetition because sgfmill's move API does not enforce those restrictions. SGF
coordinates are converted explicitly from sgfmill's bottom-origin rows to
Surround's top-origin row-major indices. Passes are encoded as `361`.

The expected winning margin comes directly from `RE`; the generator fails if the
reference calculation disagrees. Dead groups come only from final territory
annotations. Checksums prevent unnoticed fixture replacement. The generated
[`sgf_fixtures.cairo`](../../../src/tests/sgf_fixtures.cairo) supplies deterministic
data to the contract tests. To deliberately update it, run the generator without
`--check` and review both the source provenance and generated changes.

sgfmill counts mixed-border empty regions for both players, which cancels in the
score difference. Consequently its **margin**, rather than individual absolute
scores, is the independent scoring reference here. Absolute scores and neutral
territory handling are also tested by the existing focused Cairo fixtures.
