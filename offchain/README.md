# Offchain Surround

The default match system is `surround-channel`. Create/join transactions register
both wallets and their independent Stark-curve session public keys. Normal moves
are signed and exchanged offchain. A Stwo proof checks the transcript and score;
a settlement transaction records the result in Dojo.

## Client flow

The SDK is transport-independent JavaScript. It implements signing, local Go
rules, transcript verification, checkpoint hashes and transaction builders.
Wallets send the returned call objects through their normal Starknet account.
Session private keys must be player-owned and stored securely by the application;
never send them to the relay, prover, logs or analytics.

```js
import { Session, action, PLAY, json } from './sdk/src/index.mjs';
import { getSnapshot, proveSession } from './sdk/src/client.mjs';

// The wallets have already registered their session public keys onchain.
const snapshot = await getSnapshot(provider, channelAddress, gameId);
const game = new Session(snapshot.terms, snapshot.state, retainedPositionHistory);

// Only the player whose turn it is signs this action.
const signedMove = game.move(
  action(PLAY, game.state.next_player, row * game.terms.size + column),
  mySessionPrivateKey,
);
await transport.send(json(signedMove));

// The opponent's client checks authentication and legality before updating.
otherClient.receive(JSON.parse(await transport.receive()));

// Persist game.export() and the position history after every accepted action.
// Before proving, obtain both players' checkpoint signatures over this exact
// epoch and final state. Each player produces its own signature locally.
const myApproval = game.checkpointSignature(snapshot.epoch, mySessionPrivateKey);

const proved = await proveSession({
  rpcUrl,
  proverUrl,
  session: game,
  epoch: snapshot.epoch,
  expectedClassHash: pinnedAdapterClassHash,
});
const call = proved.call(blackApproval, whiteApproval);
const estimate = await wallet.estimateInvokeFee(call, proved.options);
await wallet.execute(call, {
  ...proved.options,
  resourceBounds: estimate.resourceBounds,
});
```

The first snapshot starts with the empty-board history; omit the third `Session`
argument only for that initial state. After a checkpoint or forced move, construct
a new session from the committed snapshot and the **complete** position history.
The history commitment prevents deleting an earlier ko position. A transcript
import checks its signatures and transitions; compare its terms and starting
state with `getSnapshot` before trusting it as the current onchain game.

`PROPOSE` contains a complete dead-stone bitset. `markGroup` lets a client build it
by selecting groups. After two passes, the player due to act proposes or resumes.
After a proposal, the opponent accepts or resumes. Acceptance computes the exact
area score. Moves are signed against the full previous state and game terms;
checkpoint/reopen signatures additionally bind the onchain epoch.

There is no relay service, frontend, matchmaking or Elo calculation here yet.
A relay may assist delivery and notifications, but cannot fabricate player moves,
approvals or timeout outcomes. Clients must retain data and watch disputes.

## Contract API

| Entry point | Use |
| --- | --- |
| `create_channel` / `join_channel` | Register wallets, session keys, rules and immutable adapter. |
| `get_channel` / `get_snapshot` | Read lifecycle state or the terms and committed proving anchor. |
| adapter `settle` | Verify native proof facts and forward the exact proved transition. |
| `submit_history` | Execute the same signed replay directly when practical. |
| `open_dispute` | Start a public response window without needing a prover. |
| `resolve_dispute` | Promote the best authenticated candidate after that fixed window. |
| `force_action` | Wallet-authenticated action with a full position-history witness. |
| `claim_timeout` | Opponent claims after the forced player's public deadline. |
| `resume_channel` | Both players approve a return to normal offchain play. |
| `resign_channel` | Wallet concedes without a proof or counterparty signature. |
| `cancel_channel` | Creator cancels before anyone joins. |

Only the pinned adapter can call `accept_verified`. Supplying proof-looking
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
python3 offchain/prepare.py --check
(cd offchain/cairo && scarb build && snforge test)
node offchain/pin.mjs
scarb fmt
sozo build
sozo test
npm test --prefix offchain/sdk
python3 offchain/local.py
python3 offchain/prove.py
```

`prepare.py` copies the root rules/protocol with only Dojo derives removed. Run it
without `--check` after changing the source, then rebuild the adapter and repin
its class. A pin change needs a new deployment version. Existing channel terms
must not silently change. Test fixtures use explicitly public keys 1 and 2; these
keys are unsuitable for any real match.

`local.py` starts its own loopback-only **Devnet 0.8.0** on port 6081, migrates the
actual Dojo world and runs two-wallet integration checks. An occupied port is
rejected. The node is stopped afterward. It exercises direct replay and rejects
missing native facts; it does not simulate a successful native proof. Sozo 1.8.6
needs an RPC version adapter because its version gate expects 0.9. All execution
requests pass through unchanged to the node's actual RPC 0.10.2 implementation.

`prove.py` proves all six recorded games with the Cairo bootloader and Stwo.
Pass fixture IDs to select a subset, for example:

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
the network and existing test signer, builds/migrates the channel resources, deploys the
immutable adapter, and proves/settles recorded games. It reads the already
configured `stakewars_sepolia_deployer` account in the owner-only local Starknet
accounts file. Never put the funded private key in the repository.

```sh
(cd offchain/testing && scarb build)
node offchain/sepolia.mjs preflight
node offchain/sepolia.mjs deploy
node offchain/sepolia.mjs run cgos_9_1682833
node offchain/sepolia.mjs batch kgs_2019_04_10_39 64
```

The Sepolia profile skips the retained per-move onchain system and its models.
The public prover accepted a full 9×9 transcript but rejected the full 19×19
transcript and a 128-action prefix with `Not enough twiddles!`. The checkpoint
runner uses smaller batches for that service. All moves are played offchain
before settlement; each proved checkpoint adds an onchain transaction and fee.
This is a measured hosted-prover limitation, not a protocol limit on Go moves.
Full 19×19 proofs already verify locally with the Cairo bootloader. Production
needs a native prover able to handle the full trace to avoid these extra fees.

The test runner controls both seats using distinct public session keys and a tiny
owner-only test-player contract. This avoids funding another wallet; it is not a
production player/account design. The test-player contract is outside the pinned
proof adapter and holds no funds. The runner caps ordinary transactions at 40 test STRK and large declarations at
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
