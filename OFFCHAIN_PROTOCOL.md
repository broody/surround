# Surround offchain protocol v4

Decision: 2026-09-07. Normal play is offchain; ranked results settle on Starknet.
Clocks are optional and referee-attested (since 2026-09-27): a ranked game runs
Surround's per-turn clock, 60 s per turn, stamped by the keeper named in its
terms; a casual game is untimed. The channel, SDK, native adapter and local
proving executable implement this protocol.

**v2 (2026-09-26): Surround runs on [referee](https://github.com/broody/referee).**
The protocol below is unchanged in substance, with these differences from v1:
- steps sign the game terms, the sequence number and the running transcript
  rather than the full previous state;
- the channel stores anchor and candidate state hashes, and full states are
  supplied as calldata;
- forced play takes the due seat's steps up to the next change of due seat in
  one transaction;
- an owner-set allowlist of adapter classes replaces the compile-time pin;
- resignation is referee's `Resign` move;
- seats are 0 (black) and 1 (white).

**Referee protocol v2 (2026-09-26): compact steps.** Calldata and proofs carry
only what replay checks:
- a step is referee's `Move<GoAction>`. The seat is implied by the state
  (whoever is due) except for `Resign(seat)`, and there is no entropy field
  (Go never requests randomness);
- `GoAction` is an enum: `Play(point)`, `Pass`, `Propose(dead)`, `Accept`,
  `Resume` (rules version 2). A stone is 3 felts of calldata, down from 10;
- a batch carries one final signature per seat, not one per step
  ([final-signature authentication](#final-signature-authentication)).
Signatures from protocol v1 do not verify under v2: the protocol and rules
versions are both in the signed context.

**Referee protocol v3 (2026-09-27): referee clocks.** Referee commit
[`a2a5269`](https://github.com/broody/referee/commit/a2a5269), with pluggable
time rules. See [Ranked clocks](#ranked-clocks). Every context and state hash
changed, so no v2 signature, state or proof carries over:
- the terms gain `clock: Option<TimeControl { referee, settings }>` after the
  response window, and the envelope gains
  `clock: Option<Clock { seats, used, stamp }>`. Both are `None` in a casual
  game. `settings` and `seats` are serialized by the game's time rules: Go uses
  referee's `StandardTime`, with settings `Standard { turn_ms, bank_ms,
  increment_ms, byoyomi: Option<Byoyomi { periods, period_ms }> }` and each
  seat's `StandardClock { banks, periods }`. `used` is the time the current
  turn has used;
- replay calldata is a `Batch { steps, stamps, signatures, attestation }`: an
  untimed batch has no stamps and a zero attestation (3 felts more than v2), a
  timed one a stamp per step and the referee's last attestation;
- `create_channel` takes the time control, `submit_history` and the adapter's
  `__execute__` take a `Batch`, and `get_channel` returns the time control as
  `referee` (zero when untimed) and `clock_settings`;
- the referee's `Flag` is a step (actor 254). The flagged seat loses with
  `REASON_TIMEOUT` (129).

**Referee protocol v5 (2026-09-30): randomness from the referee.** Referee
commit [`262873e`](https://github.com/broody/referee/commit/262873e), after v4's
hardening ([HARDENING_PLAN.md](HARDENING_PLAN.md), Phase 1). A timed game may
now take its randomness from its referee. Go takes none, so play is unchanged,
but every context and state hash changed again, and no v4 signature, state,
ticket or proof carries over:
- the time control is `TimeControl { referee, settings, rng_tip }` and the
  envelope gains `rng_referee`. Both new fields are always 0 in Surround;
- both create entrypoints refuse a time control that asks for the referee's
  randomness (`'Go takes no randomness'`);
- a rated ticket carries the time control, so its digest changed, and
  `SurroundRatings` was redeployed for it. A clock preset is still the
  settings alone.

Go's rules are referee's `GameRules` (`rules/src/go.cairo`).

## Authentication and rules

Each wallet registers a Stark-curve session public key when creating/joining a
Dojo channel. Terms bind the chain, channel contract, game ID, both wallets and
keys, proof adapter, size, komi, rule version and response window. Each step
signs those terms, the sequence number, the running transcript hash and its
canonical payload. Sequence numbers and the transcript chain prevent replay and
fork mixing.
Clients verify every signature they receive. A proof checks every transition,
including positional superko across passes and scoring disputes, and each
player's final signature in the batch, which authenticates all of that player's
earlier actions ([why](#final-signature-authentication)). Players retain the complete transcript.

After two passes, the next player proposes a complete dead-stone mask. The other
player accepts or resumes play; either player may resign. Before a proposal, the
player due to act may also resume. Resumption restores the player who was due to
move after the passes, preserves all position history and clears the proposal.
This serial scoring negotiation gives the contract an unambiguous player due to
respond. Clients can let both players prepare markings independently before the
proposal is signed. A proof never decides life and death.

A game resumes at most once (rules version 3). After that resume, two passes
end the game at once, scored by area with every stone on the board alive
(`PLAYED_OUT`): capturing dead stones costs nothing under area scoring, so a
disagreement is settled by playing it out, and a loser can't loop pass, pass,
resume forever. Two limits bound every game, each scored the same way
(`MOVE_LIMIT`): three times the board's points in moves, and twice its points
after the resume. Referee's transcript cap (`max_steps`, the move limit plus
64 steps) is a safety net behind them.

## Ranked clocks

A ranked game names a referee in its terms: the public key of the keeper that
relays it ([referee's keeper](https://github.com/broody/referee/blob/a2a5269/keeper/README.md#referee)).
Players sign moves; the referee signs time. The key comes from the keeper's
`GET /info` (`keeperReferee`) and is passed with the settings as
`create_channel`'s `clock`. Both seats accept it by joining. Ranked games offer
two time controls, both run by referee's standard time rules:

| Time control | Settings | SDK |
| --- | --- | --- |
| Per-turn timer (Surround's old clock) | `turn_ms` 60 s, nothing carried over | `rankedClock(referee)` |
| Japanese byo-yomi | `bank_ms` (main time), then `byoyomi` periods of `period_ms` | `byoyomiClock(referee, { main_ms, periods, period_ms })` |

- **Flow.** A seat signs its step and marks it (`store.move`), without applying
  it: the step waits in `session.pending`, and the seat may sign the rest of its
  turn from `session.tip`. `KeeperClient.submit(session, { store })` sends the
  pending steps to the keeper, which stamps each with its clock in milliseconds
  and attests the transcript and clocks it reaches, and pulls them back. Both
  seats verify each seat's signature and the referee's attestation before
  applying a step, pulled (`pull`) or streamed (`follow`). A step signed but not
  yet sent survives a restart in the store's mark. `Session.move` refuses in a
  timed game.
- **Turns.** A turn lasts while `GoRules::due` stays with one seat; a Go turn
  is one move. The time since the last stamp adds up in the clock's `used`, and
  a step whose seat has used more than its time rules allow is refused (`Flag
  fell`). From then on the keeper may append its `Flag`, and the due seat loses
  on time. On the per-turn timer the limit is 60 s. On byo-yomi it is the
  seat's main time left plus its periods: a turn that ends inside a period
  costs nothing, each period that runs out is lost, and outlasting the last one
  flags. When a turn ends the time rules settle what it used.
- **Scoring is timed like play.** Proposals, acceptances and resumptions are
  steps charged to the seat due to act. After two passes the proposer has one
  turn to propose or resume, and after a proposal the other seat has one turn
  to accept or resume. A proposer that resumes stays due, so its resume and next
  stone share one turn. A responder's resume hands a fresh turn to the
  proposer. Only the game's first scoring round can be resumed; after that,
  two passes end it (see above), so only a seat that does nothing loses on
  time. On the per-turn timer a proposal must be marked
  within 60 s; under byo-yomi it can also draw on main time. The pre-referee
  contract ran scoring on a separate fixed window whose expiry resumed play
  rather than ending the game ([reference](ONCHAIN_REFERENCE.md#time-controls)).
- **Settlement.** A flag is a finished history like any other: the winner, or
  anyone, submits it or proves it and it settles after the dispute window (the
  flagged seat will not co-sign it). The flag records its stamp and leaves the
  clocks as they were. Replay verifies each seat's final signature and the
  referee's final attestation. That attestation covers every stamp, because the
  clocks it signs depend on all of them. A timed batch costs one felt per step
  and one extra ECDSA check.
- **Starts and pauses.** The referee's `Start` step starts a clock before the
  first move; the keeper sends one after a grace period if no move came first.
  Forced onchain steps carry no stamp and pause the clock, and nothing is
  charged for the forced period when offchain play resumes.
- **Disputes can't stop the clock.** A live referee acknowledges a dispute
  (`acknowledge`), and resolving it then returns the game to offchain play,
  where the clock keeps running. A ranked game reaches forced play only while
  its referee is down, and the referee can return it from there on its own
  (`resume_by_referee`).
- **Trust.** The referee cannot forge, reorder or settle moves. It can skew time
  or delay steps, so an honest seat's worst case is losing on time. It never
  stamps two steps at one sequence number, and two attestations of different
  transcripts at one sequence number are evidence of equivocation. Use a
  referee key kept apart from the keeper's account key.

## Settlement and checkpoints

An immutable Cairo 2.18 adapter uses native SNIP-36 proof facts, reads the Dojo
channel's current anchor and replays signed actions. Its output binds the current
epoch, input state and computed output state. The Cairo 2.13 Dojo channel accepts
that callback only from the game's prover, whose class the namespace owner has
allowlisted.
The adapter has no administrator, upgrade function or arbitrary-call entrypoint.

A valid proof plus **both players' signatures over the resulting checkpoint**
commits it immediately. A finished checkpoint records the result; an unfinished
one supports proof batching without closing the game. Every committed checkpoint
increments the epoch. Older proofs and checkpoint approvals cannot be replayed.
Move signatures remain valid across checkpoints because they bind game terms and
the previous state, not an incidental proving epoch.

## Disputes and timeouts

1. A participant can open a dispute from the current committed anchor without a
   prover. This starts a fixed response window chosen when the game was created
   (5 minutes–7 days; SDK default 1 hour). Everyone can observe the deadline.
2. During this window, either side can supply a proof of a newer signed history
   from that **same frozen anchor**. Candidates are ordered first by authenticated
   signer changes (`support_turn`), then by action sequence. Consecutive self-signed
   actions (for example resume-then-play) cannot outrank an opponent-acknowledged
   branch merely by increasing its action count. A co-signed checkpoint may replace
   an unacknowledged tail at the same support level, but not a more-supported state.
   Direct Cairo replay is also available, subject to transaction resource limits.
   A candidate does not advance the anchor or extend the dispute deadline.
3. After the window, the candidate becomes the anchor. A terminal state settles.
   A ranked game whose referee acknowledged the dispute returns to offchain
   play. Otherwise the game enters forced onchain play with a **fresh** response
   window. Resolving a dispute never awards an immediate timeout against a newly
   selected state. This prevents a last-second candidate from stealing the next
   turn. A candidate may also be extended rather than replaced: a submission can
   start from it, so a transcript longer than one proof arrives in segments
   within one window.
4. In forced play, the wallet due to act submits its legal steps (up to the next
   change of due seat) before the deadline. The contract checks the anchor state
   and its position-history witness, applies Go rules, updates the anchor and
   starts the next response window. Failure to act
   permits the opponent to claim a timeout, which ends the game by abandonment
   (reason 130: the chain judged it, not a referee). Either wallet can resign.
5. Both players can sign the current epoch/state to return to offchain play, and
   in a ranked game its referee can alone.

Keeping the dispute anchor frozen is essential: immediately accepting an
unacknowledged prefix would let a player publish an alternate last move and strand
an opponent's newer transcript on another branch. Players must retain their data
and monitor/respond during disputes. A malicious player can force onchain costs.
These windows establish liveness, not measurements of thinking time; in a ranked
game thinking time is the referee's clock ([Ranked clocks](#ranked-clocks)).
Transactions are needed to resolve disputes and claim expired turns.

## Final-signature authentication

Adopted 2026-09-24 (`channel_protocol::replay`). It removes about 83% of a
proof's trace ([measurements](PROVING_PLAN.md#measurements-kgs-311-action-game)).

**Rule.** A replay from a committed anchor verifies exactly one signature per
player: the one on that player's last action in the batch. A player with no
action in the batch needs none. Signatures on earlier actions are not checked
in Cairo. Signed messages, state hashes and the SDK's offchain checks are
unchanged.

**Why it suffices.** Let the batch be actions `a_1…a_n`, applied from the
committed anchor `S_0`. For each action:
- `m_i = action_hash(context, S_{i-1}, a_i)`;
- `S_i.transcript_hash = H(S_{i-1}.transcript_hash, m_i)`;
- `state_hash(S)` covers every field of `S`, including `transcript_hash` and
  `sequence`.

So `m_j` commits, through Poseidon collision resistance, to the exact sequence
`a_1…a_j` applied from `S_0`, and hence to every earlier action. Say player P's
last action in the batch is `a_j`, and P's signature on `m_j` verifies:
- P signed a message committing to all of `a_1…a_{j-1}`, including P's own
  earlier actions;
- P has no action after `a_j`;
- the other player's actions after `a_j` are covered by that player's final
  signature in the same way.

Every action is therefore endorsed by its actor, as long as honest clients hold
this invariant:

> A client signs `m_j` only from a state it computed itself, by applying its
> own actions and opponent actions whose signatures it verified.

Under that invariant, a history containing a P action that P never authored
cannot carry a valid later P signature. Signatures are not part of any hash
(`m_i` excludes them), so unverified signature fields cannot change the proved
state. The replay's output is exactly the state that full verification
produces on any history both players really signed.

**Unchanged:**
- dispute ranking: `support_turn` counts signer changes between authenticated
  actions, and every action is still authenticated;
- checkpoint and reopen approvals (`both_approve`);
- the frozen dispute anchor;
- forced onchain actions, which authenticate the wallet caller.

**Requirements:**
- The SDK keeps verifying every received signature (`receive`, `import`), and
  never signs from an unverified state.
- The same rule applies to the Dojo `submit_history` replay, so direct and
  proved replays accept the same inputs.
- A batch whose final signature fails is rejected as a whole.

**Notes:**
- Restoring a transcript from backup must go through `import`, which verifies
  every signature. Never sign from an unverified transcript.
- The JS SDK is stricter than Cairo: it verifies every signature it receives
  and keeps them all in the transcript.
- Since referee protocol v2, calldata carries only the final signatures
  (`batchOf(session.steps)` in the SDK client), with a zero signature for a
  player with no action in the batch. Cairo rejects a nonzero signature for
  such a player.
- Since v3 the referee of a ranked game is authenticated the same way: one
  attestation, its last, reaches calldata, and `Flag` steps need no seat
  signature.

## Implementation boundaries

The transport/relay does not decide legality or scores. In a ranked game the
keeper named in the terms also keeps time: its stamps and flags decide a clock
timeout, within the limits under [Ranked clocks](#ranked-clocks). The SDK
verifies received actions (and, in a ranked game, each attestation) locally;
casual sessions/transcripts can be exchanged by any transport. Session private keys belong to each player and never enter a prover
request. Provers see public game transcripts and signatures, not signing secrets.
This is not a token privacy integration. A transcript commitment is not a data
availability service, and proof verification does not prevent collusive ranked
results, deliberate losses or Sybil accounts.

[Native SNIP-36](https://community.starknet.io/t/snip-36-in-protocol-proof-verification/116123) currently authenticates proofs in Starknet consensus; its first
phase does not prove that verification through SNOS to Ethereum. Dojo world owners
also retain upgrade/administrative powers unless those powers are frozen or
explicitly governed. Those are deployment trust assumptions, not changes a game
proof can remove.
