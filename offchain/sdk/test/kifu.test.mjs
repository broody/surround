import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as referee from '@referee/sdk';
import * as p from '../src/index.mjs';
import * as c from '../src/client.mjs';

// The stress game's record as the Cairo encoder packs it
// (src/tests/test_kifu_stress.cairo): both must agree digit for digit.
const STRESS = [
  0x549b6d43ac198da63b48781a42194d7f4b75bc760d166e7eedb96720762e05n, 0x9c45a7f915f69c9c723518413c81717c4995118670c8ed68768f1ff3d587a8n, 0x6c7e7f345976e7b45a3fd7f9716e90003ffca98f5ee71552447651faebf45en, 0x799ebb4e81a701c74ff5bccbc75a8e84f3c16e74a32d4be5ea555b9c900015n, 0x7814cb0aca406131138f095224f0a9a3ed00ae71c46086696cdb517478f79bn, 0x2f252d2ce784d2c532e81067f3353f37fa3970034912880c27fdff9fca25fdn, 0x39424ad7ae51aea8ae86eb0bae52bc2601f35328479d3896dd90fce8e94a18n, 0x643a02d000a8735f5420175db75bab4a1975b784b68948deee38ecd419143fn, 0x1b3913a3e3fc44ba081bf195b93fd215ee4b4fae435b836563a64e7219e135n, 0x88793661e9bb90cb2ceba3012dd906822b4039a7084d9a00e118d438bdf5d1n, 0x6ec33b2e6c836abd813da8451b4e9cac2360853d51fe55be7ce02cbda2f875n, 0x9d01e23b6d8f3ce39c58d03170b4f92a004488419ce2878a4bb0b3de860198n, 0x8cbd3bd96eb77b91529d45b776207e5e9d5b595a7166690b2b281cc9dc6afan, 0x6cfc58b8ddbcfaa449f64d665a4ed2ccd1c7e0efde865fd2b0d9e493d9a4d6n, 0x3547a5dfbf11338d735f94f8f645e76798a2474bcc4cca9d90e7b13a96c7d7n, 0x750ccbc2c2f8e38b74a27a3b3b9a7086b5629e9c35ad2809a2dd5268132936n, 0x8a8964f6684bb9258b1fcedc2152e9e6692984b28650330fb87cdc21b015ffn, 0xa3d5473b4f4a71cd8d14d561a7e511d9f8a5e391dc16f26207fd458c2e9f98n, 0xfbfbf7fbfffdfbffedfff7fedf7f00021eed1aac9c0e07f3fcb66631e14dn, 0x5df7df775dbdf6eef7faf0000f6bb6fbfffed7f6f5aff7ef7f7edn,
];

const stress = JSON.parse(readFileSync(new URL('../../fixtures/stress_19_2.json', import.meta.url)));
const stepOf = s => s.kind === referee.MOVE_PLAY
  ? referee.play(p.goAction(s.action.kind, s.action.point, s.action.dead == null ? 0n : BigInt(s.action.dead)))
  : s.kind === referee.MOVE_RESIGN ? referee.resign(s.seat) : referee.flag();

test('the stress game packs as the contract packs it', () => {
  const steps = stress.steps.map(r => stepOf(r.step));
  const board = { black: BigInt(stress.expected.game.board.black), white: BigInt(stress.expected.game.board.white) };
  const record = c.encodeKifu(19, steps, board);
  assert.deepEqual(record, STRESS);
  const unpacked = c.decodeKifu(19, steps.length, record);
  assert.deepEqual(unpacked.board, board);
  assert.deepEqual(unpacked.steps.map(s => p.json(s)), steps.map(s => p.json(s)));
});

test('every step kind round-trips, and only canonical records decode', () => {
  const steps = [
    referee.play(p.goAction(p.PLAY, 0)), referee.play(p.goAction(p.PLAY, 360)), referee.play(p.goAction(p.PASS)),
    referee.play(p.goAction(p.PROPOSE, p.NO_POINT, (1n << 361n) - 1n)), referee.play(p.goAction(p.RESUME)),
    referee.play(p.goAction(p.PROPOSE, p.NO_POINT, 0b1011n)), referee.play(p.goAction(p.ACCEPT)),
    referee.resign(0), referee.resign(1), referee.flag(), referee.recommit(1n), referee.play(p.goAction(p.PLAY, 180)),
  ];
  const board = { black: 1n, white: 0n };
  const record = c.encodeKifu(19, steps, board);
  const unpacked = c.decodeKifu(19, steps.length, record);
  assert.deepEqual(unpacked.steps.map(s => p.json(s)), steps.map(s => p.json(s)));
  assert.deepEqual(unpacked.board, board);
  assert.throws(() => c.decodeKifu(19, steps.length, [...record, 0n]), /Noncanonical record/);
  assert.throws(() => c.decodeKifu(9, 1, [1n + 2n * 89n]), /Noncanonical record/);
  assert.throws(() => c.encodeKifu(9, [referee.play(p.goAction(p.PLAY, 81))], { black: 0n, white: 0n }), /Unencodable step/);
  // A stone on a point nobody played cannot be the final position.
  assert.throws(() => c.encodeKifu(9, [], { black: 1n, white: 0n }), /Unencodable board/);
});

test('a finished session gives the record and the mint call', () => {
  const keys = [0x1n, 0x2n];
  const terms = p.goTerms({ chain_id: 1n, channel: 2n, game_id: 3n, prover: 6n, players: [4n, 5n],
    keys: keys.map(p.publicKey), size: 9, komi_half: 13 });
  const session = p.goSession(terms);
  const moves = [p.goStep(p.PLAY, 40), p.goStep(p.PLAY, 41), p.goStep(p.PASS), p.goStep(p.PASS),
    p.goStep(p.PROPOSE, p.NO_POINT, 0n), p.goStep(p.ACCEPT)];
  moves.forEach((step, i) => session.move(step, keys[i % 2]));
  assert.equal(session.env.outcome.finished, true);
  const record = c.kifuRecord(session);
  assert.equal(record.length, 1);
  assert.deepEqual(c.decodeKifu(9, moves.length, record).board, session.env.game.board);
  const call = c.mintKifuCall(0x99n, 3n, session.env, record);
  assert.equal(call.entrypoint, 'mint');
  const calldata = call.calldata.map(BigInt);
  assert.equal(calldata[0], 3n);
  assert.deepEqual(calldata.slice(-2), [1n, record[0]]);
});
