# Ranking plan: onchain ratings for ranked games

Created 2026-09-28. Status: PRs 1–5 done. `SurroundRatings` checks tickets and
rates games; the channel opens rated games on tickets, reports settled ones
(`rate`) and mirrors ratings as events; the matchmaker (`offchain/matchmaker`)
pairs players, signs tickets, brokers each game's signed terms to a keeper and
rates settled games. A rated game runs end to
end on Devnet (`local.py`, through the matchmaker) and on Sepolia. Next: the web app.

Revised 2026-09-29 for `SurroundRatings` v2 (`PARAMS = 2`), from the review in
[HARDENING_PLAN.md](HARDENING_PLAN.md) (T1–T11). v2 runs on Sepolia since
2026-09-29 ([results](offchain/RESULTS.md#referee-v4-and-surroundratings-v2-on-sepolia-2026-09-29)),
and was redeployed for referee v5's tickets on 2026-09-30
([results](offchain/RESULTS.md#referee-v5-on-sepolia-2026-09-30)) and for
arbiter v6's games, opened on their signed terms, on 2026-10-01
([results](offchain/RESULTS.md#arbiter-v6-on-sepolia-2026-10-01)).

Goal: every settled ranked game updates both players' ratings onchain, and the
rank shown in the app is derived from those ratings. Rewards are status only
(rank, peak rank, later soulbound badges), because offchain play can't exclude
engine assistance.

## Model

Glicko-2's update, run once per game, without the volatility step. Both players
update from their pre-game values. There is no global re-solve and a settled
result is never revised. All values are in logits (Glicko-2's μ scale).

- **Aging.** Uncertainty grows while a player is idle:
  `var* = min(φ0², φ² + c(r)²·days)`, where `c = 1.15·2·ln2 / half_life(r)`.
  The half-life is 15 days below 15k, rising linearly to 45 days at 1d and above
  (KGS's half-lives). The opponent's φ is aged too.
- **Update.** With `g = 1/√(1 + 3φ_opp²/π²)` and `E = 1/(1 + e^(−g(μ − μ_opp)))`:
  `1/φ'² = 1/var* + g²E(1−E)` and `μ' = μ + φ'²·g·(s − E)`, where s is 1, ½ or 0.
- **Limits.** Stored μ is clamped to OGS's range, ratings 100 to 3500 (μ from
  about −8.06 to 11.51), so a player below 30k keeps losing μ. The displayed
  rank stays 30k–9d. φ0 = 2.0, and φ never drops below 0.01.
- **Board sizes.** One rating covers 9×9, 13×13 and 19×19, and every game has full
  weight. Rated games are even games at a fixed komi per size.
- **Starting bands.** A new player chooses a band, as on OGS: 23k, 17k, 1500
  (6k) or 1k. The owner's `start_bands` policy decides which are allowed: 23k,
  17k and 6k by default. A 1k start is worth too much to a rank farmer, and
  allowing only 23k and 17k deflated the pool by about 5 ranks
  ([evidence](offchain/RESULTS.md#rating-rule-changes-against-ogs-and-the-synthetic-population-2026-09-28)).
- **Ranks.** Ranks use OGS's scale, `rank = 23.15·ln(rating/525)` with
  `rating = 1500 + 173.7178·μ`, in which rank 0 is 30k and rank 30 is 1d. It is
  stored as a table of μ at each whole rank. A rank shows "?" while φ, aged to
  now, is above 1.0, or until the player has at least one win and one loss. The
  shown rank adds the owner's `rank_offset_tenths` (0 at launch; see Drift).
- **Short games.** A game under 20 steps is void, as OGS voids aborted games,
  unless it ended onchain (`resign_channel` or `claim_timeout`); then only the
  loser's rating changes, since a stale anchor may hide the game's length. Such
  a forfeit may settle before anything stamped reaches the chain; it is then
  dated by its ticket's `issued_at`, so a losing seat can't void its loss by
  opening the game and resigning first.
- **Peak** (`μ − 2φ`) moves only in queue games between two settled players,
  each with 10 or more games and aged φ ≤ 1.0. Every rated game updates both
  ratings.
- **Fixed point.** Q32.32 with i128 intermediates; the largest is 98 bits.
  Divisions round half to even. exp uses ln 2 range reduction, a 12-entry table
  and Horner's rule; square roots use `u128` sqrt. One update is roughly 63
  multiplies, 66 divisions, 5 square roots and 3 exps.
- **Measured on Sepolia** (arbiter v6, [results](offchain/RESULTS.md#arbiter-v6-on-sepolia-2026-10-01)):
  a rated 9×9 game (opened on its ticket, settled by replay and rated in one
  transaction) takes 66.6M L2 gas, 1.35 STRK; v5's create, join, settle and
  rate took 77.6M in four. v1 took 105.5M. Declaring `SurroundRatings` costs
  about 42 STRK once.
- **Measured in tests** (`scarb test -f gas` in `ratings/`, v2):
  - one update: about 0.63M L2 gas;
  - a full `rate_game` (ticket digest, both players' storage, events): 2.1–2.4M
    L2 gas;
  - storage: three slots written (one per player and the ticket's status).

### Evidence

We replayed OGS's public ranked games (github.com/online-go/goratings, 30.4M
games from 2005 to 2023). Each system predicted every game before seeing its
result. We scored even games on the last 30% of games, counting only games where
both players already had 10 or more games; a coin flip scores 0.693.

| System | Log loss | Calibration slope |
| --- | --- | --- |
| KGS-style daily re-solve, KGS constants | 0.673 | 0.49 |
| KGS-style daily re-solve, OGS scale | 0.640 | 0.72 |
| OGS Glicko-2 (goratings code) | 0.629 | 0.85 |
| This model with KGS's rank width (0.85–1.30 logits per rank) | 0.655 | 0.54 |
| **This model** | **0.620** | **1.01** |

- **KGS's rank width is too wide.** A handicap stone measured 0.2–0.4 logits on
  OGS, 3.6–10 times less than KGS's k. Predictions built on k are overconfident.
- **Re-solving loses.** The global re-solve did worse overall on every board
  size, and it moved idle players' ranks.
- **Aging matters.** Disabling it cost 0.023.
- **No volatility step.** It made established players' predictions worse.
- **Full weight on small boards.** Down-weighting 9×9 games hurt 9×9 predictions.
- **φ0 of 3 or more** predicted marginally better but deflated ranks by about
  two ranks over eight years.
- **Starting bands are needed.** A default start at about 6k made first games
  predict worse than a coin flip.
- **Integer arithmetic matches.** The Q32.32 integer update matched the float
  model within 1.6×10⁻⁸ in win probability over all 30M games. Truncating
  division drifted about 100 times more than rounding half to even.

v2's rule changes were replayed the same way and in a 10-year synthetic
population ([results](offchain/RESULTS.md#rating-rule-changes-against-ogs-and-the-synthetic-population-2026-09-28)):
- **The wider μ range** costs 0.0001 log loss, and fixes the 30k clamp, which
  overrated the players pinned there by 10 points of win rate.
- **Freezing settled players against newcomers** failed both gates (log loss
  +0.0035, extra drift +0.41 logits), so it applies to peak only.
- **Three starting bands** cost 0.0004 log loss and keep the pool's level while
  strength is steady. Two bands deflated it by about 5 ranks.

### Drift

A rating system with fixed starting bands can drift: when beginners improve,
the pool sinks (about 2.6 logits over 10 years in the simulation).
`offchain/sdk/src/replay.mjs` reports the signal from the contract's events:
newcomers' first games against players with 10 or more games, points won
against points expected. Newcomers start at fixed band values, so a pool that
has sunk makes them score below the prediction. The owner then sets
`rank_offset_tenths`, which shifts every displayed rank and changes no stored
rating.

## Architecture

Ratings live in **`SurroundRatings`**, a plain Starknet contract that outlives
Dojo worlds. Surround has already replaced its world six times on Sepolia. Each
world's channel is an allowlisted client of the contract.

```
matchmaker ──signs ticket──▶ both wallets sign the terms (config.ticket = digest; game id the seats': gameIdOf)
           ──registers the game, signatures and ticket──▶ a keeper with room (its referee is in the ticket)
play offchain (the keeper referees the clock; its first stamp starts the game)
the first transaction that needs the chain (the keeper's settlement, or a dispute):
      channel.open_rated_game(terms, wallet signatures, ticket, sig)
      └─ ratings.check_ticket(ticket, sig, game_id)   (policy, bands, digest → game)
      then settle (proof / submit + resolve / resign / claim_timeout / force) ──▶ SETTLED
the keeper's after-settle hook, or the matchmaker ──▶ channel.rate(game_id, ticket)   (anyone may call; no-op if not rateable)
      ├─ ratings.rate_game(ticket, result)   → math, stored ratings, ticket RATED, audit events
      └─ world.emit_events([PlayerRank; 2])   → Torii indexes the mirror
```

- **A game is rated or not from its signed terms.** Its config carries the
  ticket's digest, which both wallets sign: such a game opens only through
  `open_rated_game`, and a game without it never counts, so no one can register
  only the games they won.
- **Rating is a separate call after settlement.** A game the keeper submits
  without acks is settled only once `resolve` runs after the dispute window;
  one settled with both seats' acks can be rated in the same transaction.
  `rate` never reverts on an unrateable game, so rating code can never block a
  settlement.
- **The contract takes the channel's word for results.** The channel passes the
  facts of a settled game in. `SurroundRatings` accepts them only from
  allowlisted channels and never reads Dojo models.
- **The mirror is events only.** `PlayerRank` is keyed by player, so Torii keeps
  the latest one per player; it carries the game that set it, so Torii,
  configured to keep it historical, keeps the rank history too. It costs no
  storage writes. `channel.sync(player)` seeds a new world's index.
- **The contract's own events are the audit trail.** `TicketUsed` carries the
  whole ticket and `RatingUpdated` each side's state before and after, so
  `offchain/sdk/src/replay.mjs` checks every rating and the chain of them.

### `SurroundRatings`

- **`rate_game(ticket, result)`** runs only for the ticket's own channel, active
  or retiring, and only once per ticket, whose digest must have been accepted
  for the same game. The players, board, bands and keys come from the ticket;
  the channel reports only the result, its times and the step count. It
  updates both players and returns their new states.
  - **VOID** (no update) if:
    - it started at or after the matchmaker key's revocation time;
    - it started at or after the referee key's revocation time, or was a
      timeout settled at or after it;
    - it never started, or started outside the ticket's window (below);
    - it is a short game (Model);
    - the data is invalid.
  - A game that isn't rateable returns `None` rather than reverting.
- **Storage** is one packed felt per player: μ, φ, last-played time, band, the
  flags and params version, the counters and peak.
- **`last_played` is `max(last_played, played_at)`.** Rating games out of order
  can't move a player's clock backwards.
- **Established** is sticky. It is set the first time φ ≤ 1.0 with at least one
  win and one loss. Peak (`μ − 2φ`) is updated only for established players in
  queue games.
- **Admin:**
  - channels (active, retiring, removed), and matchmaker and referee keys, which
    can be retired or revoked from a time;
  - two-step ownership and class upgrade;
  - the rated-game policy: clock presets, provers, the komi for each rated board
    size, the response-window range, starting bands and the rank offset.
  - After `seal()`, anything that loosens policy or trusts more waits 48 hours
    (`queue`, then the call; `cancel`), and tightening applies at once.

### Tickets

- **Fields** (`ratings/src/ticket.cairo`): chain id, channel, black, white, size,
  komi, clock (a `TimeControl`: rated games are always timed), prover, response
  window, source (queue or table), both starting bands, the matchmaker key,
  `issued_at`, `expires_at` and a nonce.
- **Digest:** `arbiter::signing_hash` over `'SURROUND_PAIRING_V1'` and the
  ticket's Serde fields, masked to 250 bits; the SDK's `ticketDigest` computes
  the same value. Used digests are recorded in `SurroundRatings`, so the other
  valid form of a signature, (r, n − s), can't replay a ticket.
- **Signature:** by a matchmaker key, separate from the referee key and the
  keeper's account key.
- **`check_ticket` enforces:**
  - the caller is an active channel, the ticket's own, for the game whose terms
    carry its digest; white is neither zero nor black;
  - a band the policy allows, for a player with no rated games;
  - `issued_at ≤ expires_at`, living at most 15 minutes. It may be accepted
    after it expired: the game opens only when it first needs the chain;
  - the chain id and the calling channel match the ticket;
  - an allowed referee and clock preset, standard komi, an allowed prover, and a
    bounded response window.
- **The game must start within the ticket's window.** Its start is its
  referee's first stamp, which the channel keeps (`started`): it must fall
  between `issued_at` and `expires_at`, and before the settlement, each give or
  take 60 s of clock skew (`MAX_CLOCK_SKEW`). The start is the game time used
  for aging, so delaying settlement can't change an update. A game that never
  started is void, except an onchain forfeit (Model).
- **Cost** (v6, `sozo test -f gas_profile`): `open_rated_game` takes about 6.5M
  L2 gas, against about 13.4M for v5's create and join.

### Trust

- **Matchmaker key.** It decides who plays rated games together. A stolen key can
  pair colluding accounts, but the channel policy stops it from choosing the
  referee, komi, clock or prover.
- **Referee key.** It decides timeouts; see [Ranked clocks](OFFCHAIN_PROTOCOL.md#ranked-clocks).
- **Owner.** `SurroundRatings`'s owner, a multisig, can upgrade the contract or
  change the policy. After `seal()`, loosening waits 48 hours, so players can see
  it coming.

The matchmaker caps each player at one open rated game, adds cooldowns
for no-shows, and limits repeat pairings. Cheaters are handled offchain: the
matchmaker refuses them tickets and leaderboards hide them.

## Work plan

1. **Done: `ratings/`**: the Q32.32 math and `SurroundRatings` (Dojo-free, Cairo 2.13.1,
   like `rules/`). `offchain/sdk/src/rating.mjs` is the reference; its vectors are
   generated into Cairo and must match bit for bit. Measure gas. Move the backtest
   harness to `offchain/ratings/`.
2. **Done: tickets and channel.** `check_ticket` and the policy in
   `SurroundRatings`; `create_rated_channel`, the join deadline and `RatedGame`
   in the channel; ticket tests; the SDK's `ticketDigest`, `signTicket` and
   `createRatedChannelCall`.
3. **Done: channel `rate` and `sync`** with the event mirror; world tests that
   deploy `SurroundRatings`; a rated game on Devnet (`smoke.mjs`) and Sepolia.
4. **Done: SDK and Devnet:** `rateCall`, `syncCall`, `getPlayerRating`; a rated
   game end to end in `local.py`, checked against the SDK's update.
5. **Done: matchmaker** (`offchain/matchmaker`). It pairs the queue and open
   tables, signs tickets, penalizes no-shows, and rates settled games in its own
   transaction. It finds them from `SurroundRatings`' events over RPC, so
   neither a Torii sweep nor a change to arbiter's generic keeper is needed.
6. **Done: v2** ([HARDENING_PLAN.md](HARDENING_PLAN.md) Phase 3): ratings
   bound to tickets, short games void, starting bands as policy, the wider μ
   range, the rank offset, replay from events and the timelock. Deploys with
   the next world.
7. **Done: arbiter v6.** Rated games open on both wallets' signatures over
   terms that carry the ticket's digest (`open_rated_game`), in the transaction
   that first needs the chain; they are dated by their referee's first stamp.
   The matchmaker collects both signatures and registers each game with a
   keeper from its list, each with its own referee key, so keepers can run in
   several regions.
8. **Web:** quick match and rank display.
9. **Later:**
   - ranked-pass charges;
   - soulbound badges;
   - kifu `BR`/`WR` ranks, with ranked kifu gated on `RatedGame` instead of
     `referee != 0`;
   - refitting the constants on Surround's own games.
