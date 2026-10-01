// Signs every recorded game (and a scoring-dispute scenario) with the JS SDK
// and writes JSON fixtures, proving-executable inputs, and Cairo vectors that
// the rules crate replays to check JS and Cairo agree byte for byte. A ranked
// (timed) game is also stamped by a referee, as a keeper would stamp it.
// Deterministic PUBLIC test identities 0x1 and 0x2 (seats) and 0x3 (referee),
// never production keys.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as p from './sdk/src/index.mjs';
import { batchOf } from './sdk/src/client.mjs';

const root = new URL('../', import.meta.url);
const records = JSON.parse(await readFile(new URL('benchmarks/results/move-fixtures.json', root), 'utf8'));
const keys = [0x1n, 0x2n];
const baseTerms = { chain_id: 1n, channel: 2n, game_id: 3n, prover: 6n, players: [4n, 5n], keys: keys.map(p.publicKey) };
const move = (s, kind, point = p.NO_POINT, dead = 0n) => s.move(p.goStep(kind, point, dead), keys[s.due()]);
const span = xs => [BigInt(xs.length), ...xs];

/** Calldata for offchain/proving: terms, start, history witness, and the batch (steps, stamps, final signatures, attestation). */
const proofInput = s => [...p.encodeTerms(p.go, s.terms), ...p.encodeEnvelope(p.go, s.start), ...span(s.startWitness),
  ...p.encodeBatch(p.go, batchOf(s.steps))].map(p.hex);

function record(s, extra) {
  return { ...extra, ...s.export(), expected_hash: s.stateHash(), expected: s.env, proof_input: proofInput(s) };
}

await mkdir(new URL('fixtures/', import.meta.url), { recursive: true });
const corpus = [], sessions = {};
for (const [i, f] of records.entries()) {
  const s = p.goSession(p.goTerms({ ...baseTerms, game_id: BigInt(i + 10), size: f.size, komi_half: f.komi }));
  for (const point of f.moves) move(s, point === p.NO_POINT ? p.PASS : p.PLAY, point);
  let dead = 0n;
  for (const point of f.representatives) dead = p.markGroup(s.env.game.board, f.size, dead, point);
  move(s, p.PROPOSE, p.NO_POINT, dead); move(s, p.ACCEPT);
  if (s.env.game.black_half - s.env.game.white_half !== f.margin) throw Error(`SGF mismatch: ${f.id}`);
  await writeFile(new URL(`fixtures/${f.id}.json`, import.meta.url), p.json(record(s, { id: f.id, result: f.result })));
  corpus.push({ id: f.id, result: f.result, size: f.size, moves: f.moves.length, steps: s.steps.length });
  sessions[f.id] = s;
  console.log(`${f.id}: signed ${s.steps.length} steps; ${f.result} checked`);
}

// Scoring dispute: a rejected proposal and the game's one resume. White
// captures the black corner, and two passes score the board as it stands.
const corner = p.goSession(p.goTerms({ ...baseTerms, size: 9, komi_half: 13 }));
for (const point of [2, 0, 10, 1, 18, 80]) move(corner, p.PLAY, point);
move(corner, p.PASS); move(corner, p.PASS);
move(corner, p.PROPOSE, p.NO_POINT, p.bits([0, 1])); move(corner, p.RESUME);
move(corner, p.PLAY, 9); move(corner, p.PASS); move(corner, p.PASS);
if (corner.env.outcome.reason !== p.PLAYED_OUT) throw Error('Corner dispute should end played out');
await writeFile(new URL('fixtures/corner_dispute.json', import.meta.url), p.json(record(corner, { id: 'corner_dispute' })));
await writeFile(new URL('fixtures/manifest.json', import.meta.url), p.json(corpus));

// Ranked games, every step stamped by a referee (key 0x3) as a keeper would.
// `script` is [ms since the last stamp, action kind, point, dead], or
// [ms, 'flag'] for the referee's flag, checked to come on the first
// millisecond it can.
const refereeKey = 0x3n;
function refereed(game_id, clock, script) {
  const s = p.goSession(p.goTerms({ ...baseTerms, game_id, size: 9, komi_half: 13, clock }));
  const referee = new p.Referee(s, refereeKey, { now: 0 });
  let now = 1_000_000;
  for (const [after, kind, point = p.NO_POINT, dead = 0n] of script) {
    now += after;
    if (kind === 'flag') {
      if (referee.flag(now - 1) !== null || referee.flag(now) === null) throw Error(`Expected a flag at ${now}`);
    } else {
      referee.stamp(s.sign(p.goStep(kind, point, dead), keys[s.due()]), now);
    }
  }
  // A seat's client verifies every stamp's attestation as it pulls the steps.
  if (p.importSession(JSON.parse(p.json(s.export()))).stateHash() !== s.stateHash()) throw Error('Client and referee disagree');
  return s;
}
const clock = p.publicKey(refereeKey);

// Surround's per-turn timer (60 s). Scoring steps are charged to the seat due
// to act like any move. White resumes after black's proposal (the game's one
// resume), black plays and white passes, then black stalls and is flagged.
const timed = refereed(4n, p.rankedClock(clock), [
  [0, p.PLAY, 2], // the first stamp starts the clock
  [20_000, p.PLAY, 0],
  [59_000, p.PLAY, 10],
  [1_000, p.PLAY, 1],
  [30_000, p.PLAY, 18],
  [60_000, p.PLAY, 80], // white's whole turn, to the millisecond
  [5_000, p.PASS],
  [5_000, p.PASS],
  [45_000, p.PROPOSE, p.NO_POINT, p.bits([0, 1])], // black proposes on its own turn
  [10_000, p.RESUME], // white declines: black moves next, on a fresh turn
  [20_000, p.PLAY, 9],
  [3_000, p.PASS], // white; black is due
  [p.RANKED_TURN_MS + 1, 'flag'],
]);
if (timed.env.outcome.reason !== p.REASON_TIMEOUT || timed.env.outcome.winner !== p.WHITE) throw Error('Expected black to lose on time');

// Byo-yomi: 60 s of main time, then 3 periods of 10 s. A turn that ends
// inside a period costs nothing; each period that runs out is lost.
const byoyomi = p.byoyomiClock(clock, { main_ms: 60_000, periods: 3, period_ms: 10_000 });
const periodsLeft = s => s.env.clock.seats.periods;
// White loses a period, then another; the game ends by agreement.
const byoyomiPeriod = refereed(5n, byoyomi, [
  [0, p.PLAY, 2],
  [20_000, p.PLAY, 0], // white: 20 s of main time
  [65_000, p.PLAY, 10], // black: all its main time, 5 s into a period: costs nothing
  [55_000, p.PLAY, 1], // white: 40 s of main time, then 15 s: one period lost
  [9_000, p.PLAY, 18], // black: inside a period
  [20_000, p.PLAY, 80], // white: 20 s of overtime: one more period lost
  [1_000, p.PASS],
  [1_000, p.PASS],
  [9_999, p.PROPOSE, p.NO_POINT, p.bits([0, 1])],
  [10_000, p.ACCEPT], // white's last period, to the millisecond
]);
if (p.json(periodsLeft(byoyomiPeriod)) !== p.json([3, 1]) || byoyomiPeriod.env.outcome.reason !== p.AGREEMENT)
  throw Error('Expected white to lose two periods and the game to end by agreement');
// Black spends its main time and every period on one move and flags in overtime.
const byoyomiFlag = refereed(6n, byoyomi, [
  [0, p.PLAY, 2],
  [30_000, p.PLAY, 0],
  [60_000 + 3 * 10_000 + 1, 'flag'], // black: its main time and all three periods
]);
if (byoyomiFlag.env.outcome.reason !== p.REASON_TIMEOUT || byoyomiFlag.env.outcome.winner !== p.WHITE)
  throw Error('Expected black to flag in overtime');

for (const [id, s] of [['timed_flag', timed], ['byoyomi_period', byoyomiPeriod], ['byoyomi_flag', byoyomiFlag]])
  await writeFile(new URL(`fixtures/${id}.json`, import.meta.url), p.json(record(s, { id, referee_key: refereeKey })));

// Cairo vectors: the proving input plus the expected end-state hash.
const vector = (name, s) => `pub fn ${name}() -> Vector {
    vector(${`array![${proofInput(s).join(', ')}]`}.span(), ${p.hex(s.stateHash())})
}
`;
const signature = sig => `Signature { r: ${p.hex(sig.r)}, s: ${p.hex(sig.s)} }`;
const source = `// Generated by offchain/generate-fixtures.mjs from JS-signed transcripts.
// Public test keys 0x1 and 0x2 (seats) and 0x3 (referee); no production keys.
// Do not edit by hand.
use arbiter::{Batch, Envelope, Signature, Terms};
use crate::go::{GoAction, GoConfig, GoState};

#[derive(Copy, Drop)]
pub struct Vector {
    pub terms: Terms<GoConfig>,
    pub start: Envelope<GoState>,
    pub history: Span<felt252>,
    pub batch: Batch<GoAction>,
    pub end_hash: felt252,
}

fn vector(mut input: Span<felt252>, end_hash: felt252) -> Vector {
    let terms = Serde::<Terms<GoConfig>>::deserialize(ref input).unwrap();
    let start = Serde::<Envelope<GoState>>::deserialize(ref input).unwrap();
    let history = Serde::<Span<felt252>>::deserialize(ref input).unwrap();
    let batch = Serde::<Batch<GoAction>>::deserialize(ref input).unwrap();
    assert!(input.is_empty());
    Vector { terms, start, history, batch, end_hash }
}

${vector('corner_dispute', corner)}
${vector('cgos_9_1682833', sessions.cgos_9_1682833)}
/// A ranked game (60 s per turn, referee key 0x3) that ends when black is
/// flagged in the scoring phase.
${vector('timed_flag', timed)}
/// Byo-yomi (60 s, then 3 x 10 s): white loses two periods; agreement.
${vector('byoyomi_period', byoyomiPeriod)}
/// Byo-yomi (60 s, then 3 x 10 s): black flags in overtime.
${vector('byoyomi_flag', byoyomiFlag)}
/// The referee's attestation after each step of \`timed_flag\`.
pub fn timed_flag_attestations() -> Span<Signature> {
    array![
${timed.steps.map(r => `        ${signature(r.attestation)},`).join('\n')}
    ]
        .span()
}
`;
await writeFile(new URL('rules/src/tests/vectors.cairo', root), source);
execFileSync('scarb', ['fmt'], { cwd: new URL('rules/', root) });
console.log('Generated shared Cairo/JS vectors');
