# Surround offchain protocol v1

Decision: 2026-09-07. Normal play is offchain; ranked results settle on Starknet.
No blitz clock or server-authoritative timestamps. Existing onchain games remain
the rules regression suite. The channel, SDK, native adapter and local proving executable implement this protocol.

## Authentication and rules

Each wallet registers a Stark-curve session public key when creating/joining a
Dojo channel. Terms bind the chain, channel contract, game ID, both wallets and
keys, immutable proof adapter, size, komi, rule version and response window.
Each action signs those terms, the exact previous state and its canonical action
payload. Sequence numbers, board and transcript hashes prevent replay/fork mixing.
The prover checks every signature and every transition, including positional
superko across passes and scoring disputes. Players retain the complete transcript.

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
that callback only from an adapter whose class hash matches the compiled pin.
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
4. In forced play, the wallet due to act submits a legal action before the deadline.
   The contract checks the committed position-history witness and the original
   Go rules, updates the state and starts the next response window. Failure to act
   permits the opponent to claim a timeout. Either wallet can resign.
5. Both players can sign the current epoch/state to return to offchain play.

Keeping the dispute anchor frozen is essential: immediately accepting an
unacknowledged prefix would let a player publish an alternate last move and strand
an opponent's newer transcript on another branch. Players must retain their data
and monitor/respond during disputes. A malicious player can force onchain costs.
These windows establish liveness, not historical measurements of private thinking
time. Transactions are needed to resolve disputes and claim expired turns.

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
