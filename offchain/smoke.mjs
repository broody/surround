// Two disposable local wallets against the real Dojo channel on Devnet. No
// native proof acceptance is simulated here: settlement uses direct onchain
// replay, and the adapter is exercised only for its negative checks.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Account, RpcProvider, hash } from './sdk/node_modules/starknet/dist/index.mjs';
import * as p from './sdk/src/index.mjs';
import * as c from './sdk/src/client.mjs';
import * as rating from './sdk/src/rating.mjs';
import { fetchRatingEvents, verifyRatings } from './sdk/src/replay.mjs';
import { ratedGame, starknetChain } from './matchmaker/chain.mjs';
import { Matchmaker } from './matchmaker/matchmaker.mjs';
import { serve } from './matchmaker/server.mjs';
import { memoryStore } from './matchmaker/store.mjs';
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
const report = { network: 'local Devnet 0.8.0', protocol: 'referee',
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

const testKeys = [0x1n, 0x2n]; // Explicit public test keys; no production keys.
async function create(size = 9, komi_half = 13, clock = null) {
  const r = await invoke(0, c.createChannelCall({ channel, size, komi_half, session_key: p.publicKey(testKeys[0]), prover, response_seconds: 300, clock }), 'create');
  const trace = await c.rpc(url, 'starknet_traceTransaction', { transaction_hash: r.transaction_hash });
  const id = BigInt(trace.execute_invocation.calls.find(x => BigInt(x.contract_address) === channel).result[0]);
  await invoke(1, c.joinChannelCall(channel, id, p.publicKey(testKeys[1])), 'join');
  const snapshot = await c.getSnapshot(provider, channel, id);
  return { id, snapshot, terms: snapshot.terms };
}
const move = (s, kind, point = p.NO_POINT, dead = 0n) => s.move(p.goStep(kind, point, dead), testKeys[s.due()]);
const acks = (s, epoch) => testKeys.map(k => s.checkpointSignature(epoch, k));

// A complete recorded game settles by direct onchain replay of every signed step.
const fixture = JSON.parse(await readFile(new URL('./fixtures/cgos_9_1682833.json', import.meta.url), 'utf8'));
const first = await create(9, 14), session = p.goSession(first.terms);
assert.equal(first.snapshot.anchor_hash, p.stateHash(p.go, session.start));
for (const { step } of fixture.steps) move(session, step.action.kind, step.action.point, step.action.dead);
const ok = acks(session, 0);
await expectFailure(0, c.settlementCall(prover, channel, first.id, 0, first.snapshot.anchor_hash, session.env, ok), 'Missing proof facts');
await expectFailure(0, c.channelCall(channel, 'accept_verified', [first.id, 0, first.snapshot.anchor_hash,
  ...p.encodeEnvelope(p.go, session.env), ...p.encodeSignatures(ok)]), 'Only prover');
await expectFailure(0, c.directHistoryCall(channel, first.id, 0, session.start, session.startWitness, session.steps,
  [ok[0], { ...ok[1], s: ok[1].s ^ 1n }]), 'Invalid session signature');
await invoke(0, c.directHistoryCall(channel, first.id, 0, session.start, session.startWitness, session.steps, ok), 'agreed full-game direct settlement');
let g = await game(first.id);
assert.equal(g.anchor.hash, session.stateHash()); assert.equal(g.status, 4);
assert.deepEqual(g.result, { finished: true, winner: p.WHITE, reason: p.AGREEMENT });
report.checks.push(`All ${session.steps.length} recorded steps, signatures and W+2 result matched in the actual Dojo contract`);

// A cooperative checkpoint, then offchain play continues from the new anchor.
const checkpoint = await create(), part = p.goSession(checkpoint.terms);
move(part, p.PLAY, 40); move(part, p.PLAY, 41);
await invoke(0, c.directHistoryCall(channel, checkpoint.id, 0, part.start, part.startWitness, part.steps, acks(part, 0)), 'cooperative checkpoint');
const anchored = await c.getSnapshot(provider, channel, checkpoint.id);
assert.equal(anchored.epoch, 1); assert.equal(anchored.anchor_hash, part.stateHash());
const tail = p.goSession(checkpoint.terms, { start: part.env, witness: part.witness() });
move(tail, p.PASS); move(tail, p.PASS); move(tail, p.PROPOSE); move(tail, p.ACCEPT);
await expectFailure(0, c.directHistoryCall(channel, checkpoint.id, 0, tail.start, tail.startWitness, tail.steps), 'Stale channel epoch');
await invoke(1, c.directHistoryCall(channel, checkpoint.id, 1, tail.start, tail.startWitness, tail.steps, acks(tail, 1)), 'checkpoint continuation settled');
assert.equal((await game(checkpoint.id)).status, 4);

// Freeze an anchor, submit newer candidates without moving it, resolve to a
// fresh response window, force a legal move, then resume offchain.
const dispute = await create(), prefix = p.goSession(dispute.terms);
move(prefix, p.PLAY, 40); move(prefix, p.PLAY, 41);
await invoke(1, c.disputeCall(channel, dispute.id, 0), 'open dispute');
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
const reopen = testKeys.map(k => prefix.reopenSignature(forced.epoch, forced.anchor.hash, k));
await invoke(0, c.resumeCall(channel, dispute.id, forced.epoch, reopen), 'mutual return to offchain play');
assert.equal((await game(dispute.id)).status, 1);
report.checks.push('Frozen dispute anchor, newer candidates, fresh deadline, forced move and mutual offchain resumption verified');

// Only the onchain response deadline determines a timeout.
const timed = await create(); await invoke(1, c.disputeCall(channel, timed.id, 0), 'timeout dispute');
await advance((await game(timed.id)).deadline); await invoke(1, c.resolveCall(channel, timed.id, 0), 'timeout forced phase');
await advance((await game(timed.id)).deadline); await invoke(1, c.timeoutCall(channel, timed.id, 1), 'timeout claimed');
g = await game(timed.id);
assert.deepEqual(g.result, { finished: true, winner: p.WHITE, reason: p.REASON_ABANDON });
report.checks.push('Only the onchain response deadline determines abandonment');

// Either wallet can concede without a prover.
const conceded = await create(); await invoke(0, c.resignCall(channel, conceded.id), 'wallet resignation');
assert.deepEqual((await game(conceded.id)).result, { finished: true, winner: p.WHITE, reason: p.REASON_RESIGN });

// A ranked game: 60 s per turn, every step stamped by a referee (public test
// key 0x3, standing in for a keeper). Black lets its turn run out, the referee
// flags it, and white's unilateral submission settles as a timeout.
const refereeKey = 0x3n;
const ranked = await create(9, 13, p.rankedClock(p.publicKey(refereeKey)));
assert.deepEqual((await game(ranked.id)).clock, p.rankedClock(p.publicKey(refereeKey)));
assert.deepEqual(ranked.terms.clock, p.rankedClock(p.publicKey(refereeKey)));
const refereed = p.goSession(ranked.terms), referee = new p.Referee(refereed, refereeKey, { now: 1_000_000 });
const stamp = (kind, point, at) => referee.stamp(refereed.sign(p.goStep(kind, point), testKeys[refereed.due()]), at);
stamp(p.PLAY, 40, 1_000_000); stamp(p.PLAY, 41, 1_030_000);
assert.equal(referee.flag(1_090_000), null);
assert(referee.flag(1_090_001));
await expectFailure(1, c.directHistoryCall(channel, ranked.id, 0, refereed.start, refereed.startWitness,
  refereed.steps.map(r => ({ ...r, stamp: r.stamp - 1 }))), 'Invalid session signature');
await invoke(1, c.directHistoryCall(channel, ranked.id, 0, refereed.start, refereed.startWitness, refereed.steps), 'flagged ranked game submitted');
await advance((await game(ranked.id)).deadline); await invoke(1, c.resolveCall(channel, ranked.id, 0), 'flag settled');
g = await game(ranked.id);
assert.deepEqual(g.result, { finished: true, winner: p.WHITE, reason: p.REASON_TIMEOUT });
assert.equal(g.anchor.hash, refereed.stateHash());
report.checks.push('Ranked game: referee stamps and attestation replayed onchain; the flag settled as a timeout');

// Rated games. SurroundRatings (the plain contract that keeps ratings across
// worlds) checks the matchmaker's ticket (public test key 0x4) once; each game
// is refereed (0x3) and rated with the ticket that created it:
// - a whole game settled by replay updates both players exactly as the SDK's
//   integer update predicts;
// - black resigning onchain at once still loses: a short onchain forfeit
//   changes only the loser's rating;
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
// The matchmaker pairs the two wallets: each signs a queue request (SNIP-12,
// checked through its account contract), and it signs their ticket. It finds
// each game in SurroundRatings' TicketUsed events and rates it once it
// settles. Any rank gap is allowed here, so the two wallets can play three games.
const chainId = 0x4b4154414e41n;
const matchmaker = await Matchmaker.open({ chain_id: chainId, channel, prover, matchmakerKey, clocks: { turn: clock }, boards: { 9: 14 },
  response_seconds: 300, ticket_seconds: 240, from_block: await provider.getBlockNumber(),
  rules: { gap_tenths: 390, max_gap_tenths: 390, max_repeats: 3 } },
  starknetChain({ rpc_url: url, channel, ratings, account: { address: accounts[1].address, privateKey: stored[1].private_key } }),
  { store: memoryStore({}) });
const service = await serve(matchmaker, { poll_ms: 0 });
const post = async (path, body) => (await fetch(`${service.url}${path}`, { method: 'POST', body: JSON.stringify(body) })).json();
let nonce = BigInt(Date.now()) << 16n;
async function queue(i) {
  const fields = { player: accounts[i].address, size: 9, clock: 'turn', band: 2, at: Math.floor(Date.now() / 1000), nonce: p.hex(++nonce) };
  const signature = await accounts[i].signMessage(c.matchmakerRequest({ chainId, action: 'queue', ...fields }));
  return post('/queue', { ...fields, signature: Array.isArray(signature) ? signature : [p.hex(signature.r), p.hex(signature.s)] });
}
/** Pair the wallets, then black creates the rated game and white joins: its id, ticket and black's wallet. */
async function ratedPair(label) {
  assert.equal((await queue(0)).status, 'waiting');
  const second = await queue(1);
  const first = await (await fetch(`${service.url}/queue/${p.hex(accounts[0].address)}`)).json();
  assert.equal(first.digest, second.digest);
  const black = first.color === 'black' ? 0 : 1, paired = black === 0 ? first : second;
  const ticket = c.reviveTicket(paired.ticket);
  const create = c.createRatedChannelCall({ channel, ticket, signature: paired.signature, session_key: p.publicKey(testKeys[0]) });
  const created = await invoke(black, create, `${label} create`);
  const trace = await c.rpc(url, 'starknet_traceTransaction', { transaction_hash: created.transaction_hash });
  const id = BigInt(trace.execute_invocation.calls.find(x => BigInt(x.contract_address) === channel).result[0]);
  await invoke(1 - black, c.joinChannelCall(channel, id, p.publicKey(testKeys[1])), `${label} join`);
  // Black then white: the wallets in seat order.
  return { id, ticket, digest: BigInt(paired.digest), black, create, seats: [black, 1 - black].map(i => accounts[i].address) };
}
const ticketStatus = async digest => Number(BigInt((await provider.callContract(c.channelCall(ratings, 'ticket_status', [digest])))[0]));
const ratingsOf = seats => Promise.all(seats.map(x => c.getPlayerRating(provider, ratings, x)));

const full = await ratedPair('rated');
await expectFailure(full.black, full.create, 'Ticket used');
assert.equal(await ticketStatus(full.digest), 1);
const ratedSession = p.goSession((await c.getSnapshot(provider, channel, full.id)).terms);
const judge = new p.Referee(ratedSession, refereeKey, { now: 0 });
let at = 1000;
for (const { step } of fixture.steps) judge.stamp(ratedSession.sign(p.goStep(step.action.kind, step.action.point, step.action.dead), testKeys[ratedSession.due()]), at += 1000);
const playedAt = ratedGame(await provider.callContract(c.channelCall(channel, 'rated_game', [full.id]))).played_at;
assert(playedAt > 0);
await invoke(1, c.rateCall(channel, full.id, full.ticket), 'rate before settlement (no-op)');
await expectFailure(1, c.rateCall(channel, full.id, { ...full.ticket, nonce: full.ticket.nonce + 1n }), 'Not the game ticket');
assert.equal((await ratingsOf(full.seats))[0].games, 0);
await invoke(0, c.directHistoryCall(channel, full.id, 0, ratedSession.start, ratedSession.startWitness, ratedSession.steps, acks(ratedSession, 0)), 'rated settlement');
// The matchmaker's next round finds the settled game and rates it.
const round = await matchmaker.tick();
assert.deepEqual(round.rated, [full.id]);
const rateReceipt = await provider.waitForTransaction(round.tx);
report.transactions.push({ label: 'rate (by the matchmaker)', hash: round.tx, resources: rateReceipt.execution_resources });
assert.equal(await ticketStatus(full.digest), 2);
assert.deepEqual((await matchmaker.tick()).rated, []);
const rated = await ratingsOf(full.seats);
const expected = rating.update(rating.start(2), rating.start(2), fixture.result.startsWith('B') ? 2 : 0, BigInt(playedAt));
assert.deepEqual(rated.map(r => [r.mu, r.phi]), [[expected.black.mu, expected.black.phi], [expected.white.mu, expected.white.phi]]);
await invoke(1, c.rateCall(channel, full.id, full.ticket), 'rate again (no-op)');
assert.deepEqual(await ratingsOf(full.seats), rated);
report.checks.push(`Rated game: paired and ticketed by the matchmaker, accepted once, settled by replay and rated by the matchmaker like the SDK (${rated.map(r => rating.rankLabel(r.rank_tenths) + (r.provisional ? '?' : '')).join(' vs ')})`);

const forfeit = await ratedPair('forfeit');
const beforeForfeit = await ratingsOf(forfeit.seats);
await invoke(forfeit.black, c.resignCall(channel, forfeit.id), 'rated game resigned onchain at once');
assert.deepEqual((await matchmaker.tick()).rated, [forfeit.id]);
const afterForfeit = await ratingsOf(forfeit.seats);
assert.equal(afterForfeit[0].losses, beforeForfeit[0].losses + 1);
assert.notEqual(afterForfeit[0].mu, beforeForfeit[0].mu);
assert.deepEqual([afterForfeit[1].mu, afterForfeit[1].games], [beforeForfeit[1].mu, beforeForfeit[1].games]);
report.checks.push('Short onchain forfeit: only the loser rated');

const abort = await ratedPair('abort');
const shortSession = p.goSession((await c.getSnapshot(provider, channel, abort.id)).terms);
const shortReferee = new p.Referee(shortSession, refereeKey, { now: 0 });
shortReferee.stamp(shortSession.sign(p.goStep(p.PLAY, 40), testKeys[0]), 1000);
shortReferee.stamp(shortSession.sign(p.resignStep(1), testKeys[1]), 2000);
await invoke(0, c.directHistoryCall(channel, abort.id, 0, shortSession.start, shortSession.startWitness, shortSession.steps, acks(shortSession, 0)), 'short game settled');
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
