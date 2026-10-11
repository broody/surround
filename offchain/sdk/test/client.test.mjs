import test from 'node:test';
import assert from 'node:assert/strict';
import { shortString, typedData } from 'starknet';
import * as p from '../src/index.mjs';
import * as c from '../src/client.mjs';

const tag = s => BigInt(shortString.encodeShortString(s));
const keys = [0x1n, 0x2n];
const terms = p.goTerms({ chain_id: 1n, channel: 2n, game_id: 3n, prover: 6n, players: [4n, 5n],
  keys: keys.map(p.publicKey), size: 9, komi_half: 13 });
const session = p.goSession(terms);
session.move(p.goStep(p.PLAY, 40), keys[0]);
const startHash = p.stateHash(p.go, session.start), endHash = session.stateHash();
const expected = { classHash: 7n, terms, epoch: 0, startHash, endHash, block: { block_number: 123, block_hash: '0x456' }, osProgram: 8n };

test('native bases are ten blocks deep and never predate the channel anchor', () => {
  assert.equal(c.nativeProofBlock(100, 90), 90);
  assert.equal(c.nativeProofBlock(100, 91), null);
  assert.equal(c.nativeProofBlock(9, 0), null);
  assert.equal(c.nativeProofBlock(101, 90), 91);
  assert.throws(() => c.nativeProofBlock(100, -1));
});

function response() {
  const payload = p.proofPayload(p.go, { classHash: expected.classHash, prover: terms.prover, terms,
    context: session.context, epoch: 0, startHash, endHash });
  return { proof: 'opaque-test-response-not-a-real-proof',
    l2_to_l1_messages: [{ from_address: '0x6', to_address: '0x0', payload: payload.map(p.hex) }],
    proof_facts: [tag('PROOF1'), tag('VIRTUAL_SNOS'), 8n, tag('VIRTUAL_SNOS0'), 123n, 0x456n, 9n, 1n,
      p.proofMessageHash(terms.prover, payload)].map(p.hex) };
}

test('Go states round-trip through their Cairo encoding', () => {
  const encoded = p.go.encodeState(session.env.game);
  assert.equal(encoded.length, 24);
  assert.deepEqual(p.go.decodeState(new p.Reader(encoded)), session.env.game);
  assert.equal(p.reviveEnvelope(JSON.parse(p.json(session.env))).transcript, session.env.transcript);
});

test('native response checks bind the exact message and base block', () => {
  assert.equal(c.validateNativeProof(response(), expected).proof, response().proof);
  const large = response(); large.proof_facts[0] = p.hex(tag('PROOF2'));
  assert.equal(c.validateNativeProof(large, expected).proof, large.proof);
  assert.throws(() => c.validateNativeProof(response(), { ...expected, osProgram: 9n }));
  assert.throws(() => c.validateNativeProof(response(), { ...expected, osProgram: undefined }));
  for (const mutate of [r => r.proof = '', r => r.l2_to_l1_messages.push(r.l2_to_l1_messages[0]),
    r => r.l2_to_l1_messages[0].from_address = '0x7', r => r.l2_to_l1_messages[0].to_address = '0x1',
    r => r.l2_to_l1_messages[0].payload[9] = '0x1', r => r.proof_facts[4] = '0x7a',
    r => r.proof_facts[0] = p.hex(tag('PROOF3')), r => r.proof_facts[2] = '0x9', r => r.proof_facts[5] = '0x457',
    r => r.proof_facts[8] = '0x1', r => r.proof_facts.push('0x0')]) {
    const r = response(); mutate(r); assert.throws(() => c.validateNativeProof(r, expected));
  }
});

test('native responses cannot cross games, epochs or output states', () => {
  for (const changed of [{ terms: { ...terms, game_id: 4n } }, { epoch: 1 }, { classHash: 8n },
    { endHash: endHash + 1n }, { startHash: endHash }])
    assert.throws(() => c.validateNativeProof(response(), { ...expected, ...changed }));
});

test('channel calls encode Surround entrypoints', () => {
  const call = c.directHistoryCall(2n, 3n, 0, session.start, session.startWitness, session.steps);
  assert.equal(call.entrypoint, 'submit_history');
  const encodedStart = p.encodeEnvelope(p.go, session.start);
  const at = 2 + encodedStart.length;
  assert.equal(BigInt(call.calldata[at]), 1n); // history length
  // One stone (3 felts), no stamps, one final signature per seat (white has
  // none yet) and a zero attestation: the game is untimed.
  assert.deepEqual(call.calldata.slice(at + 2, at + 6).map(BigInt), [1n, 0n, 0n, 40n]);
  assert.deepEqual(call.calldata.slice(at + 6, at + 14).map(BigInt),
    [0n, 2n, session.steps[0].signature.r, session.steps[0].signature.s, 0n, 0n, 0n, 0n]);
  assert.throws(() => c.batchOf(JSON.parse(p.json(session.export())).steps), /seat/);
  // open_game takes the terms, both wallets' signatures and the referee's
  // (zero: Go takes no randomness). The terms' config ends with the ticket
  // digest, 0 for an unrated game.
  const open = c.openGameCall(terms, [[1n, 2n], [3n, 4n, 5n]]);
  assert.equal(open.entrypoint, 'open_game');
  assert.deepEqual(open.calldata.map(BigInt), [...p.encodeTerms(p.go, terms), 2n, 2n, 1n, 2n, 3n, 3n, 4n, 5n, 0n, 0n]);
  assert.deepEqual(p.go.encodeConfig(terms.config), [9n, 13n, 0n]);
  // What each wallet signs: the arbiter domain's typed data over the terms' context.
  assert.equal(c.goTermsTypedData(terms).domain.name, 'arbiter');
  assert.equal(c.goTermsMessageHash(terms, 4n), p.termsMessageHash(p.go, terms, 4n));
  const proving = c.provingTransaction({ session, epoch: 0, nonce: 0 });
  assert.equal(BigInt(proving.calldata[0]), terms.channel);
  assert.equal(proving.resource_bounds.l2_gas.max_price_per_unit, '0x0');
});

/** The fixed ticket and ratings contract whose digest ratings/src/tests/test_surround.cairo checks (`digest_matches_the_sdk`). */
const SDK_RATINGS = 0x7a71e5n;
const SDK_DIGEST = 0x3d97a6e778b53eebc522a2bfbd0b2a1d767e9c75a24a12befc1c18279120a14n;

test('rated tickets hash, sign and encode as SurroundRatings expects', () => {
  const now = 1_700_000_000n, clock = p.rankedClock(0x444n);
  const ticket = { chain_id: tag('SN_SEPOLIA'), channel: 0x111n, player_0: 0x222n, player_1: 0x333n, pool: c.GO_POOL,
    config: 0xc0f1925n, referee: 0x444n, clock: c.clockHash(clock.settings), prover: 0x555n, response_seconds: 600,
    source: c.QUEUE, band_0: 3, band_1: 2, matchmaker: 0x666n, issued_at: now - 30n, expires_at: now + 270n, nonce: 7n };
  assert.equal(c.GO_POOL, tag('go'));
  // The digest binds the ratings contract.
  assert.equal(c.ticketDigest(ticket, SDK_RATINGS), SDK_DIGEST);
  assert.equal(c.ticketDigest({ ...ticket, pool: 'go' }, SDK_RATINGS), SDK_DIGEST);
  assert.notEqual(c.ticketDigest(ticket, SDK_RATINGS + 1n), SDK_DIGEST);
  const signature = c.signTicket(ticket, SDK_RATINGS, 0x3a7c4n);
  assert.ok(p.verify(SDK_DIGEST, signature, p.publicKey(0x3a7c4n)));
  assert.ok(!p.verify(c.ticketDigest({ ...ticket, band_1: 4 }, SDK_RATINGS), signature, p.publicKey(0x3a7c4n)));
  // The Serde encoding, field for field, and back; and through JSON.
  assert.deepEqual(c.encodeTicket(ticket), [tag('SN_SEPOLIA'), 0x111n, 0x222n, 0x333n, tag('go'), 0xc0f1925n, 0x444n,
    ticket.clock, 0x555n, 600n, 1n, 3n, 2n, 0x666n, now - 30n, now + 270n, 7n]);
  assert.deepEqual(c.decodeTicket(c.encodeTicket(ticket)), ticket);
  assert.deepEqual(c.reviveTicket(JSON.parse(JSON.stringify(c.ticketJson(ticket)))), ticket);
  // The hashes a ticket names its game by: the config's, as arbiter::config_hash::<GoRules> takes it, and the
  // clock settings', as set_clock_preset keys them.
  assert.equal(c.goConfigHash(19, 15), p.poseidon([tag('SURROUND'), tag('ARBITER_CONFIG_V1'), 19n, 15n, 0n]));
  // As Cairo's config_hash::<GoRules> gives them (src/tests/test_rated.cairo).
  assert.equal(c.goConfigHash(19, 15), 0x32352b4b60eaad352f8010a4faf022659c75e63d8c5b302c1ad87e2be0d8eafn);
  assert.equal(c.goConfigHash(9, 14), 0x4a2ee613fac8f333e5dd426e1a2c6e07194a473782b872c884f4c4ec19fb5e3n);
  assert.equal(c.clockHash(clock.settings), p.poseidon(p.standardTime.encodeSettings(clock.settings)));
  assert.notEqual(c.clockHash(p.byoyomiClock(0x444n, { main_ms: 60000, periods: 3, period_ms: 10000 }).settings), ticket.clock);
});

test('rated terms are the ticket\'s, on the board, komi and clock it names by hash', () => {
  const clock = p.rankedClock(0x444n);
  const game = { ratings: SDK_RATINGS, size: 19, komi_half: 15, settings: clock.settings };
  const ticket = { chain_id: tag('SN_SEPOLIA'), channel: 0x111n, player_0: 0x222n, player_1: 0x333n, pool: c.GO_POOL,
    config: c.goConfigHash(19, 15), referee: 0x444n, clock: c.clockHash(clock.settings), prover: 0x555n, response_seconds: 600,
    source: c.QUEUE, band_0: 3, band_1: 2, matchmaker: 0x666n, issued_at: 1_699_999_970n, expires_at: 1_700_000_270n, nonce: 7n };
  const digest = c.ticketDigest(ticket, SDK_RATINGS), signature = c.signTicket(ticket, SDK_RATINGS, 0x3a7c4n);
  // A rated game's terms are the ticket's and carry its digest.
  const rated = p.goTerms({ chain_id: ticket.chain_id, channel: ticket.channel, game_id: 9n, prover: ticket.prover,
    response_seconds: ticket.response_seconds, clock, players: [ticket.player_0, ticket.player_1],
    keys: [0x777n, 0x888n], size: 19, komi_half: 15, ticket: digest });
  const call = c.openRatedGameCall(rated, [[1n, 2n], [3n, 4n]], ticket, signature);
  assert.equal(call.entrypoint, 'open_rated_game');
  assert.equal(BigInt(call.contractAddress), 0x111n);
  const data = call.calldata.map(BigInt);
  const head = [...p.encodeTerms(p.go, rated), 2n, 2n, 1n, 2n, 2n, 3n, 4n];
  assert.deepEqual(data.slice(0, head.length), head);
  assert.deepEqual(data.slice(head.length), [...c.encodeTicket(ticket), signature.r, signature.s]);
  // Signed in: each seat's approval, tagged 1 for a delegated key and 0 for a wallet's signature.
  const delegated = { key: 5n, expires_at: 2000n, delegation: [6n, 7n], signature: { r: 8n, s: 9n } };
  const signedIn = c.openRatedGameDelegableCall(rated, [delegated, [3n, 4n]], ticket, signature);
  assert.equal(signedIn.entrypoint, 'open_rated_game_delegable');
  assert.deepEqual(signedIn.calldata.map(BigInt), [...p.encodeTerms(p.go, rated),
    2n, 1n, 5n, 2000n, 2n, 6n, 7n, 8n, 9n, 0n, 2n, 3n, 4n, ...c.encodeTicket(ticket), signature.r, signature.s]);
  // The matchmaker builds those terms from the ticket, what it names by hash and both session keys;
  // the game id is the seats' wallets' and keys', the only one the channel takes.
  const gameId = p.gameIdOf([ticket.player_0, ticket.player_1], [0x777n, 0x888n]);
  assert.equal(gameId, p.poseidon([p.tag('ARBITER_GAME_ID_V1'), ticket.player_0, ticket.player_1, 0x777n, 0x888n]));
  assert.notEqual(c.ratedTerms(ticket, [0x777n, 0x999n], game).game_id, gameId);
  assert.deepEqual(c.ratedTerms(ticket, [0x777n, 0x888n], game), { ...rated, game_id: gameId });
  // What the ticket names by hash must be its: the board, the komi, the clock and the pool.
  assert.throws(() => c.ratedTerms(ticket, [0x777n, 0x888n], { ...game, size: 13 }), /board and komi/);
  assert.throws(() => c.ratedTerms(ticket, [0x777n, 0x888n], { ...game, komi_half: 13 }), /board and komi/);
  assert.throws(() => c.ratedTerms(ticket, [0x777n, 0x888n], { ...game, settings: { ...clock.settings, turn_ms: 30000 } }), /clock/);
  assert.throws(() => c.ratedTerms({ ...ticket, pool: tag('blitz') }, [0x777n, 0x888n], game), /pool/);
  // `game` travels as JSON beside the ticket, and the terms say the same.
  assert.deepEqual(c.reviveTicketGame(JSON.parse(JSON.stringify(c.ticketGameJson(game)))), game);
  const terms = c.ratedTerms(ticket, [0x777n, 0x888n], game);
  assert.deepEqual(c.ticketGameOf(terms, SDK_RATINGS), game);
  // Terms survive JSON (felts as hex): goTerms revives them.
  const sent = JSON.parse(p.json(terms));
  assert.deepEqual(p.goTerms({ ...sent, ...sent.config }), terms);
  // A verifier checks the terms it is sent against the ticket: its digest for this ratings contract, its
  // referee, its players, its hashes.
  assert.ok(c.isTicketTerms(terms, ticket, SDK_RATINGS));
  assert.ok(!c.isTicketTerms(terms, ticket, SDK_RATINGS + 1n));
  assert.ok(!c.isTicketTerms(terms, { ...ticket, referee: 0x445n }, SDK_RATINGS));
  assert.ok(!c.isTicketTerms(p.goTerms({ ...sent, ...sent.config, clock: p.rankedClock(0x445n) }), ticket, SDK_RATINGS));
  assert.ok(!c.isTicketTerms(p.goTerms({ ...sent, ...sent.config, players: [0x333n, 0x222n], game_id: undefined }), ticket, SDK_RATINGS));
  assert.ok(!c.isTicketTerms(p.goTerms({ ...sent, ...sent.config, size: 13, game_id: undefined }), ticket, SDK_RATINGS));
  // Ratings reads and policy for the 'go' pool.
  assert.deepEqual(c.rateCall(0x111n, 9n, ticket), c.channelCall(0x111n, 'rate', [9n, ...c.encodeTicket(ticket)]));
  assert.deepEqual(c.setConfigCall(0x7a7n, 19, 15).calldata.map(BigInt), [tag('go'), ticket.config, 1n]);
  // A preset is the settings alone, serialized with their length; the ticket hashes them without it.
  assert.deepEqual(c.setClockPresetCall(0x7a7n, clock.settings, false).calldata.map(BigInt), [tag('go'), 4n, 60000n, 0n, 0n, 1n, 0n]);
  assert.deepEqual(c.setStartBandsCall(0x7a7n).calldata.map(BigInt), [tag('go'), 0b1110n]);
  assert.deepEqual(c.setAnchorCall(0x7a7n, 0x99n, -5n).calldata.map(BigInt), [tag('go'), 0x99n, (1n << 251n) + 17n * (1n << 192n) + 1n - 5n]);
});

test('matchmaker requests bind the session key the player asks to play with', () => {
  const fields = { chainId: tag('SN_SEPOLIA'), action: 'queue', player: 0x123n, size: 19, clock: 'turn', band: 2, at: 1_700_000_000, nonce: 9n };
  const typed = c.matchmakerRequest({ ...fields, key: 0xabcn });
  assert.equal(typed.domain.version, '4');
  assert.deepEqual(typed.types.Request.find(f => f.name === 'key'), { name: 'key', type: 'felt' });
  assert.equal(typed.message.key, '0xabc');
  // Leave and close name no game: their key is 0.
  assert.equal(c.matchmakerRequest({ ...fields, action: 'leave' }).message.key, '0x0');
  const hash = t => typedData.getMessageHash(t, '0x123');
  assert.notEqual(hash(typed), hash(c.matchmakerRequest({ ...fields, key: 0xabdn })));
});

test('a request to play an AI anchor binds which anchor', () => {
  const fields = { chainId: tag('SN_SEPOLIA'), action: 'ai', player: 0x123n, size: 19, clock: 'turn', band: 2, key: 0xabcn,
    at: 1_700_000_000, nonce: 9n };
  const typed = c.matchmakerRequest({ ...fields, opponent: 0x777n });
  assert.equal(typed.message.opponent, '0x777');
  assert.equal(c.matchmakerRequest(fields).message.opponent, '0x0');
  const hash = t => typedData.getMessageHash(t, '0x123');
  assert.notEqual(hash(typed), hash(c.matchmakerRequest({ ...fields, opponent: 0x778n })));
});
