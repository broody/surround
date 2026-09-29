// Surround's rating update, integer-only, exactly as `SurroundRatings`
// (ratings/) computes it. It is the reference for the Cairo vectors
// (offchain/generate-rating-vectors.mjs) and replays every rating from the
// contract's events. See RANKING_PLAN.md for the model and its calibration.
//
// Values are Q32.32 fixed point (x / 2^32) in logits, Glicko-2's μ scale.
// Variances are Q64 so that aging needs no square root. Every division rounds
// half to even: truncation biases ratings downward over millions of updates.

export const ONE = 1n << 32n;
const ONE2 = ONE * ONE, ONE3 = ONE2 * ONE;
const DAY = 86400n;

/** μ at each OGS rank 0 (30k) … 39, Q: round((525·e^(r/23.15) − 1500) / 173.7178 · 2^32). */
export const MU_T = [
  -24105722693n, -23532745119n, -22934474543n, -22309794451n, -21657539046n, -20976491070n,
  -20265379527n, -19522877321n, -18747598769n, -17938097022n, -17092861362n, -16210314385n,
  -15288809052n, -14326625622n, -13321968437n, -12272962575n, -11177650347n, -10033987647n,
  -8839840137n, -7592979259n, -6291078083n, -4931706959n, -3512328987n, -2030295279n,
  -482840015n, 1132924713n, 2820014298n, 4581577238n, 6420901018n, 8341418243n,
  10346713043n, 12440527761n, 14626769941n, 16909519618n, 19293036930n, 21781770074n,
  24380363601n, 27093667090n, 29926744192n, 32884882086n,
];
/**
 * Stored μ stays within OGS's ratings 100 and 3500, well past the ranks shown
 * (30k to 9d): round((rating − 1500) / 173.7178 · 2^32).
 */
export const MU_MIN = -34613345405n, MU_MAX = 49447636293n;
/** Games before a player can count as settled (`math::SETTLED_GAMES`). */
export const SETTLED_GAMES = 10;
/** The version of these constants (`ratings::PARAMS`). */
export const PARAMS = 2;
/** Starting μ of the four bands: 23k, 17k, 1500 (≈6k) and 1k. */
export const BAND_MU = [null, MU_T[7], MU_T[13], 0n, MU_T[29]];
export const BANDS = 4;

export const PHI0 = 2n * ONE;                 // new-player deviation, 2.0
const PHI0_2 = PHI0 * PHI0;                   // Q64
export const MIN_PHI = 42949673n;             // 0.01
export const PROVISIONAL_PHI = ONE;           // "?" above 1.0
const LN2 = 2977044472n;                      // ln 2
const PI2 = 42389628127n;                     // π²
const CNUM_ONE = 6847202285n * ONE;           // 1.15·2·ln 2, pre-scaled: c = CNUM_ONE / half_life
const MAX_IDLE = 1n << 30n;                   // seconds; far past the φ0 cap, bounds c²·dt
const EXP_STEP = ONE / 16n;
/** e^(−j/16) for j = 0…11, Q. */
const EXP_T = [4294967296n, 4034748382n, 3790295335n, 3560652950n, 3344923893n, 3142265200n,
  2951884975n, 2773039306n, 2605029347n, 2447198598n, 2298930330n, 2159645183n];
const EXP_CUT = 33n;                          // e^(−x) rounds to 0 once x ≥ 33·ln 2
const EXP_TERMS = 6n;

/** n / d rounded half to even, d > 0. Symmetric in the sign of n. */
export function div(n, d) {
  if (n < 0n) return -div(-n, d);
  const q = n / d, r = n % d, r2 = r + r;
  return r2 > d || (r2 === d && (q & 1n)) ? q + 1n : q;
}

/** Nearest integer to √n: floor square root, plus one when n − r² > r. */
export function sqrt(n) {
  if (n <= 0n) return 0n;
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  return n - x * x > x ? x + 1n : x;
}

/** e^(−x) for x ≥ 0: x = n·ln 2 + r, e^(−r) = T[j]·e^(−u) with u < 1/16 by Horner. */
export function expNeg(x) {
  const n = x / LN2;
  if (n >= EXP_CUT) return 0n;
  const r = x - n * LN2, j = r / EXP_STEP, u = r - j * EXP_STEP;
  let acc = ONE;
  for (let k = EXP_TERMS; k > 0n; k--) acc = ONE - div(u * acc, ONE * k);
  const e = div(EXP_T[Number(j)] * acc, ONE);
  return n ? div(e, 1n << n) : e;
}

/** 1 / (1 + e^(−z)), Q. */
export function sigmoid(z) {
  if (z >= 0n) return div(ONE2, ONE + expNeg(z));
  const e = expNeg(-z);
  return div(e * ONE, ONE + e);
}

/** g = 1/√(1 + 3·var/π²) for a Q64 variance, Q. */
const gOf = variance => sqrt(div(ONE3, ONE + div(3n * variance, PI2)));

/** Rank on OGS's scale, Q: 0 = 30k, 30 = 1d; linear between whole ranks. */
export function rankOf(mu) {
  if (mu <= MU_T[0]) return 0n;
  if (mu >= MU_T[39]) return 39n * ONE;
  let lo = 0, hi = 38;
  while (lo < hi) { // first segment i with MU_T[i + 1] > mu
    const mid = (lo + hi) >> 1;
    if (MU_T[mid + 1] > mu) hi = mid; else lo = mid + 1;
  }
  return BigInt(lo) * ONE + div((mu - MU_T[lo]) * ONE, MU_T[lo + 1] - MU_T[lo]);
}

/** Rank on OGS's scale, Q, extended past 30k and 9d along the end segments. */
function rawRank(mu) {
  if (mu < MU_T[0]) return div((mu - MU_T[0]) * ONE, MU_T[1] - MU_T[0]);
  if (mu > MU_T[39]) return 39n * ONE + div((mu - MU_T[39]) * ONE, MU_T[39] - MU_T[38]);
  return rankOf(mu);
}
const floorDiv = (n, d) => (n >= 0n ? n / d : -((-n + d - 1n) / d));

/**
 * The rank shown, in tenths (`math::shown_tenths`): μ's rank plus `offset`
 * tenths, held to 30k..9d (0..389). The offset applies before the hold.
 */
export function shownTenths(mu, offset = 0) {
  const tenths = Number(floorDiv(rawRank(mu) * 10n, ONE)) + offset;
  return Math.min(389, Math.max(0, tenths));
}
/** Rank in tenths (0 = 30k, 300 = 1d) and its label, e.g. 245 → "6k". */
export const rankTenths = mu => shownTenths(mu, 0);
export const rankLabel = tenths => {
  const r = Math.floor(tenths / 10);
  return r < 30 ? `${30 - r}k` : `${r - 29}d`;
};

/** Days' half-life at a rank (Q): 15 below 15k, rising to 45 at 1d. */
function halfLife(rank) {
  if (rank < 16n * ONE) return 15n * ONE;
  if (rank >= 30n * ONE) return 45n * ONE;
  return 15n * ONE + div(30n * (rank - 16n * ONE), 14n);
}

/** Variance aged to `t`: min(φ0², φ² + c(rank)²·days). */
function agedVariance({ mu, phi, last }, t) {
  let dt = t - last;
  if (dt <= 0n) return phi * phi;
  if (dt > MAX_IDLE) dt = MAX_IDLE;
  const c = div(CNUM_ONE, halfLife(rankOf(mu)));
  const variance = phi * phi + div(c * c * dt, DAY);
  return variance > PHI0_2 ? PHI0_2 : variance;
}

const clamp = mu => (mu < MU_MIN ? MU_MIN : mu > MU_MAX ? MU_MAX : mu);

function side(player, variance, g, opponentMu, s, t) {
  const E = sigmoid(div(g * (player.mu - opponentMu), ONE));
  const info = div(div(g * g, ONE) * div(E * (ONE - E), ONE), ONE); // g²E(1−E)
  const v2 = div(ONE3, div(ONE3, variance) + info);                  // φ'², Q64
  const delta = div(div(v2 * g, ONE2) * (s - E), ONE);               // φ'²·g·(s − E)
  const phi = sqrt(v2);
  return { mu: clamp(player.mu + delta), phi: phi < MIN_PHI ? MIN_PHI : phi, last: player.last > t ? player.last : t };
}

/** A new player's state for a starting band (1–4). φ = 0 marks "never rated". */
export function start(band) {
  if (!(band >= 1 && band <= BANDS)) throw Error(`invalid band ${band}`);
  return { mu: BAND_MU[band], phi: 0n, last: 0n };
}

/**
 * One rated game. `black`/`white` are { mu, phi, last } (φ = 0: new, μ its
 * band's start); `result` is black's score in half points: 2 black won, 1 draw,
 * 0 white won; `t` the game's time in seconds. Returns the new states and
 * P(black wins) before the game, all Q.
 */
export function update(black, white, result, t) {
  const vb = black.phi === 0n ? PHI0_2 : agedVariance(black, t);
  const vw = white.phi === 0n ? PHI0_2 : agedVariance(white, t);
  const p = sigmoid(div(gOf(vb + vw) * (black.mu - white.mu), ONE));
  const s = BigInt(result) * ONE / 2n;
  return {
    black: side(black, vb, gOf(vw), white.mu, s, t),
    white: side(white, vw, gOf(vb), black.mu, ONE - s, t),
    p,
  };
}

/** "?" while φ > 1.0 or the player lacks a win or a loss. */
export const provisional = ({ phi, wins, losses }) => phi > PROVISIONAL_PHI || !wins || !losses;

/** φ aged to `t`, as a game at `t` would use it; φ0 for a player never rated (`math::aged_phi`). */
export const agedPhi = (player, t) => (player.phi === 0n ? PHI0 : sqrt(agedVariance(player, BigInt(t))));

/** A rated player aged to `t` without a game (`math::age`): the side a game doesn't count for. */
export const age = (player, t) => ({ mu: player.mu, phi: agedPhi(player, t), last: player.last > BigInt(t) ? player.last : BigInt(t) });

/** Settled: `SETTLED_GAMES` games or more and aged φ at most 1.0 (`math::settled`). */
export const settled = (player, games, t) => games >= SETTLED_GAMES && agedPhi(player, t) <= PROVISIONAL_PHI;
