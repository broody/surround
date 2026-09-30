// Audit harness for the Q32.32 rating update (offchain/sdk/src/rating.mjs,
// bit-exact with ratings/src/math.cairo; see audit-vectors.mjs for the Cairo
// side). Fuzzes the integer update over extreme states, checks properties,
// tracks the bit width of every intermediate, and compares with a float64
// reference of the same model.
//
//   node offchain/ratings/audit/fuzz.mjs [iterations]
import * as r from '../../sdk/src/rating.mjs';

const N = Number(process.argv[2] ?? 300000);
const { ONE, MU_MIN, MU_MAX, MIN_PHI, PHI0, MU_T } = r;
const ONE2 = ONE * ONE, ONE3 = ONE2 * ONE;
const U64 = (1n << 64n) - 1n;
const f = x => Number(x) / 2 ** 32;

// ---------- instrumented copy of the update: max |intermediate| in bits ----------
const widths = new Map();
const track = (label, x) => {
  const b = (x < 0n ? -x : x).toString(2).length;
  if (b > (widths.get(label)?.bits ?? 0)) widths.set(label, { bits: b });
  return x;
};
const { div, sqrt } = r;
function expNegT(x) {
  const LN2 = 2977044472n;
  const n = x / LN2;
  if (n >= 33n) return 0n;
  const rr = x - n * LN2, j = rr / (ONE / 16n), u = rr - j * (ONE / 16n);
  let acc = ONE;
  for (let k = 6n; k > 0n; k--) acc = ONE - div(track('exp u*acc', u * acc), ONE * k);
  const EXP_T = [4294967296n, 4034748382n, 3790295335n, 3560652950n, 3344923893n, 3142265200n,
    2951884975n, 2773039306n, 2605029347n, 2447198598n, 2298930330n, 2159645183n];
  const e = div(track('exp T*acc', EXP_T[Number(j)] * acc), ONE);
  return n ? div(e, 1n << n) : e;
}
function sigmoidT(z) {
  if (z >= 0n) return div(ONE2, ONE + expNegT(z));
  const e = expNegT(-z);
  return div(track('sigmoid e*ONE', e * ONE), ONE + e);
}
const PI2 = 42389628127n;
const gOfT = v => sqrt(div(ONE3, ONE + div(track('g 3*var', 3n * v), PI2)));
function rankOfT(mu) {
  if (mu <= MU_T[0]) return 0n;
  if (mu >= MU_T[39]) return 39n * ONE;
  let lo = 0, hi = 38;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (MU_T[mid + 1] > mu) hi = mid; else lo = mid + 1; }
  return BigInt(lo) * ONE + div(track('rank (mu-T)*ONE', (mu - MU_T[lo]) * ONE), MU_T[lo + 1] - MU_T[lo]);
}
function halfLifeT(rank) {
  if (rank < 16n * ONE) return 15n * ONE;
  if (rank >= 30n * ONE) return 45n * ONE;
  return 15n * ONE + div(30n * (rank - 16n * ONE), 14n);
}
const CNUM_ONE = 6847202285n * ONE, PHI0_2 = PHI0 * PHI0;
function agedT({ mu, phi, last }, t) {
  if (phi === 0n) return PHI0_2;
  let dt = t - last;
  if (dt <= 0n) return track('phi*phi', phi * phi);
  if (dt > 1n << 30n) dt = 1n << 30n;
  const c = div(CNUM_ONE, halfLifeT(rankOfT(mu)));
  const v = phi * phi + div(track('c*c*dt', c * c * dt), 86400n);
  return v > PHI0_2 ? PHI0_2 : v;
}
function sideT(p, v, g, om, s, t) {
  const E = sigmoidT(div(track('g*(mu-opp)', g * (p.mu - om)), ONE));
  const info = div(div(track('g*g', g * g), ONE) * div(track('E*(1-E)', E * (ONE - E)), ONE), ONE);
  const v2 = div(ONE3, div(ONE3, v) + info);
  const delta = div(track('v2*g*(s-E)', div(track('v2*g', v2 * g), ONE2) * (s - E)), ONE);
  const phi = sqrt(v2);
  return { mu: p.mu + delta < MU_MIN ? MU_MIN : p.mu + delta > MU_MAX ? MU_MAX : p.mu + delta,
    phi: phi < MIN_PHI ? MIN_PHI : phi, last: p.last > t ? p.last : t, raw: p.mu + delta, v2 };
}
function updateT(b, w, result, t) {
  const vb = agedT(b, t), vw = agedT(w, t);
  const p = sigmoidT(div(track('g*(mub-muw) p', gOfT(vb + vw) * (b.mu - w.mu)), ONE));
  const s = BigInt(result) * ONE / 2n;
  return { black: sideT(b, vb, gOfT(vw), w.mu, s, t), white: sideT(w, vw, gOfT(vb), b.mu, ONE - s, t), p, vb, vw };
}

// ---------- float64 reference (offchain/ratings/systems.py's run_surround) ----------
const HL = rk => (rk < 16 ? 15 : rk >= 30 ? 45 : 15 + 30 * (rk - 16) / 14);
const muT = MU_T.map(f);
function rankF(mu) {
  if (mu <= muT[0]) return 0;
  if (mu >= muT[39]) return 39;
  let i = 0; while (muT[i + 1] <= mu) i++;
  return i + (mu - muT[i]) / (muT[i + 1] - muT[i]);
}
function updateF(b, w, result, t) {
  const var_ = x => {
    if (x.phi === 0) return 4;
    const dt = t - x.last;
    if (dt <= 0) return x.phi ** 2;
    const c = 1.15 * 2 * Math.LN2 / HL(rankF(x.mu));
    return Math.min(4, x.phi ** 2 + c * c * Math.min(dt, 2 ** 30) / 86400);
  };
  const g = v => 1 / Math.sqrt(1 + 3 * v / Math.PI ** 2);
  const vb = var_(b), vw = var_(w);
  const side = (m, v, gg, opp, s) => {
    const e = 1 / (1 + Math.exp(-gg * (m - opp)));
    const v2 = 1 / (1 / v + gg * gg * e * (1 - e));
    return { mu: Math.min(f(MU_MAX), Math.max(f(MU_MIN), m + v2 * gg * (s - e))), phi: Math.max(0.01, Math.sqrt(v2)) };
  };
  const s = result / 2;
  return { black: side(b.mu, vb, g(vw), w.mu, s), white: side(w.mu, vw, g(vb), b.mu, 1 - s),
    p: 1 / (1 + Math.exp(-g(vb + vw) * (b.mu - w.mu))) };
}

// ---------- random extreme states ----------
let seed = 0x9e3779b97f4a7c15n;
const rnd = () => { seed ^= seed << 13n; seed &= U64; seed ^= seed >> 7n; seed ^= seed << 17n; seed &= U64; return seed; };
const uni = () => Number(rnd() >> 11n) / 2 ** 53;
const pick = xs => xs[Number(rnd() % BigInt(xs.length))];
const range = (lo, hi) => lo + rnd() % (hi - lo + 1n);
function mu() {
  const k = uni();
  if (k < 0.15) return MU_MIN;
  if (k < 0.3) return MU_MAX;
  if (k < 0.4) return pick([MU_MIN + 1n, MU_MAX - 1n, 0n, ...MU_T.slice(0, 39), ...r.BAND_MU.slice(1)]);
  return range(MU_MIN, MU_MAX);
}
function phi() {
  const k = uni();
  if (k < 0.12) return 0n; // new player
  if (k < 0.3) return MIN_PHI;
  if (k < 0.4) return PHI0;
  if (k < 0.5) return pick([MIN_PHI + 1n, PHI0 - 1n, ONE, ONE + 1n, ONE / 10n]);
  return range(MIN_PHI, PHI0);
}
const T0 = 1_700_000_000n;
function times() {
  const last = pick([0n, 1n, T0, T0 * 3n, U64 - 1n, U64, range(0n, U64)]);
  const gap = pick([-1n, 0n, 1n, 60n, 86400n, 30n * 86400n, 365n * 86400n, 20n * 365n * 86400n, (1n << 30n) - 1n, 1n << 30n,
    (1n << 30n) + 1n, 100n * 365n * 86400n, range(0n, 1n << 40n), -range(0n, T0)]);
  let t = last + gap;
  if (t < 0n) t = 0n;
  if (t > U64) t = U64;
  return [last, t];
}
function state(last) {
  const p = phi();
  return p === 0n ? { mu: pick(r.BAND_MU.slice(1)), phi: 0n, last: 0n } : { mu: mu(), phi: p, last };
}

// ---------- run ----------
const fails = new Map();
const fail = (name, info) => { const e = fails.get(name) ?? { n: 0, ex: info }; e.n++; fails.set(name, e); };
let maxErrMu = 0, maxErrPhi = 0, maxErrP = 0, worstMu = null, maxDeltaMu = 0n;
let clampHits = { min: 0, max: 0 }, n = 0, maxCreate = 0n, maxDestroy = 0n;
for (let i = 0; i < N; i++) {
  const [lastB, t] = times();
  const lastW = uni() < 0.5 ? lastB : times()[0];
  const b = state(lastB), w = state(lastW);
  const result = Number(rnd() % 3n);
  const out = r.update(b, w, result, t);
  const ins = updateT(b, w, result, t);
  n++;
  for (const k of ['black', 'white'])
    for (const q of ['mu', 'phi', 'last'])
      if (out[k][q] !== ins[k][q]) fail('instrumented copy differs', { b, w, result, t });
  const sides = [[b, out.black, result, w, ins.black, ins.vb], [w, out.white, 2 - result, b, ins.white, ins.vw]];
  for (const [before, after, score, opp, raw, v] of sides) {
    const d = after.mu - before.mu;
    if (score === 2 && d < 0n) fail('winner mu decreased', { before, after, opp, t });
    if (score === 0 && d > 0n) fail('loser mu increased', { before, after, opp, t });
    if (score === 1 && before.mu < opp.mu && d < 0n) fail('draw: lower mu moved down', { before, after, opp });
    if (score === 1 && before.mu > opp.mu && d > 0n) fail('draw: higher mu moved up', { before, after, opp });
    if (after.mu < MU_MIN || after.mu > MU_MAX) fail('mu out of clamp', { after });
    if (after.phi < MIN_PHI || after.phi > PHI0) fail('phi out of [MIN_PHI, PHI0]', { after });
    // φ' ≤ aged φ (within the half-ulp of the nearest-integer sqrt).
    if (after.phi > sqrt(v) && after.phi > MIN_PHI) fail("phi' > aged phi", { before, after, v });
    if (after.last < before.last || after.last < t) fail('last moved back', { before, after, t });
    if (raw.raw < MU_MIN) clampHits.min++;
    if (raw.raw > MU_MAX) clampHits.max++;
    const ad = d < 0n ? -d : d;
    if (ad > maxDeltaMu) maxDeltaMu = ad;
  }
  if (out.p < 0n || out.p > ONE) fail('p out of [0,1]', { out });
  // A draw moves the two toward each other without swapping their order.
  if (result === 1 && (b.mu - w.mu) * (out.black.mu - out.white.mu) < 0n) fail('draw swapped the order', { b, w, out });
  // Zero-sum check (informational): how much μ the pair creates or destroys.
  const net = (out.black.mu - b.mu) + (out.white.mu - w.mu);
  if (net > 0n && net > maxCreate) maxCreate = net;
  if (net < 0n && -net > maxDestroy) maxDestroy = -net;
  // Float reference, where every time is representable (float t loses 1 s past 2^53).
  if (t < 1n << 53n && b.last < 1n << 53n && w.last < 1n << 53n) {
    const fb = { mu: f(b.mu), phi: f(b.phi), last: Number(b.last) }, fw = { mu: f(w.mu), phi: f(w.phi), last: Number(w.last) };
    const fo = updateF(fb, fw, result, Number(t));
    for (const [io, fl] of [[out.black, fo.black], [out.white, fo.white]]) {
      const em = Math.abs(f(io.mu) - fl.mu), ep = Math.abs(f(io.phi) - fl.phi);
      if (em > maxErrMu) { maxErrMu = em; worstMu = { b, w, result, t }; }
      if (ep > maxErrPhi) maxErrPhi = ep;
    }
    maxErrP = Math.max(maxErrP, Math.abs(f(out.p) - fo.p));
  }
}
console.log(`${n} fuzzed updates (${N} iterations)`);
console.log('property failures:', fails.size ? Object.fromEntries([...fails].map(([k, v]) => [k, { n: v.n, example: JSON.stringify(v.ex, (_, x) => typeof x === 'bigint' ? x.toString() : x) }])) : 'none');
console.log(`clamp hits: below 30k ${clampHits.min}, above 9d ${clampHits.max}; max |Δμ| ${f(maxDeltaMu).toFixed(4)} logits`);
console.log(`non-zero-sum: one game creates up to ${f(maxCreate).toFixed(3)} and destroys up to ${f(maxDestroy).toFixed(3)} logits of total μ`);
console.log(`int vs float64: max |Δμ| ${maxErrMu.toExponential(2)} (${(maxErrMu * 2 ** 32).toFixed(1)} ulp), max |Δφ| ${maxErrPhi.toExponential(2)}, max |Δp| ${maxErrP.toExponential(2)}`);
console.log('  worst μ case:', JSON.stringify(worstMu, (_, x) => typeof x === 'bigint' ? x.toString() : x));
console.log('max intermediate widths (bits; i128 holds 127):');
for (const [k, v] of [...widths].sort((a, b) => b[1].bits - a[1].bits)) console.log(`  ${String(v.bits).padStart(3)}  ${k}`);

// ---------- exp and sqrt accuracy ----------
let expErr = 0, expAt = 0n;
for (let x = 0n; x < 33n * 2977044472n; x += 1234567n) {
  const e = Number(r.expNeg(x)) - Math.exp(-f(x)) * 2 ** 32;
  if (Math.abs(e) > Math.abs(expErr)) { expErr = e; expAt = x; }
}
console.log(`expNeg: max error ${expErr.toFixed(3)} ulp at x = ${f(expAt).toFixed(6)} over [0, 33 ln2)`);
let sqrtBad = 0;
for (let i = 0; i < 200000; i++) {
  const x = range(0n, 1n << 70n), s = r.sqrt(x);
  // nearest: |s² − x| ≤ s (i.e. (s−½)² ≤ x < (s+½)²)
  if (x > 0n && !(4n * x >= (2n * s - 1n) ** 2n && 4n * x < (2n * s + 1n) ** 2n)) sqrtBad++;
}
console.log(`sqrt nearest-integer check: ${sqrtBad} failures in 200000`);
// Symmetry of the rounding: div(−n, d) = −div(n, d), ties to even.
let divBad = 0;
for (let i = 0; i < 200000; i++) {
  const d = range(1n, 1n << 40n), nn = range(0n, 1n << 90n);
  const q = r.div(nn, d);
  if (r.div(-nn, d) !== -q) divBad++;
  const lo = nn * 2n - q * 2n * d; // 2r − ... check |n − qd| ≤ d/2
  if (2n * (nn - q * d) > d || 2n * (q * d - nn) > d) divBad++;
}
console.log(`div round-half-even and sign symmetry: ${divBad} failures`);
