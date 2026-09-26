# Surround offchain protocol v2

Decision: 2026-09-07. Normal play is offchain; ranked results settle on Starknet.
No blitz clock or server-authoritative timestamps. The channel, SDK, native adapter
and local proving executable implement this protocol.

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
   Otherwise the game enters forced onchain play with a **fresh** response window.
   Resolving a dispute never awards an immediate timeout against a newly selected
   state. This prevents a last-second candidate from stealing the next turn.
4. In forced play, the wallet due to act submits its legal steps (up to the next
   change of due seat) before the deadline. The contract checks the anchor state
   and its position-history witness, applies Go rules, updates the anchor and
   starts the next response window. Failure to act
   permits the opponent to claim a timeout. Either wallet can resign.
5. Both players can sign the current epoch/state to return to offchain play.

Keeping the dispute anchor frozen is essential: immediately accepting an
unacknowledged prefix would let a player publish an alternate last move and strand
an opponent's newer transcript on another branch. Players must retain their data
and monitor/respond during disputes. A malicious player can force onchain costs.
These windows establish liveness, not historical measurements of private thinking
time. Transactions are needed to resolve disputes and claim expired turns.

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

## Implementation boundaries

The transport/relay does not decide legality, scores or timeout outcomes. The SDK
verifies received actions locally; sessions/transcripts can be exchanged by any
transport. Session private keys belong to each player and never enter a prover
request. Provers see public game transcripts and signatures, not signing secrets.
This is not a token privacy integration. A transcript commitment is not a data
availability service, and proof verification does not prevent collusive ranked
results, deliberate losses or Sybil accounts.

[Native SNIP-36](https://community.starknet.io/t/snip-36-in-protocol-proof-verification/116123) currently authenticates proofs in Starknet consensus; its first
phase does not prove that verification through SNOS to Ethereum. Dojo world owners
also retain upgrade/administrative powers unless those powers are frozen or
explicitly governed. Those are deployment trust assumptions, not changes a game
proof can remove.
