# Hardening plan: fixes from the 2026-09-28 review

Created 2026-09-28. Status: Phases 1–6 committed on branches
`feat/protocol-v4` (referee `49d26e9`) and `feat/hardening` (Surround
`9e87462`); Phase 7 deployed to Sepolia on 2026-09-29, with the items below
still open. Reviewed twice before implementation; D1, D3 and D5 confirmed, and D1
revised on 2026-09-29 after the evidence.

## Implementation status

| Phase | State | Where the code departs from the plan |
| --- | --- | --- |
| 1 Referee v4 | Done; core, SDK, Dojo binding, adapter, keeper. 125 JS, 111 + 3 Cairo (2.13 and 2.18), 30 Dojo and 24 adapter tests | Any submission may start from the candidate, approved or not (it changes nothing). After a resume the keeper stamps a seat's first step at the last stamp, rather than sending `Start` before it, since a seat's signature binds its position; `Start` still follows a grace period. A seat whose pending step loses its position to a referee step may sign on (`Session#guard`). |
| 2 Go rules v3 | Done; rules, SDK codec, kifu, fixtures | The kifu record encodes `Start` with the code `Recommit` used: Go can never recommit under v4. The web app's scoring view waits for the web's ranked flow (below). |
| 3 Ratings v2, channel | Done; 74 ratings tests (with the audit's 900-case and 400-game parity vectors), 3 snforge fuzz properties, 69 world tests, 5 red-team regressions | `set_ratings` is settable once instead of fixed at `dojo_init`: the same guarantee, with no change to the deploy order. The channel mirrors only sides that are rated. |
| 4 Offchain | Done: replay tool (`offchain/sdk/src/replay.mjs`) with the drift signal, harnesses (`farm.mjs` among them), matchmaker (O1); 43 SDK and 36 matchmaker tests | The web app has no ranked flow yet (its lobby is a mockup), so O3's web items wait for that work; the SDK pieces they need are in. |
| 5 Gas, Surround | Done: one felt per player, `update_states`, slim `RatedGame`, `PlayerRank` with game fields in one `emit_events` call (`RatingChanged` dropped). Profile: `scarb test -f gas_profile` | Replay costs about 0.43–0.46M gas per step on every board size, so `replay_max_steps` ≈ 160 while proofs are single. |
| 6 Gas, referee | Done: `ChannelTerms` + packed `ChannelState` | A 9×9 game's execution gas in tests fell 18% (89.1M → 72.8M); create −25%, join −34%, rate −30%. |
| 7 Deploy | Sepolia, 2026-09-29 ([results](offchain/RESULTS.md#referee-v4-and-surroundratings-v2-on-sepolia-2026-09-29)): new world, SurroundRatings v2 sealed, v4 adapter; rated, untimed, keeper-refereed and 19×19 chained-proof games; a rated 9×9 game costs 27% less L2 gas | Open: tag referee and pin it (Surround builds from `../referee` until then); the test deploy's owner is the harness account, not a multisig, and has no standby keys or namespace timelock; Torii, matchmaker and keeper configs for the new world; the red-team attacks, revoked keys and short games ran on Devnet and in tests, not on Sepolia. |

`replay.mjs` also verifies the contract's own events: a ratings test plays a
mixed season and prints them, and `offchain/ratings/audit/replay-check.mjs`
replays them (18 games, a void, the settled gate, a short forfeit, a long idle
spell).

The evidence runs for T5–T7 are done (`offchain/RESULTS.md`): T5 applies to peak
only, T7 is kept, and D1 became three bands. Still open: the docs listed in
Phase 7.

Three reviews ran on 2026-09-28: a red team of the whole system, an audit of the
onchain rating system, and a gas review of Surround and referee. This plan fixes
every finding, in two stages: the security and rating fixes first, then the gas
work. Everything ships together as one referee release, one new Surround world
and one new `SurroundRatings`. Sepolia's ratings start over; they are test data.

The findings are numbered as in the reviews: **RT** for the red team (H1–H3,
M1–M2, L1–L4, I1–I5), **RA** for the rating audit (1–8) and **G** for the gas
review (1–10). A review of this plan's first draft found three blocking gaps
(**B1–B3**) and ten should-fix items (**SF1–SF10**). A second pass found one more
blocking gap and two should-fix items (**N1–N3**). This revision addresses all of
them. [Coverage](#coverage) maps every finding to the items below.

## Principles

- **Referee stays game-agnostic.** Nothing in `core`, `referee_dojo`, the keeper
  or referee's SDK may know about Go. A fix a game needs goes through
  `GameRules` or `ClockRules` hooks, or a keeper entry hook. Hashfront (2 seats,
  hash-chain randomness, a 100-round limit) must be able to use every change as
  is. Referee's tests cover a game that uses randomness, not only the counter.
- **No protocol step is free to repeat.** A seat must not be able to add steps
  that aren't game moves (B1).
- **Gates live onchain.** Anything a rating depends on is checked by a
  contract, not only by the matchmaker or keeper.
- **Rating changes need evidence.** A change to rating results is re-run through
  the OGS replay (`offchain/ratings/evaluate.py`) or, without the dataset, the
  audit's synthetic population (`sim.py`). The log loss, calibration and 10-year
  drift are recorded in `offchain/RESULTS.md` before the change is kept.
- **One deploy.** The work lands in phases, but nothing is deployed to Sepolia
  until Phase 7.

## Decisions

D1, D3 and D5 were confirmed on 2026-09-28, and D1 and D2 revised on 2026-09-29
after the evidence; the rest are defaults.

| # | Decision | Choice | Alternatives |
| --- | --- | --- | --- |
| D1 | Starting bands a new account may choose | **Confirmed (revised 2026-09-29):** 23k, 17k and 6k. Two bands deflated the pool by about 5 ranks on OGS; three cost +0.0005 log loss and no drift. The price is cheaper farming (T6) | 23k and 17k only, with a rank offset; all four; 6k and 1k through a later placement step |
| D2 | Games between a settled and an unsettled player (T5) | **Revised after the evidence:** both ratings change; only peak skips games with an unsettled player | Only the unsettled player's rating changes (failed both evidence gates); half weight |
| D3 | Short games (under 20 steps) | **Confirmed:** void, as OGS aborts them, with a matchmaker cooldown for repeated aborts. Onchain resignations and abandonments are never voided (T4) | Only the loser's rating changes (deflationary) |
| D4 | Go game length | 3 × points moves in all; 2 × points moves after a resume | Other multiples |
| D5 | Admin delay | **Confirmed:** 48 h timelock on anything that loosens policy or upgrades, after a setup phase; standby keys allowlisted in advance; owner is a multisig | 24 h; 7 days |
| D6 | Kifu | Only games created from a ticket can mint | Also unrated timed games, marked unranked |
| D7 | Table games | Only for accounts with 5 or more rated games | No limit (today) |
| D8 | Sybil cost (account age, a pass) | Out of scope for this plan | Revisit with the go-to-market plan |
| D9 | Games before a player counts as settled (T5) | 10, with aged φ ≤ 1.0 | 5; 20 |

## Phase 1: referee v4 (game-agnostic)

Referee's Cairo is identical at `a2a5269` (Surround's pin) and `22e12a6`, so the
work starts from `main`. `PROTOCOL_VERSION` goes from 3 to 4, which changes every
context hash, so v3 and v4 games never mix.

### R0. One reader per language

Before anything else, every reader of `ChannelGame` goes behind one accessor per
language:
- referee's SDK `getChannel`;
- the keeper's `chain.mjs`;
- Surround's channel (`rate`), kifu and SDK;
- the matchmaker's `chain.mjs`, which today decodes `RatedGame` by field position
  (`ratedGameRecord`, `playedAt` at index 10).

R7 and T12 then change only the accessors.

### R1. Games are bounded, and protocol steps can't be spammed (RT-H1; B1)

- **`Recommit` needs a reveal first.**
  - `Envelope` gains a per-seat flag, `rng_fresh`. It is true while the seat's
    head is a tip it committed and hasn't revealed from.
  - `open` and `Recommit` set it, and `PlayRandom` and `Reveal` clear it for the
    seat whose chain they consume.
  - `Recommit` panics while it is set. So a seat can recommit at most once per
    reveal, and a game that never reveals (Go) can't recommit at all.
  - Today the due seat can sign any number of `Recommit`s inside one turn
    (`protocol.cairo:411`; `keeper/bench.mjs:27` calls it "a game that never
    ends").
- **Games bound their own length in their state.** This is where the game's
  real limit belongs:
  - Go: `move_number` in `apply` and `outcome`, see S2;
  - Hashfront: `MAX_ROUNDS` in its `outcome`;
  - the counter: its own count.
- **The protocol also bounds the transcript.** `GameRules` gains two functions:

  ```cairo
  /// Most steps (`seq`) a transcript may hold: at least the game's own bound
  /// times (1 + protocol steps per game action). A safety net, not the rule.
  fn max_steps(config: @Self::Config) -> u32;
  /// The result when a transcript reaches `max_steps`: (winner, reason).
  fn adjudicate(config: @Self::Config, state: @Self::State) -> (u8, u8);
  ```

  - **When it applies.** `advance` ends an unfinished game with `adjudicate` at
    the first step at or past `max_steps` that leaves no reveal pending. A
    `PlayRandom` is never cut off before its reveal applies.
  - **Why keep it.** It bounds transcripts, proofs and keeper storage for every
    game, including one with a bug in its own limit.
- **Keeper.**
  - `max_steps` becomes a per-entry setting, since Hashfront's bound (10⁴–10⁵
    steps) is far above Go's.
  - Config loading checks each entry against its codec's `maxSteps(config)`.
  - A step refused for capacity never leads to a flag, and the game's flag timer
    is disarmed when refereeing stops (`archive.mjs` `#merge`, `#arm`).

### R2. A dispute can't stop a live referee's clock (RT-H2)

The fallback of forced play exists for when the referee is down. A timed game
now reaches it only then.

- **`acknowledge(game_id, epoch, signature)`**, which anyone may send, stores
  `(epoch, deadline)`. It needs the referee's signature over
  `live_hash(context, epoch, deadline)`, a new `'REFEREE_LIVE_V1'` message, and
  it is valid in `DISPUTE` for a timed game.
- **`resolve`** commits the candidate as today. If the game is unfinished and
  timed, and the stored acknowledgement matches this dispute's epoch and
  deadline, the channel returns to `ACTIVE` (deadline 0). Otherwise it moves to
  `FORCED` as today. Untimed games are unchanged.
- **Clients** keep playing from their transcript. Only the anchor and epoch
  change, as after a checkpoint, and the SDK rebases. Step signatures don't bind
  the epoch (`action_hash`, `stamp_hash`), so no candidate is needed to
  continue.
- **`resume`** from `FORCED` in a timed game takes either every seat's reopen
  signature (as today) or the referee's alone. The referee signs under its own
  tag, `'REFEREE_RESUME_V1'`. A referee that comes back can restart play, and a
  staller can no longer keep the game onchain by refusing to sign.
- **Considered and rejected:** charging forced play by block time. The dispute
  window would then be charged to the due seat, which punishes the victim
  exactly when the referee is down.
- **Randomness.** A pending reveal is a one-step timed turn while `ACTIVE`, so a
  seat that won't reveal is flagged. The dispute changes nothing about that.
- **Cost of repeated disputes:** each one costs the opener a transaction and the
  keeper one `acknowledge`.
- **If the acknowledgement fails** (N2): the keeper may be down, or its
  transaction may not land. By `deadline − answer_margin`, the keeper and the
  SDK of the seat that didn't open the dispute each submit the latest attested
  state as the candidate. A dispute that ends in `FORCED` then starts from the
  latest state, not a stale anchor that is often the opening position.

### R2b. Segments chain from the candidate (SF2, N2)

- **Change.** While in `DISPUTE`, an unapproved submission (replay or proof) may
  start from the current candidate as well as from the anchor. The channel
  stores the block the candidate was set in, and a proof must be based at or
  after it. Everything else is unchanged: a submission must still outrank the
  candidate, and approved submissions still start from the anchor.
- **What it gives.** A transcript longer than one proof is settled as a chain of
  segments inside one dispute window. The first opens the dispute, each next one
  extends the candidate, and the finished one makes `resolve` settle the game.
  - The game never passes through `ACTIVE` or `FORCED` between segments, and no
    acknowledgement is needed.
  - Segments extend one attested branch, so each strictly outranks the last
    (`support_turn` ranking is unchanged).

### R3. The referee can start or restart the clock (RT-L2; SF3)

- **`Move::Start`** is added at the end of the enum, so the other variants keep
  their Serde indices. It is a referee step like `Flag`.
- **Validity.** It is valid in any state of a timed game and rejected in an
  untimed one. Replay doesn't authenticate referee steps individually, so an
  untimed game must never accept them.
- **Effect.** It sets the clock's stamp to its time, keeps `used`, and charges no
  one. That covers both cases:
  - a clock paused before the first move;
  - a stale stamp after `resume` from forced play with no forced step, where the
    next stamped step would otherwise charge the whole forced period.
- **`advance` finds a flag from the step (`Move::Flag`),** not from
  `seat == REFEREE` (`protocol.cairo:373`).
- **Who can send it.** Only the referee:
  - batches in a timed game need the referee's final attestation;
  - `force()` rejects referee steps.

  It gives the referee no power it lacks today: stamping at the old stamp's time
  already charges nothing.
- **Keeper policy (N3).**
  - The keeper sends at most one `Start` per join and per `resume`, keyed by
    epoch, so reconnecting can't erase a staller's elapsed time.
  - It sends it when the due seat's client first connects, or `start_grace`
    after it learns of the join or resume (default 2 minutes; per entry),
    whichever comes first.
  - After a `resume`, flag timers are suspended until that `Start`. The stale
    stamp would otherwise count the forced period and flag at once.
  - After a join, a due seat whose time has already run out is flagged instead.
- **Without a `Start`,** the first stamped step still starts a paused clock, as
  today.
- **Kifu.** Surround's kifu record codec (`record.cairo`, `kifu.mjs`) skips
  `Start`, as it skips `Flag`.

### R4. Separate reason for abandonment (RT-L3)

`REASON_ABANDON = 130` for `claim_timeout`: the chain judged that a seat missed
its forced-play window. `REASON_TIMEOUT = 129` stays the referee's `Flag`, which
is the only path by which a referee decides a result.

### R5. Keeper hardening (RT-M2, RT-H1; B2, SF2, SF4)

- **Admission.**
  - Capacity counts open games only. Settled and cancelled sessions leave memory
    (`known`, `#loaded`) and stay on disk.
  - An anchored, joined game that names this keeper's referee key is never
    refused for a per-player limit.
  - A per-entry `admit(ids, terms) → priority` hook decides who gets reserved
    capacity when the keeper is near full. Surround ranks games with a
    `RatedGame` first.
  - Per-player caps (`max_open_per_player`, default 4) apply to unanchored games
    only. Those need nothing but wallet signatures and today never close. An
    unanchored game is evicted when it finishes or after `unanchored_ttl` idle.
- **The keeper registers joined games itself,** from the channel's
  `ChannelUpdated` events for games that name its referee key, reading the terms
  onchain. Every such game gets a referee and a `Start` even if neither seat
  registers it.
- **Disputes.**
  - For a timed game it referees, the keeper sends `acknowledge` at once.
  - It submits a candidate only for a finished game (as chained segments when long, R2b), or as the fallback in R2.
  - It answers again only when a new dispute opens.

  This replaces a `submit_history` on every 15 s poll.
- **Long transcripts.** A transcript longer than the entry's `proof_max_steps`
  is settled as a chain of segments inside one dispute window (R2b).
  - Today the watcher proves the whole base in one proof and has no checkpoint
    path (`watch.mjs:57`), so a board-filling 19×19 game past about 550 steps
    would be left unsettled.
  - PROOF2 removes most of this later.
- **Self-registration cost.** `ChannelUpdated` doesn't carry the referee key, so
  each `JOINED` event costs one terms read.
- **Settle policy.** `max_history_steps` becomes a per-entry `replay_max_steps`,
  set from measured costs (G1).
- **After-settle hook.** An entry may export `afterSettle(ids)` that returns
  extra calls. The keeper appends them to the transaction that settles the game
  when simulating the bundle succeeds, and sends them separately otherwise.
  Surround uses it for `rate` (G5).
- **Capacity for the matchmaker.** `GET /info` reports free capacity, so the
  matchmaker can check it before issuing a ticket.

### R6. Versions, tests and docs

- `PROTOCOL_VERSION = 4`; the SDK's `Session`, `Referee`, codec interface
  (`maxSteps`, `adjudicate`) and hashing mirror the Cairo.
- `referee_testing` gains a small game with randomness, so reveals are covered.
  It is tested with:
  - `Recommit` spam;
  - the cap with a reveal pending;
  - `Start` before the first move and after a resume with no forced step;
  - flags, and disputes that return to `ACTIVE`;
  - the referee's `resume`;
  - `REASON_ABANDON`;
  - segments chained from the candidate (R2b), including a proof based before
    the candidate's block, which must fail.
- The keeper tests cover:
  - the admission attack (unanchored games filling a cap);
  - self-registration from events;
  - answering a dispute once;
  - the fallback submission when an acknowledgement doesn't land;
  - one `Start` per epoch, with flag timers suspended after a resume;
  - settling a long game as chained segments;
  - no flag after a refused step.
- `DESIGN.md` and the docs site describe the new steps, entrypoints and hooks.
- A referee release is tagged; Surround pins it.

The storage split (R7) is gas work and comes in Phase 6, before the same release.

## Phase 2: Go rules v3 (Surround only)

`RULES_VERSION` goes from 2 to 3.

### S1. One resume, then play it out (RT-H1; SF1)

- **`GoState` gains `resumed_at: u32`:** the move number of the game's one resume
  (0: none).
- **`Resume` is allowed only while `resumed_at == 0`.**
- **After a resume:**
  - Two consecutive passes end the game at once, by area score with every stone
    on the board alive. There is no proposal and no further resume. Reason
    `PLAYED_OUT = 2`.
  - The game also ends the same way after `2 × points` more moves. Reason
    `MOVE_LIMIT = 3`.
- **Fairness.** `rules::score` is area scoring (`rules.cairo:433`): stones plus
  territory.
  - Capturing an invader costs nothing, and superko makes throw-in and capture
    exchanges finite. A player who plays it out loses nothing, provided they
    capture invaders rather than pass.
  - The budget of 2 × points moves must cover the defender's territory plus the
    dead stones. A test with an adversarial throw-in bot checks that it does.
  - The scoring view tells players to capture any stone left inside their area
    before passing.
- **Later option:** remove stones in pass-alive territory (Benson) when a cap is
  reached.

### S2. Go's length limit, `max_steps` and `adjudicate` (B1, SF2)

- **Go's own limit.** `apply`/`outcome` ends the game when `move_number` reaches
  3 × points (243, 507 and 1,083 moves), by area score with every stone alive.
  Reason `MOVE_LIMIT`. That is well above real games; the longest measured is 529
  steps, a board-filling stress game.
- **`max_steps = 3 × points + 64`** is the protocol's safety net.
  - With `Recommit` impossible in Go, the only steps that aren't moves are
    `Propose`, `Accept` and `Resume` (at most a few), and `Start`, `Flag` and
    `Resign`.
  - `adjudicate` scores the same way.
- **Proving.** A 19×19 game can pass one PROOF1 (about 550 steps). It settles
  as chained segments (R2b, R5) until PROOF2 is accepted.
- **Worst stall** with the 60 s per-turn preset: after a resume, up to
  `2 × points` moves, half of them the staller's (about 80, 170 and 360 minutes).
  Before any pass, Go's limit bounds it.

### S3. Everything that mirrors the rules

- **The SDK's Go codec** (`offchain/sdk/src/index.mjs`) and its vectors.
- **Kifu:** `render` names the new reasons, and the record codec skips `Start`.
- **The web app's scoring view:** after a resume it says that two passes end the
  game with every stone counted, and shows the moves left.
- **Fixtures and tests:** the red team's scoring loop becomes a regression test
  that must end the game.

## Phase 3: `SurroundRatings` v2 and the channel

A fresh contract replaces the current one; no migration. `PARAMS` becomes 2.

### T1. Rating is bound to the ticket (RA-2, RT-I3)

- **`check_ticket`** keeps every check it has today.
- **The channel calls it after `binding::create`,** passing the game id.
- **It stores the game id** with the digest: `tickets[digest] = (ACCEPTED, game_id)`.
- **`rate_game(ticket, result)`** replaces `rate_game(game)`.
  - It takes `GameResult { game_id, winner, reason, played_at, settled_at, steps }`.
  - It recomputes the digest from the ticket (about 53K gas) and requires:
    - the caller is `ticket.channel`, and that channel may rate (T2);
    - `tickets[digest]` is `ACCEPTED` with the same `game_id`;
    - `issued_at ≤ played_at ≤ expires_at`, and `played_at ≤ settled_at ≤ now`.
  - Anything else returns `None`, as today.
  - The players, board, bands, source, matchmaker and referee key all come from
    the ticket. Only the result, its times and the step count come from the
    channel, which hosted the game.
- **Status is keyed by digest.** `ticket_status(digest)` replaces
  `game_status(channel, game_id)`.
- **`TicketUsed` carries the whole ticket,** so anyone can call `rate` and rebuild
  any rating.
- **Consequences:**
  - A fresh `SurroundRatings` has no accepted tickets, so pointing a world at it
    can't re-rate that world's history (RT-I3).
  - `played_at = u64::MAX` is impossible (RA-2).

### T2. Channels: active, retiring, removed (RT-I4, RA-2)

`channels[address]` holds `NONE`, `ACTIVE` (tickets and rating) or `RETIRING`
(rating only). An old world's channel retires, and it is removed once all its
games are rated. The allowlist no longer accumulates old channels that can still
take new tickets, and retiring a channel no longer strands its unrated games.

### T3. Retire a key or revoke it from a time (RA-3, RT-L3; SF7)

- **Matchmaker and referee keys** hold `(state, revoked_at)`.
- **`retire_*`:** no new tickets name the key, and games it already covers still
  rate.
- **`revoke_*(key, at)`**, with `at ≤ now` (the owner may pick a past time, such as
  a suspected compromise), retires the key and voids games not yet rated:
  - for a matchmaker: games with `played_at ≥ at` (chain time, set at join);
  - for a referee: games that ended by `REASON_TIMEOUT` with `settled_at ≥ at`.
- **`REASON_ABANDON` (R4) is never voided** for a referee revocation.
- **Rated games are never undone.**
- **Routine rotation:** apply the new key, then retire the old one. Nothing
  honest is voided.
- **Limit.** Games are rated right after they settle (G5), so revoking from a
  past time mainly catches games still in play. Against a stolen key, the defense
  is custody (a KMS for the matchmaker and referee keys) and monitoring:
  `replay.mjs` plus alerts on unusual pairings.

### T4. Short games (RT-H3; D3, SF5, SF8)

- **The channel reports `steps` as `max(anchor.seq, candidate.seq)`** at
  settlement.
- **How the game settled matters.** Surround's `Settlement` records which
  entrypoint settled the game (`via`): a submitted transcript, `resolve`,
  `resign_channel` or `claim_timeout`.
  - An offchain `Resign` step and `resign_channel` both carry reason 128.
  - Only a transcript's step count shows how long the game really was. The keeper
    submits only at the end, so an onchain settlement usually sits on a stale
    anchor, often seq 0.
- **Below `MIN_RATED_STEPS = 20`, a game settled from a transcript is void** (D3).
  Once R1 makes `Recommit` impossible in Go, steps count moves plus a few
  scoring and referee steps.
- **Onchain endings are never void (N1).** A game settled by `resign_channel` or
  `claim_timeout` (`REASON_ABANDON`) with under 20 steps on record updates only
  the loser; the winner's side changes as in T5's skipped side.
  - Otherwise the loser of any game could call `resign_channel` before the keeper
    submits, look like 0 steps, and have the loss voided.
  - The cost is that an honest winner gains nothing from an opponent who resigns
    onchain out of spite. The loser still loses.
- **What this blocks:**
  - Resigning at move 0 farms nothing.
  - Resigning onchain dodges nothing.
  - Repeated aborts earn a matchmaker cooldown, so voiding can't be used to dodge
    bad pairings.
- **The SDK resigns offchain by default:** a `Resign` step the keeper settles
  with the full transcript. `resign_channel` stays a fallback for when the keeper
  is down.

### T5. Settled players and unsettled opponents (RT-H3, RA-7; B3, SF8; D2, D9)

- **Settled** means `games ≥ 10` and aged φ ≤ 1.0, with no win/loss clause. Today
  an unbeaten farmer stays provisional forever (`math.cairo:103`).
- **Rating.** A settled player's rating doesn't change in a game against an
  unsettled opponent; the unsettled player's does.
- **The skipped side** is only aged: φ moves to its aged value at the game time
  and `last_played` to the game time. μ, the counters and `established` don't
  change, and `games` (derived from W+L+D, G9) doesn't count the game.
  `RatingUpdated.applied` records which sides changed.
- **Peak** moves only in queue games between two settled, established players.
- **Display.** The "?" rule shown to players stays as RANKING_PLAN defines it,
  with φ aged (T9). Settled is an internal gate.
- **Evidence gate.** Replay OGS with this rule. If the log loss rises by more than
  0.002 or `sim.py` shows more than 0.2 logits of extra drift over 10 years, keep
  full updates and apply the rule to peak only.
- **Farming test.** The review's adaptive attacker
  (`scratchpad/farm.mjs`) becomes a regression test and a published table: fresh
  accounts, games of 20 or more steps played by bots, an unbeaten main account,
  pyramids, and φ regrowing while idle. The table gives the rank the main account
  reaches against the number of accounts, and the test asserts it.

  Before T4–T7: 10 accounts → 8k, 80 → 3k, 221 in a pyramid → 1k. With T5 an
  unsettled feeder can't move a settled main account, so each extra rank needs
  settled feeders, which cost 10 or more games each.
- **As built:** the rule failed its gates and applies to peak only. Ratings are
  as farmable as before; peaks need settled feeders. See T6 for the table.

### T6. Starting bands are policy (RT-H3, RA-1; D1)

- **Onchain:** a `start_bands` bitmask policy (default: bands 1–3, 23k, 17k and
  6k). `check_ticket` rejects any other band for a player with no rated games.
  Removing a band takes effect at once, even after `seal`; adding one waits for
  the timelock.
- **Matchmaker:** it requires an explicit band from the allowed set and has no
  default.
- **Evidence** (`offchain/RESULTS.md`):
  - With 23k and 17k only, strong newcomers enter low and take rating from the
    pool while they climb. On OGS the pool deflated by about 1.5 logits, about 5
    shown ranks, and a newcomer's first game predicted worse than a coin flip.
  - Dropping only 1k costs +0.0005 log loss and leaves the drift where it was.
- **Farming** (`offchain/ratings/audit/farm.mjs`; `rating.test.mjs` pins the
  6k rows). Games of 20 or more steps between the attacker's own accounts:

  | Highest band | Attack | Accounts | Games | Main account reaches |
  | --- | --- | --: | --: | --- |
  | 17k | fresh accounts | 11 | 10 | 8k |
  | 17k | fresh accounts | 81 | 80 | 3k |
  | 17k | pyramid 20×10 | 221 | 220 | 1k |
  | 17k | settled feeders, peak | 40 | 459 | peak 8k |
  | **6k** | fresh accounts | 11 | 10 | 1d |
  | **6k** | fresh accounts | 81 | 80 | 5d |
  | **6k** | pyramid 20×10 | 221 | 220 | 6d |
  | **6k** | settled feeders, peak | 40 | 459 | peak 1d |
  | 1k | fresh accounts | 11 | 10 | 5d |

  A 6k start is worth about 11 ranks to a farmer. The table leaves out the
  matchmaker, which pairs from a shared queue with a rank gap, repeat limits and
  one open game per player, so a farmer must also win those pairings. If
  farming shows up, dropping 6k takes effect at once.

### T7. μ may leave the displayed range (RA-4)

- **The floor:** `MU_MIN` falls to OGS's floor (rating 100, μ ≈ −8.06). 30k stays
  the lowest rank shown: `rank_of` already returns 0 below it.
- **The ceiling:** `MU_MAX` rises likewise, and 9d stays the highest rank shown,
  so the top doesn't deflate.
- **Farming:** a player losing on purpose now keeps losing μ, so an account near
  the floor is worth little to a farmer.
- **Changes results.** This needs the SDK's `rating.mjs`, regenerated vectors,
  `PARAMS = 2` and a re-run of the evaluation.

### T8. Anchoring the scale (RA-1)

- **`rank_offset_tenths`** (owner-set, timelocked) shifts every displayed rank.
  - It is applied before clamping to the displayed range.
  - Starting bands and stored ratings are raw μ and never change.
  - Each change is emitted, and `replay.mjs` reads the events.
  - After a change, the mirror refreshes one player at a time through `sync`, or
    the web applies the offset itself from the contract.
- **`evaluate.py --drift`** and the matchmaker's monitoring report the mean μ of
  established, active players against their expected strength over time.
- **As built:** the offset starts at 0. With three bands the simulated pool
  holds its level while players' strength is steady (−0.01 logits over 10
  years), but sinks about 2.6 logits when beginners improve. `replay.mjs`
  reports the signal: newcomers' first games against players with 10 or more
  games, points won against points expected. Newcomers start at fixed band
  values, so a pool that has sunk makes them score below the prediction. The
  owner sets the offset from that gap.

### T9. Views age φ (RA-6)

`player()` and `ranks()` age φ to the block time before they compute the "?"
flag, the settled gate and the rank. An idle player shows "?" once their aged φ
passes 1.0, as their next game would treat them. `established` stays sticky.

### T10. Ratings can be replayed from events (RA-5)

- **`RatingUpdated`** gains:
  - `digest`, `source` and `steps`;
  - `params`;
  - the pre-game μ, φ and `last_played`;
  - `applied`.
- **Checks.** Each event can then be checked on its own: its update from its
  pre-game state. The chain can be checked too: each pre-game state equals the
  player's previous post-game state.
- **`offchain/sdk/src/replay.mjs`** fetches every `TicketUsed`, `RatingUpdated`,
  `GameVoided` and policy event in chain order, checks both properties with
  `rating.mjs`, and exits non-zero on the first mismatch. It runs in CI against
  Devnet, and weekly against Sepolia.

### T11. Admin (RT-I5, RA-2; SF6, SF10; D5)

- **Two-step ownership:** `transfer_ownership` then `accept_ownership`.
- **Setup phase.** The owner applies policy at once until it calls `seal()`, so
  the first deployment isn't held for 48 h.
- **Timelocked after `seal()`.** Anything that loosens policy or trusts more
  takes two steps: `queue_*` then `apply_*` after `TIMELOCK_SECONDS` (48 h), with
  `cancel`. A queued action expires after 7 days. This covers:
  - `upgrade`;
  - adding a channel or a key;
  - adding a clock preset, prover, board or starting band;
  - widening the response window;
  - `rank_offset_tenths`.
- **Immediate.** Tightening calls apply at once: retire, revoke, remove, and
  revoking a prover class (`allow_prover(…, false)`).
- **Standby keys.** A second matchmaker key and a second referee key are
  allowlisted in advance and kept offline, so revoking a key never halts rated
  play for 48 h.
- **The Dojo namespace owner** can upgrade the channel, grant writers and allow
  provers. It is put behind the same multisig and a timelock contract. The
  channel's ratings address is fixed at `dojo_init`, so `set_ratings` goes away:
  a new ratings contract means a new world.
- **Owner:** a multisig account (operations; in the deploy checklist).

### T12. The channel (Surround)

- **`RatedGame`** becomes `{ game_id, ticket: digest, times }`, where `times`
  packs `expires_at` and `played_at` into one `u128` (G4).
  - `rated_game(game_id)` returns it.
  - The web reads a ticket's facts from `TicketUsed`.
- **`create_rated_channel`** creates the game, then calls `check_ticket` with its
  id.
- **`join_channel`** reads and writes `times`.
- **`rate(game_id, ticket)`:**
  - It checks `ticket::digest(ticket) == rated.ticket`.
  - It reads the settled status, result, both references' `seq` and
    `Settlement.timestamp`.
  - It calls `rate_game(ticket, result)`.
  - It mirrors the result (see G6 for the event shape).
- **The ratings address** is set once at `dojo_init` (T11).
- **The kifu** mints only for games with a `RatedGame` (RT-L4; D6).

## Phase 4: offchain services, SDK and web

### O1. Matchmaker (RT-M1, RT-L1, RT-I2, RA-8; SF9)

- **Rating in batches.**
  - `rate` splits due games into batches whose estimated fee fits
    `max_fee_fri`, and falls back to one game per transaction.
  - Players are freed when their game settles, not when rating succeeds.
  - Rating retries until the ticket's status is `RATED` or `VOID`. After a few
    `None` results in a row it stops and raises an alert.
- **No-shows.**
  - When black cancels, or creates the game too late for white to join, black
    gets the cooldown.
  - `Lobby.finished` counts each pairing once (keyed by digest).
- **Aborts (T4):** repeated short, voided games earn a cooldown.
- **Surviving restarts.**
  - Tickets, pairings, open counts and the request replay guard persist to disk.
    An unused ticket isn't in `TicketUsed`, so it can't be rebuilt from the chain.
  - Signed requests carry a nonce, and table ids are random.
  - If the store is lost, pairing pauses for one ticket life after startup.
- **Bands (T6):** an explicit band from `start_bands`.
- **Tables (D7):** each player needs 5 or more rated games.
- **Capacity:** it checks the keeper's free capacity before issuing a ticket.
- **Calls:** `rate(game_id, ticket)`, and model decoding by name through R0's
  accessor.
- **RT-I1** (`GET /queue/:player` is unauthenticated) stays: only black can use a
  ticket.

### O2. Keeper configuration for Surround

- The Go codec exports `maxSteps`.
- `admit` ranks games with a `RatedGame` first.
- `afterSettle` returns `rate(game_id, ticket)`, with the ticket from `TicketUsed`.
- `replay_max_steps` and `proof_max_steps` per board size (G1, R5).
- A referee key is set, so the keeper sends `Start` and `acknowledge` and
  registers joined games itself.

### O3. SDK and web

- **SDK:**
  - `rating.mjs` for `PARAMS = 2`: the floor and ceiling, the short-game and
    settled rules, and φ aged in views;
  - `replay.mjs`;
  - the ticket and `rate` call builders;
  - the Go codec v3;
  - kifu reasons and `Start`;
  - resigning offchain by default.
- **Web:**
  - an explicit band choice;
  - "?" from aged φ;
  - a note when a game won't change a player's rating (T4, T5);
  - the scoring view after a resume;
  - the new reasons.

### O4. Adopt the review harnesses

- The rating audit's `constants.py`, `fuzz.mjs`, `drift.mjs`, `sim.py`,
  `test_audit.cairo` and `audit_fuzz/` move into `offchain/ratings/audit/` and
  `ratings/src/tests/`.
- The red team's proofs of concept become regression tests that the fixed code
  must pass:
  - `test_redteam.cairo`;
  - `redteam.test.mjs`;
  - the keeper tests.
- So does the plan review's `farm.mjs` (T5), as `offchain/ratings/audit/farm.mjs`.
- Their current copies are in `.claude/worktrees/agent-*` and the session
  scratchpad.

## Phase 5: gas, Surround side

Measured against the gas review's per-game baseline for a rated 9×9 game:
124.6M L2 gas settled by replay (create 22.9M, join 18.4M, settle 53.5M, rate
9.4M, mint 20.4M), or about 174M settled by proof. The gas review's
`test_gas_profile.cairo` comes into the repo first, so every item reports its
before and after.

| # | Change | Expected saving | Notes |
| --- | --- | --- | --- |
| G2, G9 | `SurroundRatings` stores one felt per player (231 bits; `games` derived), packs with `u128`, and skips the unused P in the update | −0.83M per rate (measured), −0.2M more per rate, −0.8M per new player | Written this way in Phase 3, since the contract is new; measured here |
| G4 | Slim `RatedGame` | about −5M per game | Done by T12; measured here |
| G3 | Kifu mint reads only what it needs | −1.8M per mint | Re-done against R7's models in Phase 6 |
| G6 | `rate` emits less: both players' `PlayerRank` in one `emit_events` call; `RatingChanged` dropped, with Torii configured to keep `PlayerRank` historical (a Torii setting; Dojo 1.8 has no event attribute for it); the ratings address in the contract's own storage instead of the `RatingsConfig` model | about −0.95M per game | Torii readers change |
| G5 | Keeper bundles settle and `rate` (R5's hook) | −0.8 to −1.0M per game | Only after a successful simulation |
| G1 | `replay_max_steps` per board size | 13–48M for 65–150-step games today | Measure 13×13 and 19×19 replay cost per step first; revisit when proof batching lands (break-even falls to about 30 steps at 8 games per proof) |

Not pursued, as the review recommends:
- rating math beyond dropping P (G10; under 0.2% per game, and it would change
  rounding);
- `check_ticket`;
- the Go rules;
- replay calldata compression.

## Phase 6: gas, referee side

### R7. Split `ChannelGame` (G7; G8 revised)

- **Two models:**
  - `ChannelTerms`: written at create and join; read only where terms, keys or
    config are needed.
  - `ChannelState`: hand-packed into about 4 felts. It holds:
    - both hashes;
    - status, epoch, deadline and anchor block;
    - both references' small fields and the result;
    - R2's acknowledgement.
- **No duplicated data.** The candidate is stored only when it differs from the
  anchor, and the result is not stored twice.
- **Expected saving (gas review, prototype measured):** about −24M per game:
  create −3M, join −6.5M, settle −13 to −15M, mint −2.3M. That is 20% of a game
  settled by replay.
- **G8 is revised, not adopted.** A packed state isn't readable in Torii, so
  `ChannelUpdated` stays as the readable view. It is trimmed to what clients use.
- **Readers** change only inside R0's accessors. The adapter's `snapshot` keeps
  its interface.
- The prototype is in the gas review's worktree (`src/tests/test_gas_packed.cairo`).
- Ships in the same referee release as Phase 1.

## Phase 7: deploy and measure

1. Tag the referee release; pin it in `Scarb.toml`.
2. Build the proving executable and adapter for rules v3 and protocol v4.
   Allowlist the new adapter class, and set the keeper's prover class hash.
3. Deploy `SurroundRatings` v2 with a multisig owner. Set the policy in the
   setup phase (T6, T11, boards, presets, keys, standby keys), then `seal()`.
   The matchmaker issues no ticket before `seal()`.
4. Deploy the new world:
   - update `[writers]` in `dojo_dev.toml` and `dojo_sepolia.toml`;
   - update Scarb.toml's `build-external-contracts` for the new models;
   - set a new world `seed`;
   - set the ratings address at `dojo_init`;
   - put the namespace behind the multisig and timelock;
   - set the channel as `ACTIVE`, and retire the old one.
5. Configure Torii (historical `PlayerRank`), the matchmaker, the keeper and the
   web.
6. Run `local.py` end to end on Devnet, then on Sepolia:
   - a normal game;
   - the red team's scoring loop and dispute attack, which must fail;
   - a `Recommit`-spam attempt;
   - a 19×19 game long enough to need chained segments;
   - an early onchain resignation, which must still count as a loss;
   - a revoked-key game;
   - a short game.
7. Measure the lifecycle on Sepolia against the baseline; record in
   `offchain/RESULTS.md`.
8. Update `RANKING_PLAN.md`, `OFFCHAIN_PROTOCOL.md`, `ONCHAIN_REFERENCE.md`,
   `PROVING_PLAN.md` (break-even table for batching) and fix RA-8's doc nit (the
   half-life ramp starts at 14k, not 15k).

## Tests

- **Referee (R0–R7):** unit tests in `core`, and Dojo tests for the counter and
  the randomness game. The attack tests are listed in R6.
- **Rules (S1–S3):**
  - the scoring loop ends;
  - play-out scoring;
  - both of Go's limits and `max_steps`;
  - an adversarial throw-in bot within the 2 × points budget;
  - the SDK codec matches on vectors.
- **Ratings (T1–T11):**
  - a digest that doesn't match, or a reused or unknown ticket;
  - `played_at` bounds;
  - retiring and revoking with times;
  - short games by each `via`: void from a transcript, loser-only from
    `resign_channel` or `claim_timeout`;
  - the settled gate and the skipped side;
  - band policy;
  - the floor and ceiling;
  - the setup phase, `seal()`, the timelock and expiry;
  - two-step ownership;
  - events that are sufficient for `replay.mjs`;
  - the audit's fuzz tests and parity vectors, regenerated for `PARAMS = 2`.
- **Matchmaker:**
  - fee-capped batches;
  - freeing players;
  - cooldown attribution and aborts;
  - rebuilding after a restart, with and without its store;
  - the retry cap.
- **Farming:** the T6 table, pinned for the default bands.

## Coverage

| Finding | Items |
| --- | --- |
| RT-H1 endless scoring and the keeper cap | S1, S2, R1, R5 |
| RT-H2 escaping the clock through a dispute | R2, R5 (admission) |
| RT-H3 rank farming | T4, T5, T6, T7, O1 (tables) |
| RT-M1 matchmaker stall | O1 |
| RT-M2 keeper capacity and dispute costs | R5 |
| RT-L1 cooldown and double `finished` | O1 |
| RT-L2 clock at move 0 | R3, R5 (self-registration) |
| RT-L3 voiding at rating time | T3, R4 |
| RT-L4 fake ranked kifu | T12 (D6) |
| RT-I1 unauthenticated queue status | Accepted, O1 |
| RT-I2 replay guard and table ids | O1 |
| RT-I3 re-rating history through `set_ratings` | T1, T11 (`set_ratings` removed) |
| RT-I4 removed channels strand games | T2 |
| RT-I5 owner trust and one-step transfer | T11 |
| RA-1 unanchored scale, self-chosen bands | T6, T8 |
| RA-2 contract trusts the channel | T1, T2, T11 |
| RA-3 revocation voids in-flight games | T3, R4 |
| RA-4 floor at 30k | T7 |
| RA-5 replay from events | T10 |
| RA-6 views don't age φ | T9 |
| RA-7 table games inflate peak | T5, O1 (D7) |
| RA-8 `max_open` in memory; doc nit | O1, Phase 7 |
| G1 replay cutoff | Phase 5 |
| G2, G9 ratings storage and packing | Phase 3 (built), Phase 5 (measured) |
| G3 kifu read | Phase 5, R7 |
| G4 slim `RatedGame` | T12 |
| G5 bundle settle and rate | R5, Phase 5 |
| G6 fewer `rate` events | Phase 5 |
| G7 split `ChannelGame` | R7 |
| G8 drop `ChannelUpdated` | Revised in R7: kept, trimmed |
| G10 math | Not pursued |
| B1 `Recommit` spam; Go-shaped cap | R1, S2 |
| B2 keeper admission brings back RT-H2 | R5 |
| B3 unbeaten main bypasses T5 | T5 |
| SF1 play-out budget | S1 |
| SF2 19×19 vs PROOF1 | R2b, R5, S2 |
| SF3 `Start` details | R3 |
| SF4 answering disputes | R2, R5 |
| SF5 stale anchor in T4 | T4, O3 |
| SF6 namespace owner | T11 |
| SF7 revocation vs immediate rating | T3 |
| SF8 skipped side; deflation; drift gate | T4, T5 |
| SF9 matchmaker restart, decoding, retries | O1, R0 |
| SF10 timelock at deploy; deploy gaps | T11, Phase 7 |
| N1 onchain resign voids a loss under D3 | T4 (`via`; onchain endings never void) |
| N2 forced play from a stale anchor; checkpoint path | R2 (fallback submission), R2b |
| N3 `Start` keeper policy | R3 |

## Residual risks

- **Sybils.** Free accounts can still build a pyramid: with a 6k start, 10
  accounts make a 1d rating and 40 settled ones a 1d peak (T6). T4 voids instant
  resignations and T7 makes a floored account worth little, but only a cost per
  account (D8) removes the attack. Dropping 6k lowers every row by about 11
  ranks, at once.
- **The referee is trusted for time and liveness.** It can flag unfairly, censor
  a seat, keep a game offchain by acknowledging disputes, or resume one out of
  forced play (R2). A bond that equivocation evidence can slash is on referee's
  roadmap.
- **Spiteful onchain resignations.** An onchain resignation before 20 recorded
  steps costs the winner the rating gain (T4).
- **Repeated disputes** cost the opener and the keeper one transaction each.
- **Revocation** doesn't undo rated games (T3).
- **Engine assistance offchain** remains out of reach; rewards stay status-only.
- **Hashfront's port** is not part of this plan. R0–R6 are designed so it
  implements `max_steps`, `adjudicate` and its own round limit, and needs no
  referee change.
