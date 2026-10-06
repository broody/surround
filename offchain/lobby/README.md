# Playing hall backend

Human tables, invitations, matchmaking, guest profiles, AI placement and server-authoritative Go games. Uses Node 22.12+ with no extra runtime packages. The frontend's shared rules module handles captures, suicide and positional superko. Untimed games use area scoring and 6.5 komi. Human dead-group proposals require both players' approval; AI games use ownership to mark dead groups and let the player resume disputed positions.

## Local development

`npm run dev` in `apps/web` mounts this service at `/api/lobby` and `/api/katago`. Configure KataGo in `apps/web/.env.local`:

```sh
KATAGO_BIN=/path/to/katago
KATAGO_MODEL=/path/to/kata1-b18c384nbt.bin.gz
KATAGO_HUMAN_MODEL=/path/to/b18c384nbt-humanv0.bin.gz
# Optional analysis config; GTP configs are not compatible.
# KATAGO_ANALYSIS_CONFIG=/path/to/analysis.cfg
```

KataGo must support the human SL model (1.15+). The model is required for the lobby AI roster; human games work without it. `analysis.cfg` defaults to four concurrent searches, one search thread each, 16-position neural batches and 64 visits. Tune this for the serving hardware. Never start a process per character. Character identity, portrait, dialogue and nominal strength live in `shared/lobby.ts`; the human strength profile is supplied independently on every query.

The [KataGo analysis protocol](https://github.com/lightvector/KataGo/blob/master/docs/Analysis_Engine.md) correlates asynchronous NDJSON replies by ID and supports per-query `overrideSettings.humanSLProfile`. Moves sample the returned human policy at its native temperature, excluding illegal moves and passes until search recommends passing. Reducing superhuman search visits alone does not produce a beginner. Human profiles span 20k–9d; use the nearest available level outside that range. High-dan imitation is approximate and needs empirical calibration before presenting it as a tournament-equivalent strength.

The server forces Black's perspective with `-override-config reportAnalysisWinratesAs=BLACK`, including when a custom analysis configuration is supplied. Ownership-based dead-group scoring depends on that perspective.

## Standalone deployment

From the repository root:

```sh
node --experimental-strip-types --env-file-if-exists=apps/web/.env.local offchain/lobby/server.ts
```

Or run `npm run backend` in `apps/web`. Default bind is `127.0.0.1:5184`; configure `LOBBY_HOST`, `LOBBY_PORT`, `LOBBY_DATA_FILE` and, when proxy host headers differ, comma-separated `LOBBY_ALLOWED_ORIGINS`. Serve `apps/web/dist` and proxy `/api/` to this backend on the same HTTPS origin. Hash routes (`#lobby`, `#match/<id>`) need no page rewrite. For a separate dev backend, set `LOBBY_BACKEND_URL=http://127.0.0.1:5184` in the frontend environment; Vite then proxies APIs and does not start another engine. `KATAGO_CONFIG` from the old GTP bridge is replaced by `KATAGO_ANALYSIS_CONFIG`.

Run one service process against one data file. Dev data lives in `apps/web/.cache/lobby/lobby.json`; standalone defaults to `offchain/lobby/data/lobby.json`. Keep that file on persistent storage and back it up. Atomic, serialized JSON writes persist identities, active games, move histories and results. Session tokens are stored hashed on the server; the bearer token stays in the player's browser. Queues and presence are ephemeral. Active games resume after restart and interrupted AI queries are safely retried. This is a single-host initial release; a shared database and an engine job broker are required before scaling to multiple service workers.

## Placement and ranking

Five qualifying AI results establish an estimated app rank. A self-selected starting band seeds uncertainty; subsequent opponents use the current estimated rank. Updates reuse the integer rating algorithm in `offchain/sdk/src/rating.mjs` with a fixed AI opponent rating. The character's engine profile, rather than its portrait's nominal rank, supplies the opponent strength. A result requires at least 18 stone plays on 9×9 or 20 on larger boards to change rank; short games cannot advance placement. Passes do not count toward this threshold. Only completed results count, once.

By default AI games become practice after placement, while human results continue updating the estimate. Set `LOBBY_AI_RATED_AFTER_PLACEMENT=true` to rate later AI games too. These are guest app estimates, separate from onchain `SurroundRatings`, wallet identity and the rated matchmaker/referee settlement flow. Smaller boards currently share the same estimate; calibrate strengths by board size or separate rating pools before treating these estimates as competitive rankings. No rating transaction is submitted onchain.

## Verification

```sh
node --experimental-strip-types --test offchain/lobby/*.test.ts
```

Tests cover human seats, stale/illegal moves, private codes, rank matching, scoring agreement, AI scoring/retry/cancellation, placement, persistence, per-query strength isolation, out-of-order protocol replies, bounded work and process failure. Real GPU integration is checked through the local API; tests use a controlled engine and a protocol fixture so they do not require model downloads.
