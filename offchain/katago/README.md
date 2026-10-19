# KataGo

The engine the AI regulars play with ([anchors](../anchors/README.md)):
`engine.ts` drives one KataGo analysis process for every game at once, and
`scoring.ts` marks dead stones from its ownership estimate. Configure it in
`apps/web/.env.local`, which the stack reads:

```sh
KATAGO_BIN=/path/to/katago
KATAGO_MODEL=/path/to/kata1-b18c384nbt.bin.gz
KATAGO_HUMAN_MODEL=/path/to/b18c384nbt-humanv0.bin.gz
# Optional analysis config; GTP configs are not compatible.
# KATAGO_ANALYSIS_CONFIG=/path/to/analysis.cfg
```

KataGo must support the human SL model (1.15+), which the AI regulars need.
`analysis.cfg` defaults to four concurrent searches, one search thread each,
16-position neural batches and 64 visits. Tune this for the serving hardware.
Never start a process per character. Character identity, portrait, dialogue
and nominal strength live in `shared/lobby.ts`; the human strength profile is
supplied independently on every query.

The [KataGo analysis protocol](https://github.com/lightvector/KataGo/blob/master/docs/Analysis_Engine.md)
correlates asynchronous NDJSON replies by ID and supports per-query
`overrideSettings.humanSLProfile`. Moves sample the returned human policy at
its native temperature, excluding illegal moves and passes until search
recommends passing. Reducing superhuman search visits alone does not produce
a beginner. Human profiles span 20k–9d; use the nearest available level
outside that range. High-dan imitation is approximate and needs empirical
calibration before presenting it as a tournament-equivalent strength.

```sh
node --experimental-strip-types --test offchain/katago/*.test.ts
```
