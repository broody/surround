// Latency of ranked play without a network: the SDK's own work per step, in one
// process. Each step of a recorded game runs the path a keeper-refereed move
// takes, minus the transport:
//   sign     the mover checks and signs its step and marks it (store.move);
//   stamp    the referee verifies it, applies it and attests the clock
//            (Referee.stamp, as referee's keeper does on arrival);
//   receive  the opponent verifies the signature and the attestation, applies
//            the step and saves (store.receive);
//   own      the mover applies its own stamped step, beside the opponent.
// `e2e` is sign + stamp + receive: the mover's click to the opponent's board.
// Stores use the memory backend, or with `--store file` the Node file backend
// (a directory per store, each write synced to disk, as a keeper keeps it).
// Also breaks one late-game step into its parts: Poseidon, ECDSA, Go's rules
// and saving one new step.
//
// node offchain/latency.mjs [--runs 3] [--store memory|file] [--out results/latency.json] [fixture ...]
//   Default fixtures: cgos_9_1682833 (9x9), kgs_2019_04_26_17 and stress_19_2
//   (19x19). Public test keys 0x1 and 0x2 (seats) and 0x3 (referee).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileBackend } from './sdk/node_modules/@arbiter/sdk/sdk/src/store-file.mjs';
import * as p from './sdk/src/index.mjs';
import { SessionStore, memoryBackend } from './sdk/src/client.mjs';

const { values: args, positionals } = parseArgs({ allowPositionals: true, options: {
  runs: { type: 'string', default: '3' }, store: { type: 'string', default: 'memory' }, out: { type: 'string' } } });
if (!['memory', 'file'].includes(args.store)) throw Error('--store is memory or file');
// A fresh backend; `done()` closes and removes a file store.
async function backend() {
  if (args.store === 'memory') return { backend: memoryBackend(), done: async () => {} };
  const dir = await mkdtemp(join(tmpdir(), 'surround-latency-'));
  const b = await fileBackend(dir);
  return { backend: b, done: async () => { await b.close(); await rm(dir, { recursive: true, force: true }); } };
}
const runs = Number(args.runs);
const names = positionals.length ? positionals : ['cgos_9_1682833', 'kgs_2019_04_26_17', 'stress_19_2'];
const keys = [0x1n, 0x2n], refereeKey = 0x3n;
const PHASES = ['sign', 'stamp', 'receive', 'own', 'e2e'];

const fixture = async name => JSON.parse(await readFile(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'));
const rankedTerms = config => p.goTerms({ chain_id: 1n, channel: 2n, game_id: 3n, prover: 6n, players: [4n, 5n],
  keys: keys.map(p.publicKey), size: config.size, komi_half: config.komi_half, clock: p.rankedClock(p.publicKey(refereeKey)) });
const moveOf = ({ step }) => p.goStep(step.action.kind, step.action.point, step.action.dead);
const ms = t => Number(t) / 1e6;
const round2 = x => Math.round(x * 100) / 100;
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b), at = q => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { median: round2(at(0.5)), p95: round2(at(0.95)), max: round2(s.at(-1)) };
}

// One game, stamped one second apart. Returns each step's timings.
async function play(f) {
  const terms = rankedTerms(f.terms.config);
  const backends = await Promise.all([0, 1].map(backend));
  const stores = backends.map(b => new SessionStore(b.backend));
  const seats = await Promise.all(stores.map(store => store.open(p.go, terms)));
  const referee = new p.Referee(p.goSession(terms), refereeKey, { now: 0 });
  const rows = [];
  let now = 1_000_000;
  for (const entry of f.steps) {
    const mover = seats[0].due(), other = 1 - mover;
    now += 1000;
    const t0 = process.hrtime.bigint();
    const record = await stores[mover].move(seats[mover], moveOf(entry), keys[mover]);
    const t1 = process.hrtime.bigint();
    const stamped = p.signedStep(referee.stamp(p.signedStep(record), now));
    const t2 = process.hrtime.bigint();
    await stores[other].receive(seats[other], stamped);
    const t3 = process.hrtime.bigint();
    await stores[mover].receive(seats[mover], stamped);
    const t4 = process.hrtime.bigint();
    rows.push({ sign: ms(t1 - t0), stamp: ms(t2 - t1), receive: ms(t3 - t2), own: ms(t4 - t3), e2e: ms(t3 - t0) });
  }
  const hash = referee.session.stateHash();
  if (seats.some(s => s.stateHash() !== hash)) throw Error('Seats and referee disagree');
  for (const b of backends) await b.done();
  return rows;
}

async function game(name) {
  const f = await fixture(name), all = [];
  let cold = null;
  const rounds = [], early = [], late = [];
  for (let run = 0; run < runs; run++) {
    const rows = await play(f);
    cold ??= round2(rows[0].e2e); // the first step warms key caches and the JIT
    const warm = rows.slice(1);
    all.push(...warm);
    for (let i = 0; i + 1 < warm.length; i += 2) rounds.push(warm[i].e2e + warm[i + 1].e2e);
    early.push(...warm.slice(0, 50).map(r => r.e2e));
    late.push(...warm.slice(-50).map(r => r.e2e));
  }
  return { size: f.terms.config.size, steps: f.steps.length, runs, cold_first_step_ms: cold,
    ...Object.fromEntries(PHASES.map(ph => [ph, stats(all.map(r => r[ph]))])),
    a_then_b: stats(rounds), e2e_first_50_median: stats(early).median, e2e_last_50_median: stats(late).median };
}

// One late-game step's parts, at step `at` of `name` (which needs 20 more).
async function parts(name, at) {
  const f = await fixture(name), terms = rankedTerms(f.terms.config);
  const s = p.goSession(terms), referee = new p.Referee(s, refereeKey, { now: 0 });
  let now = 1_000_000;
  for (const entry of f.steps.slice(0, at)) { now += 1000; referee.stamp(s.sign(moveOf(entry), keys[s.due()]), now); }
  const average = (n, fn) => { fn(); const t = process.hrtime.bigint(); for (let i = 0; i < n; i++) fn(); return round2(ms(process.hrtime.bigint() - t) / n); };
  const felts = n => Array.from({ length: n }, (_, i) => BigInt(i + 1) * 0x123456789n);
  const message = 0x1234567890abcdefn, signature = p.sign(message, keys[0]), key = p.publicKey(keys[0]);
  const next = moveOf(f.steps[at]);
  // Save the transcript, then time saving it after each of 20 more steps.
  const saveOneStep = async () => {
    const b = await backend(), store = new SessionStore(b.backend), copy = p.importSession(JSON.parse(p.json(s.export())));
    await store.save(copy);
    let total = 0n, t = now;
    for (const entry of f.steps.slice(at, at + 20)) {
      t += 1000;
      copy.stamp(copy.sign(moveOf(entry), keys[copy.due()]), t, refereeKey);
      const start = process.hrtime.bigint();
      await store.save(copy);
      total += process.hrtime.bigint() - start;
    }
    await b.done();
    return round2(ms(total) / 20);
  };
  return {
    position: `${name} after ${at} steps`,
    poseidon_2_felts: average(300, () => p.poseidon(felts(2))),
    poseidon_8_felts: average(300, () => p.poseidon(felts(8))),
    poseidon_16_felts: average(300, () => p.poseidon(felts(16))),
    ecdsa_sign: average(200, () => p.sign(message, keys[0])),
    ecdsa_verify_cached_key: average(200, () => p.verify(message, signature, key)),
    apply_go_move: average(200, () => p.applyStep(p.go, s.context, terms, s.env, next, p.cloneScratch(p.go, s.scratch), now + 1000)),
    stamp_hash: average(200, () => p.stampHash(p.go, s.context, s.env)),
    [`store_save_one_step_${args.store}`]: await saveOneStep(),
  };
}

const lock = JSON.parse(await readFile(new URL('sdk/package-lock.json', import.meta.url), 'utf8'));
const report = {
  measured_at: new Date().toISOString(),
  node: process.version, cpu: cpus()[0].model.trim(), cores: cpus().length, memory_gib: Math.round(totalmem() / 2 ** 30),
  referee: lock.packages['node_modules/@arbiter/sdk'].resolved.split('#')[1],
  clock: 'ranked: 60 s per turn, stamped 1 s apart', store: `${args.store} backend`, unit: 'ms',
  games: {},
};
for (const name of names) {
  const g = report.games[name] = await game(name);
  console.log(`\n${name}: ${g.size}x${g.size}, ${g.steps} steps x ${runs} runs (first step, cold: ${g.cold_first_step_ms} ms)`);
  for (const ph of PHASES) console.log(`  ${ph.padEnd(8)} median ${String(g[ph].median).padStart(6)}  p95 ${String(g[ph].p95).padStart(6)}  max ${String(g[ph].max).padStart(6)}`);
  console.log(`  A then B median ${g.a_then_b.median}  p95 ${g.a_then_b.p95}; e2e median, first vs last 50 steps: ${g.e2e_first_50_median} vs ${g.e2e_last_50_median}`);
}
const longest = names.map(n => [n, report.games[n].steps]).sort((a, b) => b[1] - a[1])[0];
report.parts = await parts(longest[0], Math.min(400, longest[1] - 20));
console.log(`\nParts at ${report.parts.position}:`);
for (const [k, v] of Object.entries(report.parts)) if (k !== 'position') console.log(`  ${k.padEnd(24)} ${v} ms`);
if (args.out) await writeFile(args.out, JSON.stringify(report, null, 2) + '\n');
