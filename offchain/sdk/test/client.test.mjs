import test from 'node:test';
import assert from 'node:assert/strict';
import { shortString } from 'starknet';
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
  assert.equal(encoded.length, 23);
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
  // One stone (3 felts), then one final signature per seat; white has none yet.
  assert.deepEqual(call.calldata.slice(at + 2, at + 6).map(BigInt), [1n, 0n, 0n, 40n]);
  assert.deepEqual(call.calldata.slice(at + 6, at + 7 + 4).map(BigInt),
    [2n, session.steps[0].signature.r, session.steps[0].signature.s, 0n, 0n]);
  assert.throws(() => c.batchOf(JSON.parse(p.json(session.export())).steps), /seat/);
  assert.equal(c.createChannelCall({ channel: 2n, size: 19, komi_half: 13, session_key: 1n, prover: 6n }).calldata.length, 6);
  const proving = c.provingTransaction({ session, epoch: 0, nonce: 0 });
  assert.equal(BigInt(proving.calldata[0]), terms.channel);
  assert.equal(proving.resource_bounds.l2_gas.max_price_per_unit, '0x0');
});
