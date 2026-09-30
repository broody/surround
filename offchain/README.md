# Offchain Surround

The default match system is `surround-channel`. Create/join transactions register
both wallets and their independent Stark-curve session public keys. Normal moves
are signed and exchanged offchain. A Stwo proof checks the transcript and score;
a settlement transaction records the result in Dojo.

## Client flow

The SDK is transport-independent JavaScript. Go's codec and rules live in
`sdk/src/index.mjs`; signing, transcripts, sessions and channel codecs come from
[`@referee/sdk`](https://github.com/broody/referee) and are re-exported. The SDK
and the Cairo crates pin referee `262873e` (protocol v5).
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

**Ranked games** are timed by referee's clocks, scoring included, and stamped
by the keeper named in the terms
([protocol](../OFFCHAIN_PROTOCOL.md#ranked-clocks)). They run on Surround's
per-turn timer (`rankedClock`, 60 s per turn) or on Japanese byo-yomi
(`byoyomiClock`: main time, then periods). Create them with that keeper's
referee key. A step is signed and marked but applied only once the keeper has
stamped it:

```js
import { goStep, rankedClock, byoyomiClock, timeLeft, PLAY, go } from './sdk/src/index.mjs';
import { KeeperClient, SessionStore, createChannelCall, getSnapshot, indexedDbBackend, keeperReferee } from './sdk/src/client.mjs';

const referee = await keeperReferee(keeperUrl);
const clock = rankedClock(referee);   // { referee, settings: { turn_ms: 60000, bank_ms: 0, increment_ms: 0, byoyomi: null } }
// or byoyomiClock(referee, { main_ms, periods, period_ms })
await wallet.execute(createChannelCall({ channel, size: 19, komi_half: 13, session_key, prover, clock }));
// ... the other wallet joins ...
const { terms } = await getSnapshot(provider, channel, gameId);
const store = new SessionStore(indexedDbBackend());
const game = await store.open(go, terms);
const keeper = new KeeperClient(keeperUrl);
await keeper.register(game);                                  // once, after joining

await store.move(game, goStep(PLAY, point), mySessionPrivateKey); // signed and marked, waits in game.pending
await keeper.submit(game, { store });                         // every pending step, stamped by the keeper and pulled back
await keeper.follow(game, { store, signal, onSteps });        // the opponent's stamped steps as a stream (or pull)
timeLeft(go, terms, game.env, refereeNow);                    // per seat { turn, bank, periods, period }
```

`game.move` throws in a ranked game. Every step's signature and the keeper's
attestation are verified before it applies. A step signed but not yet stamped
survives a restart: `store.load` puts it back in `pending` to resend. If the
opponent's time runs out, the keeper appends its `flag` and the game is
finished with `REASON_TIMEOUT`; settle it like any finished game. Settlement
calldata carries the stamps and only the keeper's last attestation.

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

`src/rating.mjs` is Surround's rating update, integer for integer what
`SurroundRatings` computes ([plan](../RANKING_PLAN.md)); `ratings/` is its
backtest on OGS's games, and [`matchmaker/`](matchmaker/README.md) pairs players
for rated games, signs their tickets and rates settled games. Relaying is
referee's [keeper](https://github.com/broody/referee/blob/262873e/keeper/README.md),
run separately. A keeper cannot fabricate player moves or approvals. The keeper
named in a ranked game's terms also keeps its time, so it decides a clock
timeout (never a move or a score). Clients must retain data and watch disputes.

## Contract API

| Entry point | Use |
| --- | --- |
| `create_channel` / `join_channel` | Register wallets, session keys, board, komi, adapter and, for a ranked game, the time control (`clock`, `None` when untimed). |
| `create_rated_channel` | Black creates a rated game from a matchmaker-signed ticket, which fixes the opponent, board, komi, clock, prover and response window; `SurroundRatings` accepts each ticket once, before it expires. White must join by then (`createRatedChannelCall`, `ticketDigest`, `signTicket`). |
| `rated_game` / `ratings` / `set_ratings` | A rated game's ticket details and join time; the `SurroundRatings` contract; the namespace owner sets it. |
| `rate` / `sync` | After settlement, anyone reports a rated game to `SurroundRatings` (`rateCall`); the channel mirrors both players' new ratings as `PlayerRank` and `RatingChanged` events for Torii. `sync` re-emits a player's rating, e.g. in a new world. `getPlayerRating` reads the contract. |
| `get_channel` / `terms` / `snapshot` | Read lifecycle state, the game terms, or the terms, epoch, anchor hash and anchor block. |
| adapter `settle` | Verify native proof facts and forward the exact proved transition. |
| `submit_history` | Execute the same replay directly from the anchor: start state, position history and a batch (steps, their stamps in a ranked game, each player's final signature and the referee's last attestation) as calldata. |
| `open_dispute` | Start a public response window without needing a prover. |
| `resolve_dispute` | Promote the best authenticated candidate after that fixed window. |
| `force_steps` | The due wallet's steps, up to the next change of due seat, with the anchor state and position history. Unstamped: a ranked game's clock pauses. |
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
node offchain/latency.mjs    # ranked-step latency without a network (--store file); compare with results/latency*.json
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
and allowlists the immutable adapter and `SurroundRatings`, and proves/settles
recorded games. Results go to `results/sepolia-v5.json` (the referee v5 world);
`results/sepolia-ratings-v2.json` keeps the v4 world's runs,
`results/sepolia-ratings.json` the first ratings world's,
`results/sepolia-kifu.json` the Kifu world's and
`results/sepolia-referee-v3.json` the first referee protocol v3 world's;
`results/sepolia-referee{,-v2}.json` and `results/sepolia.json` keep the protocol
v1/v2 and pre-referee deployments' records. It reads a funded
`alpha-sepolia` account from the owner-only local Starknet accounts file
(`SURROUND_SEPOLIA_ACCOUNT`, default `account-1`) and checks its key against the
deployed account. Never put the funded private key in the repository.

```sh
(cd offchain/testing && scarb build)
node offchain/sepolia.mjs preflight
SURROUND_SEPOLIA_RPC=https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10 node offchain/sepolia.mjs deploy
node offchain/sepolia.mjs run cgos_9_1682833
SURROUND_KEEPER_URL=http://127.0.0.1:3200 node offchain/sepolia.mjs ranked cgos_9_1682833
node offchain/sepolia.mjs rated cgos_9_1682833 cgos_9_1682827
node offchain/sepolia.mjs run kgs_2019_04_10_39
```

The channel class exceeds publicnode's request size, so `deploy`
goes through another RPC node. `SURROUND_SEPOLIA_PROVER` selects the prover
(default: StarkWare's hosted one, which the v4 and v5 runs used); the v3 runs
used referee's self-hosted prover
([`prover/`](https://github.com/broody/referee/tree/262873e/prover)) at
`http://127.0.0.1:3100`, allowlisting the new adapter class. `rated` signs a
pairing ticket with a per-world test matchmaker key, referees the game in process
with a test referee key (both kept in the git-ignored `results/raw/`), settles it
by replay, rates it and checks the ratings against the SDK. `ranked` plays the
game through the keeper at `SURROUND_KEEPER_URL`, which must referee: referee's
`keeper/server.mjs` at `262873e`, started with `KEEPER_REFEREE_KEY` and a
`games` entry for the channel (`module`: this SDK's `src/index.mjs`, `export`:
`go`, `entrypoints`: `{ "resolve": "resolve_dispute" }`). Both seats sign with
`store.move`, the keeper stamps each step, and both seats pull. A ranked game
cannot be resumed mid-play: its clock keeps running.

**One proof per game.** `run` settles a whole game with one native proof,
19×19 games included: the 311-step KGS game took one `PROOF1` from the hosted
prover (7.0 s, 87.0M L2 gas, 1.78 test STRK). A proof costs about the same
whatever its length, so splitting a game only multiplies the fee: the same game
in five checkpoint proofs cost 427M L2 gas and 8.67 test STRK.
`batch NAME STEPS` does that split on purpose, to exercise chained checkpoints;
it takes an explicit step count, records under `NAME_batch`, and is not part of
a normal validation run. The hosted prover used to reject transcripts above
about 64–128 actions (`Not enough twiddles!`), which is where the split came
from; final-signature authentication and compact steps moved that limit well
past this game (referee's prover has proved 529 steps in one `PROOF1`). A game
too long for `PROOF1` still needs checkpoints or `PROOF2`.

The test runner controls both seats using distinct public session keys and a tiny
owner-only test-player contract. This avoids funding another wallet; it is not a
production player/account design. The test-player contract is outside the proof
adapter and holds no funds. The runner caps ordinary transactions at 40 test STRK and large declarations at
150 test STRK. It uses 15% gas/price margins for declarations and a 50% gas margin for
ordinary invokes to cover account validation. Sozo migration
broadcasts have a 250 test STRK reservation limit, including earlier confirmed
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
