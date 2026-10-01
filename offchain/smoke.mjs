// Two disposable local wallets against the real Dojo channel on Devnet. No
// native proof acceptance is simulated here: settlement uses direct onchain
// replay, and the adapter is exercised only for its negative checks.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Account, RpcProvider, hash, stark } from './sdk/node_modules/starknet/dist/index.mjs';
import * as p from './sdk/src/index.mjs';
import * as c from './sdk/src/client.mjs';
import * as rating from './sdk/src/rating.mjs';
import { fetchRatingEvents, verifyRatings } from './sdk/src/replay.mjs';
import { starknetChain } from './matchmaker/chain.mjs';
import * as keeperHooks from './matchmaker/keeper-hooks.mjs';
import { Matchmaker } from './matchmaker/matchmaker.mjs';
import { serve } from './matchmaker/server.mjs';
import { memoryStore } from './matchmaker/store.mjs';
import { fakeKeeper, keeperFetch } from './matchmaker/test/fake.mjs';
import assert from 'node:assert/strict';

const url = process.argv[2], parsed = new URL(url);
assert(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname));
assert.equal(BigInt(await c.rpc(url, 'starknet_chainId')), 0x4b4154414e41n);
const provider = new RpcProvider({ nodeUrl: url });
const stored = await c.rpc(url, 'devnet_getPredeployedAccounts', { with_balance: false });
const accounts = stored.slice(0, 2).map(a => new Account({ provider, address: a.address, signer: a.private_key }));
const manifest = JSON.parse(await readFile(new URL('../manifest_dev.json', import.meta.url), 'utf8'));
const channel = BigInt(manifest.contracts.find(x => x.tag === 'surround-channel').address);
const artifact = JSON.parse(await readFile(new URL('./cairo/target/dev/surround_offchain_ChannelProver.contract_class.json', import.meta.url), 'utf8'));
const casm = JSON.parse(await readFile(new URL('./cairo/target/dev/surround_offchain_ChannelProver.compiled_contract_class.json', import.meta.url), 'utf8'));
const bounds = Object.fromEntries(['l1_gas', 'l1_data_gas', 'l2_gas'].map(k => [k, { max_amount: 10_000_000_000n, max_price_per_unit: 1n }]));
const options = { resourceBounds: bounds, tip: 0n };
const report = { network: 'local Devnet 0.8.0', protocol: 'arbiter v6',
  proof_verification: 'No proof fields submitted; direct replay and negative native checks only', transactions: [], checks: [] };

async function receipt(tx) {
  const r = await provider.waitForTransaction(tx.transaction_hash, { retryInterval: 20 });
  assert.equal(r.execution_status, 'SUCCEEDED', p.json(r));
  return r;
}
const invoke = async (player, call, label) => {
  const tx = await accounts[player].execute(call, options), r = await receipt(tx);
  report.transactions.push({ label, hash: tx.transaction_hash, resources: r.execution_resources });
  return r;
};
const expectFailure = async (player, call, reason) => {
  await assert.rejects(accounts[player].estimateInvokeFee(call, { tip: 0n }), e => p.json(e).includes(reason) || String(e).includes(reason));
  report.checks.push(`Rejected ${reason}`);
};
const advance = async time => c.rpc(url, 'devnet_setTime', { time, generate_block: true });
const game = id => c.getChannel(provider, channel, id);

// The adapter: declared, deployed and allowlisted by the namespace owner (the migrating account).
const declared = await accounts[0].declare({ contract: artifact, casm }, options); await receipt(declared);
const deployed = await accounts[0].deployContract({ classHash: declared.class_hash, constructorCalldata: [c.VIRTUAL_OS_PROGRAM] }, options);
await receipt(deployed);
const prover = BigInt(deployed.contract_address);
assert.equal(BigInt(await provider.getClassHashAt(p.hex(prover))), BigInt(hash.computeContractClassHash(artifact)));
await expectFailure(1, c.allowProverCall(channel, declared.class_hash), 'Only namespace owner');
await invoke(0, c.allowProverCall(channel, declared.class_hash), 'allow prover class');
report.prover = p.hex(prover); report.channel = p.hex(channel);

const chainId = 0x4b4154414e41n;
// Explicit public test session keys, fresh for every game (with the wallets
// they make its id); no production keys.
const sessionKeys = new Map(); // game id -> its seats' session private keys
const keysOf = s => sessionKeys.get(p.hex(s.terms.game_id));
let agreed = 0;
const walletSignature = signature => stark.formatSignature(signature).map(BigInt);
// Both wallets sign a game's terms offchain, so nothing reaches the chain
// until the game needs it: then `open` goes first in that transaction.
async function agree(size = 9, komi_half = 13, clock = null) {
  const keys = [0x10000n * BigInt(++agreed) + 1n, 0x10000n * BigInt(agreed) + 2n];
  const terms = p.goTerms({ chain_id: chainId, channel, prover, response_seconds: 300, clock,
    players: accounts.map(a => a.address), keys: keys.map(p.publicKey), size, komi_half });
  sessionKeys.set(p.hex(terms.game_id), keys);
  const signatures = await Promise.all(accounts.map(async a => walletSignature(await a.signMessage(c.goTermsTypedData(terms)))));
  return { id: terms.game_id, terms, signatures, open: c.openGameCall(terms, signatures) };
}
const move = (s, kind, point = p.NO_POINT, dead = 0n) => s.move(p.goStep(kind, point, dead), keysOf(s)[s.due()]);
const acks = (s, epoch) => keysOf(s).map(k => s.checkpointSignature(epoch, k));

// A complete recorded game opens and settles in one transaction, by direct
// onchain replay of every signed step.
const fixture = JSON.parse(await readFile(new URL('./fixtures/cgos_9_1682833.json', import.meta.url), 'utf8'));
const first = await agree(9, 14), session = p.goSession(first.terms);
const opening = p.stateHash(p.go, session.start);
for (const { step } of fixture.steps) move(session, step.action.kind, step.action.point, step.action.dead);
const ok = acks(session, 0);
const settle = c.directHistoryCall(channel, first.id, 0, session.start, session.startWitness, session.steps, ok);
await expectFailure(0, settle, 'Unknown channel');
const forged = first.signatures[1].map((x, i, all) => i === all.length - 1 ? x ^ 1n : x);
await expectFailure(0, [c.openGameCall(first.terms, [first.signatures[0], forged]), settle], 'Invalid wallet signature');
await expectFailure(0, [c.openGameCall(first.terms, [...first.signatures].reverse()), settle], 'Invalid wallet signature');
await expectFailure(0, [c.openGameCall({ ...first.terms, response_seconds: 600 }, first.signatures), settle], 'Invalid wallet signature');
// A game's id is its seats' wallets' and session keys': no other terms open under it.
const elsewhere = { ...first.terms, game_id: first.terms.game_id + 1n };
const both = await Promise.all(accounts.map(async a => walletSignature(await a.signMessage(c.goTermsTypedData(elsewhere)))));
await expectFailure(0, c.openGameCall(elsewhere, both), 'Invalid game id');
await expectFailure(0, [first.open, c.settlementCall(prover, channel, first.id, 0, opening, session.env, ok)], 'Missing proof facts');
await expectFailure(0, [first.open, c.channelCall(channel, 'accept_verified', [first.id, 0, opening,
  ...p.encodeEnvelope(p.go, session.env), ...p.encodeSignatures(ok)])], 'Only prover');
await expectFailure(0, [first.open, c.directHistoryCall(channel, first.id, 0, session.start, session.startWitness, session.steps,
  [ok[0], { ...ok[1], s: ok[1].s ^ 1n }])], 'Invalid session signature');
await invoke(1, [first.open, settle], 'opened and settled by direct replay');
await expectFailure(0, first.open, 'Game already open');
let g = await game(first.id);
assert.equal(g.anchor.hash, session.stateHash()); assert.equal(g.status, 4); assert.equal(g.started, 0);
assert.deepEqual(g.result, { finished: true, winner: p.WHITE, reason: p.AGREEMENT });
assert.deepEqual(await c.getTerms(provider, channel, first.id), first.terms);
report.checks.push(`Opened on both wallets' signatures in the transaction that settled it; a forged, swapped or altered signature refused, an id that isn't the seats', and a second opening`);
report.checks.push(`All ${session.steps.length} recorded steps, signatures and W+2 result matched in the actual Dojo contract`);

// A cooperative checkpoint, then offchain play continues from the new anchor.
const checkpoint = await agree(), part = p.goSession(checkpoint.terms);
move(part, p.PLAY, 40); move(part, p.PLAY, 41);
await invoke(0, [checkpoint.open, c.directHistoryCall(channel, checkpoint.id, 0, part.start, part.startWitness, part.steps, acks(part, 0))], 'cooperative checkpoint');
const anchored = await c.getSnapshot(provider, channel, checkpoint.id);
assert.equal(anchored.epoch, 1); assert.equal(anchored.anchor_hash, part.stateHash());
const tail = p.goSession(checkpoint.terms, { start: part.env, witness: part.witness() });
move(tail, p.PASS); move(tail, p.PASS); move(tail, p.PROPOSE); move(tail, p.ACCEPT);
await expectFailure(0, c.directHistoryCall(channel, checkpoint.id, 0, tail.start, tail.startWitness, tail.steps), 'Stale channel epoch');
await invoke(1, c.directHistoryCall(channel, checkpoint.id, 1, tail.start, tail.startWitness, tail.steps, acks(tail, 1)), 'checkpoint continuation settled');
assert.equal((await game(checkpoint.id)).status, 4);

// Freeze an anchor, submit newer candidates without moving it, resolve to a
// fresh response window, force a legal move, then resume offchain.
const dispute = await agree(), prefix = p.goSession(dispute.terms);
move(prefix, p.PLAY, 40); move(prefix, p.PLAY, 41);
await invoke(1, [dispute.open, c.disputeCall(channel, dispute.id, 0)], 'opened in dispute');
const deadline = (await game(dispute.id)).deadline;
await invoke(0, c.directHistoryCall(channel, dispute.id, 0, prefix.start, prefix.startWitness, prefix.steps), 'candidate 2');
move(prefix, p.PLAY, 30); move(prefix, p.PLAY, 31);
await invoke(1, c.directHistoryCall(channel, dispute.id, 0, prefix.start, prefix.startWitness, prefix.steps), 'candidate 4');
let pending = await game(dispute.id);
assert.equal(pending.deadline, deadline); assert.equal(pending.anchor.seq, 0); assert.equal(pending.candidate.seq, 4);
await advance(deadline); await invoke(0, c.resolveCall(channel, dispute.id, 0), 'resolve to forced play');
let forced = await game(dispute.id);
assert.equal(forced.epoch, 1); assert(forced.deadline > deadline); assert.equal(forced.anchor.hash, prefix.stateHash());
await expectFailure(1, c.timeoutCall(channel, dispute.id, 1), 'Turn window open');
const anchorEnv = prefix.env, anchorWitness = prefix.witness();
move(prefix, p.PLAY, 20); // black's forced move, applied locally the same way
await expectFailure(1, c.forceStepsCall(channel, dispute.id, 1, anchorEnv, anchorWitness, [p.goStep(p.PLAY, 20)]), 'Not your step');
await invoke(0, c.forceStepsCall(channel, dispute.id, 1, anchorEnv, anchorWitness, [p.goStep(p.PLAY, 20)]), 'forced move');
forced = await game(dispute.id);
assert.equal(forced.anchor.hash, prefix.stateHash()); assert.equal(forced.anchor.due, 1);
const reopen = keysOf(prefix).map(k => prefix.reopenSignature(forced.epoch, forced.anchor.hash, k));
await invoke(0, c.resumeCall(channel, dispute.id, forced.epoch, reopen), 'mutual return to offchain play');
assert.equal((await game(dispute.id)).status, 1);
report.checks.push('Frozen dispute anchor, newer candidates, fresh deadline, forced move and mutual offchain resumption verified');

// Only the onchain response deadline determines a timeout.
const timed = await agree(); await invoke(1, [timed.open, c.disputeCall(channel, timed.id, 0)], 'timeout dispute');
await advance((await game(timed.id)).deadline); await invoke(1, c.resolveCall(channel, timed.id, 0), 'timeout forced phase');
await advance((await game(timed.id)).deadline); await invoke(1, c.timeoutCall(channel, timed.id, 1), 'timeout claimed');
g = await game(timed.id);
assert.deepEqual(g.result, { finished: true, winner: p.WHITE, reason: p.REASON_ABANDON });
report.checks.push('Only the onchain response deadline determines abandonment');

// Either wallet can concede without a prover: the resignation opens the game too.
const conceded = await agree(); await invoke(0, [conceded.open, c.resignCall(channel, conceded.id)], 'wallet resignation');
assert.deepEqual((await game(conceded.id)).result, { finished: true, winner: p.WHITE, reason: p.REASON_RESIGN });

// A ranked game: 60 s per turn, every step stamped by a referee (public test
// key 0x3, standing in for a keeper). Black lets its turn run out, the referee
// flags it, and white's unilateral submission opens the game and settles it as
// a timeout. The game started at the referee's first stamp.
const refereeKey = 0x3n;
const ranked = await agree(9, 13, p.rankedClock(p.publicKey(refereeKey)));
const refereed = p.goSession(ranked.terms), referee = new p.Referee(refereed, refereeKey, { now: 1_000_000 });
const stamp = (kind, point, at) => referee.stamp(refereed.sign(p.goStep(kind, point), keysOf(refereed)[refereed.due()]), at);
stamp(p.PLAY, 40, 1_000_000); stamp(p.PLAY, 41, 1_030_000);
assert.equal(referee.flag(1_090_000), null);
assert(referee.flag(1_090_001));
await expectFailure(1, [ranked.open, c.directHistoryCall(channel, ranked.id, 0, refereed.start, refereed.startWitness,
  refereed.steps.map(r => ({ ...r, stamp: r.stamp - 1 })))], 'Invalid session signature');
await invoke(1, [ranked.open, c.directHistoryCall(channel, ranked.id, 0, refereed.start, refereed.startWitness, refereed.steps)], 'flagged ranked game submitted');
assert.deepEqual((await game(ranked.id)).clock, p.rankedClock(p.publicKey(refereeKey)));
await advance((await game(ranked.id)).deadline); await invoke(1, c.resolveCall(channel, ranked.id, 0), 'flag settled');
g = await game(ranked.id);
assert.deepEqual(g.result, { finished: true, winner: p.WHITE, reason: p.REASON_TIMEOUT });
assert.equal(g.anchor.hash, refereed.stateHash()); assert.equal(g.started, 1000);
report.checks.push('Ranked game: referee stamps and attestation replayed onchain; the flag settled as a timeout; started at the first stamp');

// Rated games. SurroundRatings (the plain contract that keeps ratings across
// worlds) checks the matchmaker's ticket (public test key 0x4) once, when the
// game opens; each game is refereed (0x3) and rated with its ticket:
// - a whole game settled by replay updates both players exactly as the SDK's
//   integer update predicts, dated by its referee's first stamp;
// - black opening the game and resigning onchain at once still loses: a short
//   onchain forfeit changes only the loser's rating, dated by its ticket;
// - a game resigned offchain after one move is too short to rate: it is void,
//   and the matchmaker counts an abort against whoever quit.
// Replaying every rating event from the contract then checks them all.
const ratingsArtifact = name => readFile(new URL(`../target/dev/surround_SurroundRatings.${name}.json`, import.meta.url), 'utf8').then(JSON.parse);
const ratingsDeclared = await accounts[0].declare({ contract: await ratingsArtifact('contract_class'), casm: await ratingsArtifact('compiled_contract_class') }, options);
await receipt(ratingsDeclared);
const ratingsDeployed = await accounts[0].deployContract({ classHash: ratingsDeclared.class_hash, constructorCalldata: [accounts[0].address] }, options);
await receipt(ratingsDeployed);
const ratings = BigInt(ratingsDeployed.contract_address), matchmakerKey = 0x4n;
const clock = p.rankedClock(p.publicKey(refereeKey));
// New players start at 23k, 17k or 6k (the default `start_bands`); the owner
// seals the policy once it is set up.
await invoke(0, [
  c.channelCall(ratings, 'set_channel', [channel, 1]),
  c.channelCall(ratings, 'set_matchmaker', [p.publicKey(matchmakerKey)]),
  c.channelCall(ratings, 'set_referee', [p.publicKey(refereeKey)]),
  // A preset is the settings alone: a time control without its referee and randomness tip.
  c.channelCall(ratings, 'set_clock_preset', [...p.encodeTimeControl(p.go, clock).slice(1, -1), 1]),
  c.channelCall(ratings, 'set_prover', [prover, 1]),
  c.channelCall(ratings, 'set_board', [9, 14, 1]),
  c.channelCall(ratings, 'set_response_window', [300, 3600]),
  c.channelCall(ratings, 'seal'),
], 'ratings policy, sealed');
await expectFailure(0, c.channelCall(ratings, 'set_start_bands', [0b11110]), 'Not queued');
await expectFailure(1, c.channelCall(channel, 'set_ratings', [ratings]), 'Only namespace owner');
await invoke(0, c.channelCall(channel, 'set_ratings', [ratings]), 'set ratings');
await expectFailure(0, c.channelCall(channel, 'set_ratings', [ratings]), 'Ratings already set');
report.checks.push('SurroundRatings sealed after setup: loosening needs the timelock; the channel takes its ratings contract once');
// The matchmaker pairs the two wallets: each signs a queue request with a
// fresh session key (SNIP-12, checked through its account contract), and it
// signs their ticket, builds the game's terms from it and picks a keeper. Both
// wallets sign the terms, and the matchmaker registers the game with that
// keeper. The keeper here is the matchmaker tests' stand-in for arbiter's: it
// holds the game and stamps each step with the referee test key. Surround's
// keeper hook (`openCall`) builds the opening from what the matchmaker
// registered, and it goes first in the settlement. The matchmaker frees the
// players once the keeper's copy is finished, finds each game in
// SurroundRatings' TicketUsed events and rates it once it settles. Any rank
// gap is allowed here, so the two wallets can play three games.
const keeper = fakeKeeper({ url: 'http://keeper.local', refereeKey });
const matchmaker = await Matchmaker.open({ chain_id: chainId, channel, prover, matchmakerKey, clocks: { turn: clock.settings },
  boards: { 9: 14 }, keepers: [{ url: keeper.url, referee: keeper.referee }], response_seconds: 300, ticket_seconds: 240,
  from_block: await provider.getBlockNumber(), rules: { gap_tenths: 390, max_gap_tenths: 390, max_repeats: 3 } },
  starknetChain({ rpc_url: url, channel, ratings, account: { address: accounts[1].address, privateKey: stored[1].private_key } }),
  { store: memoryStore({}), fetch: keeperFetch([keeper]) });
const service = await serve(matchmaker, { poll_ms: 0 });
const post = async (path, body) => (await fetch(`${service.url}${path}`, { method: 'POST', body: JSON.stringify(body) })).json();
const status = async i => (await fetch(`${service.url}/queue/${p.hex(accounts[i].address)}`)).json();
let nonce = BigInt(Date.now()) << 16n;
async function queue(i, key) {
  const fields = { player: accounts[i].address, key: p.hex(key), size: 9, clock: 'turn', band: 2, at: Math.floor(Date.now() / 1000), nonce: p.hex(++nonce) };
  const signature = await accounts[i].signMessage(c.matchmakerRequest({ chainId, action: 'queue', ...fields }));
  return post('/queue', { ...fields, signature: stark.formatSignature(signature) });
}
let games = 0;
/**
 * Pair the wallets with fresh session keys, check the terms each is sent, and
 * sign them: the game its keeper then holds, and how to open it.
 */
async function ratedPair(label) {
  const sessionKeys = [0x100n * BigInt(++games) + 1n, 0x100n * BigInt(games) + 2n];
  assert.equal((await queue(0, p.publicKey(sessionKeys[0]))).status, 'waiting');
  await queue(1, p.publicKey(sessionKeys[1]));
  const paired = await Promise.all([0, 1].map(status));
  assert(paired.every(s => s.status === 'paired' && s.digest === paired[0].digest && !s.ready));
  const black = paired[0].color === 'black' ? 0 : 1, seats = [black, 1 - black];
  const ticket = c.reviveTicket(paired[0].ticket), terms = p.goTerms({ ...paired[0].terms, ...paired[0].terms.config });
  // What each wallet signs: the ticket's terms, its own session key at its seat.
  const keys = seats.map(i => sessionKeys[i]);
  assert.deepEqual(terms, c.ratedTerms(ticket, keys.map(p.publicKey)));
  assert.equal(terms.clock.referee, keeper.referee);
  for (const i of seats) {
    const signature = await accounts[i].signMessage(c.goTermsTypedData(terms));
    await post(`/games/${paired[0].digest}/sign`, { player: accounts[i].address, signature: stark.formatSignature(signature) });
  }
  await matchmaker.tick();
  assert((await status(0)).ready);
  const registered = keeper.registrations.at(-1);
  const session = keeper.games.get(`/games/${p.hex(channel)}/${p.hex(terms.game_id)}`);
  const open = await keeperHooks.openCall({ channel, game_id: terms.game_id }, terms,
    { signatures: registered.authorizations, extras: registered.extras });
  report.checks.push(`${label}: paired, both wallets signed the ticket's terms, registered with the keeper`);
  // Black then white: the wallets in seat order, and their session keys.
  return { id: terms.game_id, ticket, terms, digest: BigInt(paired[0].digest), black, open, session, keys,
    wallets: seats.map(i => accounts[i]), seats: seats.map(i => accounts[i].address) };
}
/**
 * The chain's time in ms. The matchmaker dates tickets by it, and the referee's
 * clock must agree to start a game inside its ticket's window: Devnet's runs
 * ahead of the wall clock here, moved on past the dispute deadlines above.
 */
const chainMs = async () => Number((await provider.getBlockWithTxHashes('latest')).timestamp) * 1000;
/** Seat `seat` of `game` signs `step`, and the keeper stamps it at `at` (ms). */
const play = (game, step, at) => game.session.stamp(p.signedStep(game.session.sign(step, game.keys[game.session.due()])), at, refereeKey);
const settleCall = game => [game.open, c.directHistoryCall(channel, game.id, 0, game.session.start, game.session.startWitness,
  game.session.steps, game.keys.map(k => game.session.checkpointSignature(0, k)))];
const ticketStatus = async digest => Number(BigInt((await provider.callContract(c.channelCall(ratings, 'ticket_status', [digest])))[0]));
const ratingsOf = seats => Promise.all(seats.map(x => c.getPlayerRating(provider, ratings, x)));

const full = await ratedPair('rated');
let at = await chainMs();
for (const { step } of fixture.steps) play(full, p.goStep(step.action.kind, step.action.point, step.action.dead), at += 1000);
assert(full.session.env.outcome.finished);
// The keeper's copy is finished: the matchmaker frees both players at once.
await matchmaker.tick();
assert.equal((await status(0)).status, 'none');
await invoke(full.black, settleCall(full), 'rated game opened and settled');
const started = (await game(full.id)).started;
assert.equal(started, Math.floor(full.session.steps[0].stamp / 1000));
assert.equal(await ticketStatus(full.digest), 1);
await expectFailure(1, c.rateCall(channel, full.id, { ...full.ticket, nonce: full.ticket.nonce + 1n }), 'Not the game ticket');
// The same ticket can't open a second game, even with both wallets' signatures.
const again = c.ratedTerms(full.ticket, [p.publicKey(0x999n), p.publicKey(0x99an)]);
const signed = await Promise.all(full.wallets.map(async w => stark.formatSignature(await w.signMessage(c.goTermsTypedData(again)))));
await expectFailure(0, c.openRatedGameCall(again, signed, full.ticket, c.signTicket(full.ticket, matchmakerKey)), 'Ticket used');
// The matchmaker's next round finds the settled game and rates it.
const round = await matchmaker.tick();
assert.deepEqual(round.rated, [full.id]);
const rateReceipt = await provider.waitForTransaction(round.tx);
report.transactions.push({ label: 'rate (by the matchmaker)', hash: round.tx, resources: rateReceipt.execution_resources });
assert.equal(await ticketStatus(full.digest), 2);
assert.deepEqual((await matchmaker.tick()).rated, []);
const rated = await ratingsOf(full.seats);
const expected = rating.update(rating.start(2), rating.start(2), fixture.result.startsWith('B') ? 2 : 0, BigInt(started));
assert.deepEqual(rated.map(r => [r.mu, r.phi]), [[expected.black.mu, expected.black.phi], [expected.white.mu, expected.white.phi]]);
await invoke(1, c.rateCall(channel, full.id, full.ticket), 'rate again (no-op)');
assert.deepEqual(await ratingsOf(full.seats), rated);
report.checks.push(`Rated game: opened on its ticket at settlement, the ticket accepted once, dated by its first stamp and rated by the matchmaker like the SDK (${rated.map(r => rating.rankLabel(r.rank_tenths) + (r.provisional ? '?' : '')).join(' vs ')})`);

// Black opens the game and resigns onchain before anything stamped reaches
// the chain: no stamp dates it, so its ticket does, and the loss counts.
const forfeit = await ratedPair('forfeit');
const beforeForfeit = await ratingsOf(forfeit.seats);
await invoke(forfeit.black, [forfeit.open, c.resignCall(channel, forfeit.id)], 'rated game opened and resigned onchain at once');
assert.equal((await game(forfeit.id)).started, 0);
assert.deepEqual((await matchmaker.tick()).rated, [forfeit.id]);
const afterForfeit = await ratingsOf(forfeit.seats);
assert.equal(afterForfeit[0].losses, beforeForfeit[0].losses + 1);
assert.notEqual(afterForfeit[0].mu, beforeForfeit[0].mu);
assert.equal(await ticketStatus(forfeit.digest), 2);
// A player's clock never moves back: the later of its last game and the ticket's issue.
const latest = (a, b) => (a > b ? a : b);
assert.equal(afterForfeit[0].last_played, latest(beforeForfeit[0].last_played, BigInt(forfeit.ticket.issued_at)));
assert.deepEqual([afterForfeit[1].mu, afterForfeit[1].games], [beforeForfeit[1].mu, beforeForfeit[1].games]);
report.checks.push('Short onchain forfeit before any stamp reached the chain: dated by its ticket, only the loser rated');

const abort = await ratedPair('abort');
at = await chainMs();
play(abort, p.goStep(p.PLAY, 40), at += 1000);
play(abort, p.resignStep(1), at += 1000);
await matchmaker.tick();
await invoke(0, settleCall(abort), 'short game opened and settled');
assert.deepEqual((await matchmaker.tick()).voided, [abort.id]);
assert.equal(await ticketStatus(abort.digest), 3);
await matchmaker.tick();
assert.equal(matchmaker.lobby.aborts.get(p.hex(abort.seats[1]))?.length, 1);
report.checks.push('Short transcript: void, and an abort by the player who resigned');
await service.close();

const replayed = verifyRatings(await fetchRatingEvents(provider, p.hex(ratings)));
assert(replayed.ok, p.json(replayed.errors));
assert.equal(replayed.games, 2);
await invoke(0, c.syncCall(channel, accounts[0].address), 'sync');
report.ratings = p.hex(ratings);
report.checks.push('Every rating replayed from the contract\'s events (replay.mjs)');

report.completed_at = new Date().toISOString();
await mkdir(new URL('./results/', import.meta.url), { recursive: true });
await writeFile(new URL('./results/local-integration.json', import.meta.url), p.json(report));
console.log(`Local integration passed: ${report.transactions.length} signed transactions, ${report.checks.length} checks`);
