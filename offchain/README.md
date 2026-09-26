# Offchain Surround

The default match system is `surround-channel`. Create/join transactions register
both wallets and their independent Stark-curve session public keys. Normal moves
are signed and exchanged offchain. A Stwo proof checks the transcript and score;
a settlement transaction records the result in Dojo.

## Client flow

The SDK is transport-independent JavaScript. Go's codec and rules live in
`sdk/src/index.mjs`; signing, transcripts, sessions and channel codecs come from
[`@referee/sdk`](https://github.com/broody/referee) and are re-exported.
`sdk/src/client.mjs` holds Surround's channel call builders and binds referee's
native proving client (`@referee/sdk/proving`: `proveSession`,
`validateNativeProof`, `settlementCall`) to Go. Wallets
send the returned call objects through their normal Starknet account. Session
private keys must be player-owned and stored securely by the application; never
send them to the relay, prover, logs or analytics.

```js
import { goSession, goStep, PLAY, json } from './sdk/src/index.mjs';
import { getSnapshot, proveSession } from './sdk/src/client.mjs';

// The wallets have already registered their session public keys onchain.
const { terms, epoch } = await getSnapshot(provider, channelAddress, gameId);
const game = goSession(terms);          // from the opening; see below for later anchors

// A step carries no seat: it belongs to the seat due to act (0 black, 1 white),
// and only that seat's key can sign it.
const signedMove = game.move(goStep(PLAY, row * terms.config.size + column), mySessionPrivateKey);
await transport.send(json(signedMove));

// The opponent's client checks the signature, then legality, before updating.
otherClient.receive(JSON.parse(await transport.receive()));

// Persist json(game.export()) after every accepted step. Before proving, obtain
// both players' checkpoint signatures over this exact epoch and final state;
// each player produces its own signature locally.
const myApproval = game.checkpointSignature(epoch, mySessionPrivateKey);

const proved = await proveSession({ rpcUrl, proverUrl, session: game, epoch,
  expectedClassHash: allowlistedAdapterClassHash });
const call = proved.call([blackApproval, whiteApproval]);
const estimate = await wallet.estimateInvokeFee(call, proved.options);
await wallet.execute(call, { ...proved.options, resourceBounds: estimate.resourceBounds });
```

The channel stores only the hash of its committed anchor. After a checkpoint or
forced move, continue from the committed state with
`goSession(terms, { start, witness })`, where `start` is the anchor envelope and
`witness` its **complete** position history (`previous.witness()`); the channel
checks the start state against its anchor hash and the history against the
state's superko root, so an earlier ko position cannot be deleted.
`importSession(record)` restores an exported transcript, verifying every
signature and transition; compare its terms and start with `getSnapshot` before
trusting it as the current onchain game.

`PROPOSE` contains a complete dead-stone bitset. `markGroup` lets a client build it
by selecting groups. After two passes, the player due to act proposes or resumes.
After a proposal, the opponent accepts or resumes. Acceptance computes the exact
area score. Resignation is referee's `Resign` move (`resignStep(seat)`), the only
step that names its seat. Steps are signed against the game terms, the sequence
number and the running transcript; checkpoint/reopen signatures additionally
bind the onchain epoch. Clients keep every signature, but replay calldata and
proofs carry only each player's final one (`batchOf(session.steps)`).

There is no relay service, frontend, matchmaking or Elo calculation here yet.
A relay may assist delivery and notifications, but cannot fabricate player moves,
approvals or timeout outcomes. Clients must retain data and watch disputes.

## Contract API

| Entry point | Use |
| --- | --- |
| `create_channel` / `join_channel` | Register wallets, session keys, board, komi and adapter. |
| `get_channel` / `terms` / `snapshot` | Read lifecycle state, the game terms, or the terms, epoch, anchor hash and anchor block. |
| adapter `settle` | Verify native proof facts and forward the exact proved transition. |
| `submit_history` | Execute the same replay directly from the anchor: start state, position history, steps and each player's final signature as calldata. |
| `open_dispute` | Start a public response window without needing a prover. |
| `resolve_dispute` | Promote the best authenticated candidate after that fixed window. |
| `force_steps` | The due wallet's steps, up to the next change of due seat, with the anchor state and position history. |
| `claim_timeout` | Opponent claims after the forced player's public deadline. |
| `resume_channel` | Both players approve a return to normal offchain play. |
| `resign_channel` | Wallet concedes without a proof or counterparty signature. |
| `cancel_channel` | Creator cancels before anyone joins. |
| `allow_prover` | Namespace owner allowlists (or revokes) an adapter class. |

Only the game's prover, whose class is allowlisted, can call `accept_verified`. Supplying proof-looking
calldata or calling the adapter without native proof facts cannot authorize a
result. Proof responses are checked by the SDK, but **network acceptance** is what
establishes cryptographic verification for settlement.

For unilateral submissions the anchor remains frozen until the dispute resolves.
Candidate ranking uses authenticated signer changes before action count. A
scoring resumption followed by a move from the same signer cannot inflate its
priority above an opponent-acknowledged branch. Resolution gives the selected next
player a fresh response window. See [the complete protocol](../OFFCHAIN_PROTOCOL.md).

## Build and local verification

Install the versions from the directory `.tool-versions` files. Root Cairo/Dojo
uses 2.13.1/1.8.0; the adapter/executable use Cairo 2.18.0. Foundry tests use 0.63.0.

```sh
npm ci --prefix offchain/sdk
(cd rules && scarb test)
(cd offchain/cairo && scarb build && snforge test)
scarb fmt
sozo build
sozo test
npm test --prefix offchain/sdk
python3 offchain/local.py
python3 offchain/prove.py
```

The Dojo channel, the adapter and the proving executable all depend on the
Dojo-free `rules/` crate, so there are no copied sources to keep in sync. A new
adapter class needs only `allow_prover`; games in progress keep the prover
recorded in their terms. `generate-fixtures.mjs` re-signs the recorded games with
the JS SDK and writes `rules/src/tests/vectors.cairo`, which the rules crate
replays in Cairo. Test fixtures use explicitly public keys 0x1 and 0x2; these
keys are unsuitable for any real match.

`local.py` starts its own loopback-only **Devnet 0.8.0** on port 6081, migrates the
actual Dojo world and runs two-wallet integration checks. An occupied port is
rejected. The node is stopped afterward. It exercises direct replay and rejects
missing native facts; it does not simulate a successful native proof. Sozo 1.8.6
needs an RPC version adapter because its version gate expects 0.9. All execution
requests pass through unchanged to the node's actual RPC 0.10.2 implementation.

`prove.py` proves all six recorded games with the Cairo bootloader and Stwo.
Pass fixture IDs to select a subset, and `--execute-only` to check the Cairo
output against the SDK without proving, for example:

```sh
python3 offchain/prove.py kgs_2019_04_10_39
```

It checks Cairo output against the SDK, verifies the resulting proof, mutates the
public Black score and requires rejection. Raw proofs/logs stay in ignored
`target`/`results/raw` directories; [public measurements](results/local-proofs.json)
include checksums. Full-game proving currently uses roughly 20–35 GiB of memory
on the measured machine, so this is not yet a mobile proving workload.

The Scarb bootloader proof is **not the native virtual-SNOS proof format**. Use
`proveSession` with a native prover for onchain settlement. The provided test
endpoint is StarkWare's Sepolia transaction prover:
`https://transaction-prover.alpha-sepolia.sw-dev.io`. The prover processes a public
signed transcript; it does not receive private keys or decide the result.

## Sepolia validation

`dojo_sepolia.toml` contains public settings only. `offchain/sepolia.mjs` verifies
the network and existing test signer, builds/migrates the channel resources, deploys
and allowlists the immutable adapter, and proves/settles recorded games. Results go
to `results/sepolia-referee.json`; `results/sepolia.json` keeps the earlier,
pre-referee deployment's record. It reads a funded
`alpha-sepolia` account from the owner-only local Starknet accounts file
(`SURROUND_SEPOLIA_ACCOUNT`, default `account-1`) and checks its key against the
deployed account. Never put the funded private key in the repository.

```sh
(cd offchain/testing && scarb build)
node offchain/sepolia.mjs preflight
node offchain/sepolia.mjs deploy
node offchain/sepolia.mjs run cgos_9_1682833
node offchain/sepolia.mjs batch kgs_2019_04_10_39 64
```

The public prover accepted a full 9×9 transcript but rejected the full 19×19
transcript and a 128-action prefix with `Not enough twiddles!`. The checkpoint
runner uses smaller batches for that service. All moves are played offchain
before settlement; each proved checkpoint adds an onchain transaction and fee.
This is a measured hosted-prover limitation, not a protocol limit on Go moves.
Full 19×19 proofs already verify locally with the Cairo bootloader. Production
needs a native prover able to handle the full trace to avoid these extra fees.

The test runner controls both seats using distinct public session keys and a tiny
owner-only test-player contract. This avoids funding another wallet; it is not a
production player/account design. The test-player contract is outside the proof
adapter and holds no funds. The runner caps ordinary transactions at 40 test STRK and large declarations at
80 test STRK. It uses 15% gas/price margins for declarations and a 50% gas margin for
ordinary invokes to cover account validation. Sozo migration
broadcasts have a 120 test STRK reservation limit, including earlier confirmed
declaration fees when resuming.
On resume, confirmed actual fees replace their earlier maximum-fee reservations;
unresolved broadcasts retain their saved hashes. It rejects non-Sepolia endpoints.

Native verification uses [SNIP-36](https://community.starknet.io/t/snip-36-in-protocol-proof-verification/116123).
Its initial verification occurs in Starknet consensus, without proving that
verification through SNOS to Ethereum. The adapter binds chain, class, addresses,
game terms, epoch, input state and output state. The network requires a base at least ten blocks behind the current head; the SDK
waits for a new anchor to become eligible. The adapter requires a proof base no
older than 4,000 blocks and no earlier than the current committed anchor. A stale proof
must be regenerated against a fresh block; it cannot be silently reused after an
onchain epoch change. World owner/admin privileges also require an explicit
production governance or freezing decision.
