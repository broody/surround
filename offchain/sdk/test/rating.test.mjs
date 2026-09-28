import test from 'node:test';
import assert from 'node:assert/strict';
import * as r from '../src/rating.mjs';

const ONE = Number(r.ONE);
const q = x => Number(x) / ONE;

// The same model in floating point, to bound the fixed-point error.
const MU = r.MU_T.map(q);
function rankF(mu) {
  if (mu <= MU[0]) return 0;
  if (mu >= MU[39]) return 39;
  let i = 0;
  while (MU[i + 1] <= mu) i++;
  return i + (mu - MU[i]) / (MU[i + 1] - MU[i]);
}
function updateF(b, w, result, t) {
  const hl = k => (k < 16 ? 15 : k >= 30 ? 45 : 15 + 30 * (k - 16) / 14);
  const aged = x => {
    if (x.phi === 0) return 4;
    const dt = Math.min(t - x.last, 2 ** 30);
    if (dt <= 0) return x.phi ** 2;
    const c = 1.15 * 2 * Math.LN2 / hl(rankF(x.mu));
    return Math.min(4, x.phi ** 2 + c * c * dt / 86400);
  };
  const g = v => 1 / Math.sqrt(1 + 3 * v / Math.PI ** 2);
  const sig = z => 1 / (1 + Math.exp(-z));
  const vb = aged(b), vw = aged(w);
  const side = (x, v, gg, oppMu, s) => {
    const E = sig(gg * (x.mu - oppMu));
    const v2 = 1 / (1 / v + gg * gg * E * (1 - E));
    const mu = Math.min(q(r.MU_MAX), Math.max(q(r.MU_MIN), x.mu + v2 * gg * (s - E)));
    return { mu, phi: Math.max(q(r.MIN_PHI), Math.sqrt(v2)), last: Math.max(x.last, t) };
  };
  return { p: sig(g(vb + vw) * (b.mu - w.mu)), black: side(b, vb, g(vw), w.mu, result / 2),
    white: side(w, vw, g(vb), b.mu, 1 - result / 2) };
}

// Deterministic pseudo-random numbers (xorshift32).
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
}

test('division rounds half to even, symmetric in sign', () => {
  assert.deepEqual([5n, 7n, 3n, 1n, 9n].map(n => r.div(n, 2n)), [2n, 4n, 2n, 0n, 4n]);
  assert.deepEqual([-5n, -7n, -3n].map(n => r.div(n, 2n)), [-2n, -4n, -2n]);
  assert.equal(r.div(10n, 3n), 3n);
  assert.equal(r.div(11n, 3n), 4n);
});

test('square roots round to nearest', () => {
  const next = rng(7);
  for (let i = 0; i < 2000; i++) {
    const n = BigInt(Math.floor(next() * 2 ** 50)) * BigInt(1 + Math.floor(next() * 2 ** 40));
    const s = r.sqrt(n);
    assert.ok(n > s * s - s && n <= s * s + s, `${n}`); // (s − ½)² < n ≤ (s + ½)²
  }
  assert.deepEqual([0n, 1n, 2n, 3n, 4n, 6n, 7n].map(r.sqrt), [0n, 1n, 1n, 2n, 2n, 2n, 3n]);
});

test('e^(-x) is within two units of the last place', () => {
  for (let x = 0; x < 30; x += 0.013) {
    const got = r.expNeg(BigInt(Math.round(x * ONE)));
    assert.ok(Math.abs(Number(got) - Math.exp(-x) * ONE) <= 2, `x=${x}`);
  }
  assert.equal(r.expNeg(23n * r.ONE), 0n);
});

test('bands and rank labels', () => {
  assert.deepEqual([1, 2, 3, 4].map(b => r.rankLabel(r.rankTenths(r.start(b).mu))), ['23k', '17k', '6k', '1k']);
  assert.equal(r.rankTenths(0n), 242); // rating 1500: 24.30 on OGS's curve, 24.299 between table points
  assert.equal(r.rankTenths(r.MU_T[30]), 300);
  assert.equal(r.rankLabel(300), '1d');
  assert.equal(r.rankLabel(r.rankTenths(r.MU_MAX)), '9d');
  assert.equal(r.rankLabel(r.rankTenths(r.MU_MIN)), '30k');
  assert.throws(() => r.start(0));
  assert.throws(() => r.start(5));
});

test('matches the floating-point model over random games', () => {
  const next = rng(42);
  let maxP = 0, maxMu = 0, maxPhi = 0;
  const players = Array.from({ length: 40 }, (_, i) => r.start(1 + (i % 4)));
  let t = 1_700_000_000n;
  for (let i = 0; i < 3000; i++) {
    const a = Math.floor(next() * 40), b = (a + 1 + Math.floor(next() * 39)) % 40;
    t += BigInt(Math.floor(next() ** 4 * 90 * 86400));
    const result = next() < 0.02 ? 1 : next() < 0.5 ? 2 : 0;
    const f = updateF(...[players[a], players[b]].map(x => ({ mu: q(x.mu), phi: q(x.phi), last: Number(x.last) })),
      result, Number(t));
    const out = r.update(players[a], players[b], result, t);
    maxP = Math.max(maxP, Math.abs(q(out.p) - f.p));
    for (const [x, y] of [[out.black, f.black], [out.white, f.white]]) {
      maxMu = Math.max(maxMu, Math.abs(q(x.mu) - y.mu));
      maxPhi = Math.max(maxPhi, Math.abs(q(x.phi) - y.phi));
    }
    players[a] = out.black; players[b] = out.white;
  }
  assert.ok(maxP < 1e-8, `p ${maxP}`);
  assert.ok(maxMu < 1e-7, `mu ${maxMu}`);
  assert.ok(maxPhi < 1e-7, `phi ${maxPhi}`);
});

test('winners gain, losers lose, draws pull together', () => {
  const a = { mu: r.MU_T[20], phi: r.ONE / 2n, last: 1000n }, b = { mu: r.MU_T[22], phi: r.ONE / 2n, last: 1000n };
  const won = r.update(a, b, 2, 2000n);
  assert.ok(won.black.mu > a.mu && won.white.mu < b.mu);
  const lost = r.update(a, b, 0, 2000n);
  assert.ok(lost.black.mu < a.mu && lost.white.mu > b.mu);
  const drew = r.update(a, b, 1, 2000n);
  assert.ok(drew.black.mu > a.mu && drew.white.mu < b.mu); // the weaker player gains
  assert.ok(won.p < r.ONE / 2n);
});

test('ratings stay in range and clocks never go back', () => {
  const top = { mu: r.MU_MAX, phi: r.PHI0, last: 5000n }, bottom = { mu: r.MU_MIN, phi: r.PHI0, last: 5000n };
  const upset = r.update(bottom, top, 2, 4000n); // rated late: t before both last-played times
  assert.ok(upset.black.mu <= r.MU_MAX && upset.white.mu >= r.MU_MIN);
  assert.equal(upset.black.last, 5000n);
  const expected = r.update(top, bottom, 2, 6000n);
  assert.equal(expected.black.mu, r.MU_MAX);
  assert.equal(expected.white.mu, r.MU_MIN);
  const idle = r.update({ mu: 0n, phi: r.MIN_PHI, last: 0n }, { mu: 0n, phi: r.MIN_PHI, last: 0n }, 2, 1n << 62n);
  assert.ok(idle.black.phi <= r.PHI0);
});

test('provisional until a win, a loss and phi <= 1.0', () => {
  assert.equal(r.provisional({ phi: r.ONE, wins: 1, losses: 1 }), false);
  assert.equal(r.provisional({ phi: r.ONE + 1n, wins: 1, losses: 1 }), true);
  assert.equal(r.provisional({ phi: r.ONE / 2n, wins: 3, losses: 0 }), true);
});
