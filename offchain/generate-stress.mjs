// Stress fixtures for proof capacity: seeded random legal 19x19 games that fill
// the board. Players never fill their own single-point eyes, so the board ends
// nearly full, with many captures and a long superko history. The game ends
// with two passes and an agreed score (no dead stones). Fixtures use the same
// format as generate-fixtures.mjs, so prove.py and sepolia.mjs accept them.
//
// node offchain/generate-stress.mjs [seed ...]
// Public test keys 0x1 and 0x2; never production keys.
import { writeFile } from 'node:fs/promises';
import * as p from './sdk/src/index.mjs';
import { batchOf } from './sdk/src/client.mjs';

const SIZE = 19, KOMI = 13, MAX_MOVES = 2000;
const keys = [0x1n, 0x2n];
const baseTerms = { chain_id: 1n, channel: 2n, game_id: 3n, prover: 6n, players: [4n, 5n], keys: keys.map(p.publicKey) };
const span = xs => [BigInt(xs.length), ...xs];
const proofInput = s => [...p.encodeTerms(p.go, s.terms), ...p.encodeEnvelope(p.go, s.start), ...span(s.startWitness),
  ...p.encodeBatch(p.go, batchOf(s.steps))].map(p.hex);

// mulberry32: small seeded PRNG so fixtures are reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const neighbors = p => [p >= SIZE ? p - SIZE : -1, p + SIZE < SIZE * SIZE ? p + SIZE : -1,
  p % SIZE > 0 ? p - 1 : -1, p % SIZE + 1 < SIZE ? p + 1 : -1].filter(n => n >= 0);
const stone = (board, point) => board.black >> BigInt(point) & 1n ? p.BLACK : board.white >> BigInt(point) & 1n ? p.WHITE : 0;
const ownEye = (board, point, color) => neighbors(point).every(n => stone(board, n) === color);

function play(seed) {
  const random = rng(seed);
  const s = p.goSession(p.goTerms({ ...baseTerms, game_id: BigInt(seed), size: SIZE, komi_half: KOMI }));
  let captures = 0, passes = 0;
  while (s.steps.length < MAX_MOVES && passes < 2) {
    const seat = s.due(), color = seat + 1, board = s.env.game.board;
    const order = [...Array(SIZE * SIZE).keys()].sort(() => random() - 0.5);
    let moved = false;
    for (const point of order) {
      if (stone(board, point) || ownEye(board, point, color)) continue;
      const before = s.env.game.black_captures + s.env.game.white_captures;
      try { s.move(p.goStep(p.PLAY, point), keys[seat]); } catch { continue; } // suicide or superko
      captures += s.env.game.black_captures + s.env.game.white_captures - before;
      moved = true; passes = 0; break;
    }
    if (!moved) { s.move(p.goStep(p.PASS), keys[seat]); passes++; }
  }
  s.move(p.goStep(p.PROPOSE), keys[s.due()]);
  s.move(p.goStep(p.ACCEPT), keys[s.due()]);
  const g = s.env.game;
  const onBoard = (g.board.black.toString(2).split('1').length - 1) + (g.board.white.toString(2).split('1').length - 1);
  return { s, onBoard, captures };
}

const seeds = process.argv.slice(2).map(Number);
for (const seed of seeds.length ? seeds : [1, 2, 3]) {
  const { s, onBoard, captures } = play(seed);
  const g = s.env.game, id = `stress_19_${seed}`;
  const margin = g.black_half - g.white_half;
  const result = margin > 0 ? `B+${margin / 2}` : margin < 0 ? `W+${-margin / 2}` : 'Draw';
  const record = { id, result, ...s.export(), expected_hash: s.stateHash(), expected: s.env, proof_input: proofInput(s),
    stress: { moves: g.move_number, stones_on_board: onBoard, captured: captures, positions: s.witness().length } };
  await writeFile(new URL(`fixtures/${id}.json`, import.meta.url), p.json(record));
  console.log(`${id}: ${s.steps.length} signed steps, ${g.move_number} moves, ${onBoard} stones on board, ${captures} captured, ${s.witness().length} positions, ${result}`);
}
