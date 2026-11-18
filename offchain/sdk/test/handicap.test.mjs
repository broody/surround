import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../src/index.mjs';
import * as c from '../src/client.mjs';

// Deterministic PUBLIC test identities; never production session keys.
const keys = [0x1n, 0x2n];
const players = [0xa1n, 0xb2n];
const casual = (size, handicap, komi_half = 15) =>
  c.casualTerms({ chain_id: p.tag('SN_SEPOLIA'), players, keys: keys.map(p.publicKey), size, komi_half, handicap });
const stonesOf = mask => [...mask.toString(2)].filter(b => b === '1').length;

test('handicap stones go on the star points, as many as asked, at most 9 (5 on 9×9)', () => {
  // 19×19: two stones at Q16 (row 3, column 15) and D4 (row 15, column 3).
  assert.deepEqual(p.handicapPoints(19, 2), [3 * 19 + 15, 15 * 19 + 3]);
  // The centre joins at 5, 7 and 9; never at 6 or 8.
  for (const size of [9, 13, 19]) {
    const centre = (size * size - 1) / 2;
    for (let n = 2; n <= p.maxHandicap(size); n++) {
      const points = p.handicapPoints(size, n);
      assert.equal(new Set(points).size, n, `${n} stones on ${size}×${size}`);
      assert.ok(points.every(x => x >= 0 && x < size * size));
      assert.equal(points.includes(centre), [5, 7, 9].includes(n), `centre with ${n} stones on ${size}×${size}`);
    }
  }
  assert.equal(p.maxHandicap(9), 5);
  assert.equal(p.maxHandicap(13), 9);
  assert.equal(p.maxHandicap(19), 9);
  assert.deepEqual(p.handicapPoints(19, 0), []);
  assert.deepEqual(p.handicapPoints(19, 1), []);
});

test('a handicap game opens with Black\'s stones and White to move, on half a point of komi', () => {
  for (const [size, n] of [[9, 5], [13, 9], [19, 2], [19, 9]]) {
    const terms = casual(size, n);
    assert.equal(terms.config.komi_half, p.HANDICAP_KOMI_HALF);
    const state = p.go.init(terms.config);
    assert.equal(stonesOf(state.board.black), n);
    assert.equal(state.board.white, 0n);
    assert.equal(state.next_player, p.WHITE);
  }
  // One is no stones and Black first, still on half a point.
  const one = p.go.init(casual(19, 1).config);
  assert.equal(one.board.black, 0n);
  assert.equal(one.next_player, p.BLACK);
  assert.equal(casual(19, 1).config.komi_half, p.HANDICAP_KOMI_HALF);
});

test('in a handicap game White signs the first move, a stone can\'t go on a handicap stone, and the record imports', () => {
  const terms = casual(19, 4);
  const a = p.goSession(terms), b = p.goSession(terms);
  assert.throws(() => a.move(p.goStep(p.PLAY, 180), keys[0]));
  b.receive(a.move(p.goStep(p.PLAY, 180), keys[1]));
  a.receive(b.move(p.goStep(p.PLAY, 181), keys[0]));
  assert.throws(() => a.move(p.goStep(p.PLAY, p.handicapPoints(19, 4)[0]), keys[1]), /occupied/i);
  const again = p.importSession(JSON.parse(p.json(a.export())));
  assert.equal(again.env.game.move_number, 2);
  assert.equal(again.terms.config.handicap, 4);
  assert.equal(p.contextHash(p.go, again.terms), p.contextHash(p.go, terms));
});

test('a game without a handicap encodes as before; the handicap is signed only where there is one', () => {
  const even = casual(19, 0);
  assert.equal('handicap' in even.config, false);
  assert.deepEqual(p.go.encodeConfig(even.config), [19n, 15n, 0n]);
  assert.deepEqual(p.go.encodeConfig(casual(19, 3).config), [19n, 1n, 0n, 3n]);
  const hashes = [0, 1, 2, 3].map(n => p.contextHash(p.go, casual(19, n)));
  assert.equal(new Set(hashes.map(String)).size, hashes.length);
});

test('a handicap is refused outside a casual game, or beyond its board', () => {
  const base = { chain_id: 1n, prover: 0n, players, keys: keys.map(p.publicKey), size: 19, komi_half: 1 };
  assert.throws(() => p.goTerms({ ...base, channel: 5n, handicap: 2 }), /casual/);
  assert.throws(() => p.goTerms({ ...base, channel: 0n, ticket: 7n, handicap: 2 }), /rated game has no handicap/);
  assert.throws(() => casual(9, 6), /Handicap out of bounds/);
  assert.throws(() => casual(19, 10), /Handicap out of bounds/);
  assert.throws(() => casual(19, 2.5), /Handicap out of bounds/);
});
