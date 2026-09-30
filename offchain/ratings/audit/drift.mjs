// Error accumulation: one player's career, integer (SDK = Cairo) vs float64,
// each evolving on its own over thousands of games, plus how much rounding
// alone would drift a player who should stand still.
//
//   node offchain/ratings/audit/drift.mjs
import * as r from '../../sdk/src/rating.mjs';

const { ONE, MU_MIN, MU_MAX, MIN_PHI, PHI0 } = r;
const f = x => Number(x) / 2 ** 32, q = x => BigInt(Math.round(x * 2 ** 32));
const HL = rk => (rk < 16 ? 15 : rk >= 30 ? 45 : 15 + 30 * (rk - 16) / 14);
const muT = r.MU_T.map(f);
const rankF = mu => { if (mu <= muT[0]) return 0; if (mu >= muT[39]) return 39; let i = 0; while (muT[i + 1] <= mu) i++; return i + (mu - muT[i]) / (muT[i + 1] - muT[i]); };
function stepF(me, opp, s, t) {
  const v = x => { if (x.phi === 0) return 4; const dt = t - x.last; if (dt <= 0) return x.phi ** 2;
    const c = 1.15 * 2 * Math.LN2 / HL(rankF(x.mu)); return Math.min(4, x.phi ** 2 + c * c * Math.min(dt, 2 ** 30) / 86400); };
  const g = w => 1 / Math.sqrt(1 + 3 * w / Math.PI ** 2);
  const vm = v(me), vo = v(opp), gg = g(vo);
  const e = 1 / (1 + Math.exp(-gg * (me.mu - opp.mu)));
  const v2 = 1 / (1 / vm + gg * gg * e * (1 - e));
  return { mu: Math.min(f(MU_MAX), Math.max(f(MU_MIN), me.mu + v2 * gg * (s - e))), phi: Math.max(0.01, Math.sqrt(v2)), last: Math.max(me.last, t) };
}

let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
for (const [label, games, gapDays, theta0] of [['10k games, daily', 10000, 1, 0.5], ['20k games, same second', 20000, 0, -3],
  ['5k games, weekly, at the 9d clamp', 5000, 7, 9]]) {
  let I = { mu: 0n, phi: 0n, last: 0n }, F = { mu: 0, phi: 0, last: 0 };
  let t = 1_700_000_000, maxDiff = 0;
  for (let i = 0; i < games; i++) {
    t += gapDays * 86400 * (0.5 + rnd());
    const oppMu = Math.max(f(MU_MIN), Math.min(f(MU_MAX), theta0 + (rnd() - 0.5) * 2));
    const oppPhi = 0.05 + rnd() * 1.5, oppLast = t - rnd() * 86400 * 10;
    const s = rnd() < 1 / (1 + Math.exp(-(theta0 - oppMu))) ? 2 : 0;
    const oI = { mu: q(oppMu), phi: q(oppPhi), last: BigInt(Math.floor(oppLast)) };
    I = r.update(I, oI, s, BigInt(Math.floor(t))).black;
    // The float player sees exactly the same opponent (its quantized state) and times.
    F = stepF(F, { mu: f(oI.mu), phi: f(oI.phi), last: Number(oI.last) }, s / 2, Math.floor(t));
    maxDiff = Math.max(maxDiff, Math.abs(f(I.mu) - F.mu));
  }
  console.log(`${label}: final μ int ${f(I.mu).toFixed(9)} float ${F.mu.toFixed(9)}; φ int ${f(I.phi).toFixed(6)} float ${F.phi.toFixed(6)}; max |Δμ| along the way ${maxDiff.toExponential(2)} logits`);
}

// A player facing an equal opponent and drawing forever should not move: any
// drift is rounding bias.
let P = { mu: -1234567891n, phi: ONE / 4n, last: 1_700_000_000n };
const O = { mu: -1234567891n, phi: ONE / 4n, last: 1_700_000_000n };
for (let i = 0; i < 100000; i++) P = r.update(P, { ...O, last: P.last }, 1, P.last + 3600n).black;
console.log(`100k draws with an equal opponent: μ moved ${P.mu - -1234567891n} ulp, φ ${f(P.phi).toFixed(6)}`);
// Win/loss alternation against an equal opponent: symmetric rounding keeps μ put.
P = { mu: 987654321n, phi: ONE / 4n, last: 1_700_000_000n };
for (let i = 0; i < 100000; i++) P = r.update(P, { mu: 987654321n, phi: ONE / 4n, last: P.last }, i % 2 ? 0 : 2, P.last + 3600n).black;
console.log(`100k alternating win/loss vs an equal opponent: μ ends ${f(P.mu - 987654321n).toExponential(3)} logits from start (the last step is a loss)`);
