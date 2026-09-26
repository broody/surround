import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as p from '../src/index.mjs';

// Deterministic PUBLIC test identities; never production session keys.
const keys = [0x1n, 0x2n];
const terms = p.goTerms({ chain_id: 1n, channel: 2n, game_id: 3n, prover: 6n, players: [4n, 5n],
  keys: keys.map(p.publicKey), size: 9, komi_half: 13 });
const due = s => s.due();
const move = (s, kind, point = p.NO_POINT, dead = 0n) => s.move(p.goStep(kind, point, dead), keys[due(s)]);

test('two independent clients exchange signed moves and reject replay', () => {
  const a = p.goSession(terms), b = p.goSession(terms);
  const first = move(a, p.PLAY, 40); b.receive(first);
  const next = move(b, p.PLAY, 41); a.receive(next);
  assert.equal(a.stateHash(), b.stateHash());
  assert.throws(() => b.receive(first), /signature/);
  assert.equal(p.importSession(JSON.parse(p.json(a.export()))).stateHash(), a.stateHash());
  assert(!p.json(a.export()).includes('private'));
});

test('signatures bind game, chain, rules, prover and transcript', () => {
  const session = p.goSession(terms), signed = move(session, p.PLAY, 40);
  for (const modified of [{ ...terms, game_id: 4n }, { ...terms, chain_id: 2n },
    { ...terms, config: { size: 9, komi_half: 15 } }, { ...terms, prover: 7n }])
    assert.throws(() => p.goSession(modified).receive(signed), /signature/);
  const fresh = p.goSession(terms);
  assert.throws(() => fresh.receive({ ...signed, step: p.goStep(p.PLAY, 41) }), /signature/);
  assert.throws(() => fresh.receive({ ...signed, signature: { ...signed.signature, s: 0n } }), /signature/);
});

test('illegal moves, occupation, turn and entropy are rejected', () => {
  const s = p.goSession(terms); move(s, p.PLAY, 40);
  assert.throws(() => move(s, p.PLAY, 40), /occupied/);
  assert.throws(() => s.move(p.goStep(p.PLAY, 41), keys[0]), /Wrong signing key/);
  assert.throws(() => move(s, p.PLAY, 81), /bounds/);
  assert.throws(() => s.move(p.playRandom(p.goAction(p.PLAY, 41), 1n), keys[1]), /Unexpected entropy/);
  assert.throws(() => p.goAction(7), /Unknown action/);
  assert.equal(s.steps.length, 1);
});

test('actions encode compactly, as Cairo GoAction variants', () => {
  assert.deepEqual(p.go.encodeAction(p.goAction(p.PLAY, 40)), [0n, 40n]);
  assert.deepEqual(p.go.encodeAction(p.goAction(p.PASS, 40)), [1n]);
  assert.deepEqual(p.go.encodeAction(p.goAction(p.PROPOSE, p.NO_POINT, p.bits([0, 130, 300]))),
    [2n, 1n, 4n, 1n << 44n]);
  assert.deepEqual(p.go.encodeAction(p.goAction(p.ACCEPT)), [3n]);
  assert.deepEqual(p.go.encodeAction(p.goAction(p.RESUME)), [4n]);
  // A stone step is Move::Play + GoAction::Play + point.
  assert.deepEqual(p.encodeStep(p.go, p.goStep(p.PLAY, 40)), [0n, 0n, 40n]);
});

test('scoring needs complete groups and both turns; disagreement resumes play', () => {
  const s = p.goSession(terms);
  for (const point of [2, 0, 10, 1, 18, 80]) move(s, p.PLAY, point);
  move(s, p.PASS); move(s, p.PASS);
  const original = s.stateHash(), history = s.witness();
  assert.throws(() => move(s, p.ACCEPT), /proposal/);
  assert.throws(() => move(s, p.PROPOSE, p.NO_POINT, p.bits([0])), /Partial dead group/);
  assert.equal(s.stateHash(), original);
  move(s, p.PROPOSE, p.NO_POINT, p.bits([0, 1])); move(s, p.RESUME);
  assert.deepEqual(s.witness(), history); assert.equal(s.due(), 0);
  move(s, p.PLAY, 9); assert.equal(s.env.game.black_captures, 2);
  move(s, p.PASS); move(s, p.PASS); move(s, p.PROPOSE); move(s, p.ACCEPT);
  assert.equal(s.env.game.black_half - s.env.game.white_half, -3);
  assert.throws(() => move(s, p.PLAY, 20), /finished/);
});

test('a missing history cannot remove a superko commitment', () => {
  const s = p.goSession(terms); move(s, p.PLAY, 40);
  assert.throws(() => p.goSession(terms, { start: s.env, witness: s.witness().slice(1) }), /history/);
});

test('checkpoint approvals bind the epoch and cannot reopen a channel', () => {
  const s = p.goSession(terms); move(s, p.PLAY, 40);
  const ack = s.checkpointSignature(7, keys[0]);
  assert(p.verify(p.checkpointHash(p.go, s.context, 7, s.stateHash()), ack, terms.keys[0]));
  assert(!p.verify(p.checkpointHash(p.go, s.context, 8, s.stateHash()), ack, terms.keys[0]));
  assert(!p.verify(p.reopenHash(p.go, s.context, 7, s.stateHash()), ack, terms.keys[0]));
});

test('either player can sign a resignation, ending the match', () => {
  const s = p.goSession(terms); s.move(p.resignStep(1), keys[1]);
  assert.deepEqual(s.env.outcome, { finished: true, winner: p.BLACK, reason: p.REASON_RESIGN });
  assert.throws(() => move(s, p.PASS), /finished/);
});

test('resume-then-play cannot outrank an opponent-acknowledged scoring branch', () => {
  const prefix = p.goSession(terms); move(prefix, p.PASS); move(prefix, p.PASS);
  const agreed = p.importSession(JSON.parse(p.json(prefix.export())));
  const fork = p.importSession(JSON.parse(p.json(prefix.export())));
  move(agreed, p.PROPOSE); move(agreed, p.ACCEPT);
  move(fork, p.RESUME); move(fork, p.PLAY, 40);
  assert.equal(agreed.env.seq, fork.env.seq);
  assert(agreed.env.support_turn > fork.env.support_turn);
  assert.equal(fork.env.last_seat, 0);
});

test('every signed recorded game matches its published result', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../fixtures/manifest.json', import.meta.url), 'utf8'));
  for (const row of manifest) {
    const f = JSON.parse(await readFile(new URL(`../../fixtures/${row.id}.json`, import.meta.url), 'utf8'));
    const session = p.importSession(f);
    assert.equal(session.stateHash(), BigInt(f.expected_hash));
    assert.equal(session.env.game.move_number, row.moves);
    assert.equal(session.env.outcome.reason, p.AGREEMENT);
  }
});
