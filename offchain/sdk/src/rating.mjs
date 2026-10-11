// Surround's rating update, integer-only, exactly as `SurroundRatings`
// (ratings/) computes it: arbiter's engine (`@arbiter/sdk/ratings`, the mirror
// of `arbiter_ratings`) with Go's rules, `GO_RULES` (the mirror of
// `GoRatingRules` in ratings/src/rules.cairo). It is the reference for the
// Cairo vectors (offchain/generate-rating-vectors.mjs) and replays every rating
// from the contract's events (replay.mjs). See RANKING_PLAN.md for the model
// and its calibration.
//
// Values are Q32.32 fixed point (x / 2^32) in logits, Glicko-2's μ scale.
// Variances are Q64 so that aging needs no square root. Every division rounds
// half to even: truncation biases ratings downward over millions of updates.
//
// The functions below the rules keep Surround's own signatures, black (seat 0)
// then white, in the one pool every board size shares.
import * as engine from '@arbiter/sdk/ratings';
import { tag } from '@arbiter/sdk';

export const { ONE, div, sqrt, expNeg, sigmoid, driftOf } = engine;

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
/** Games before a player can count as settled (`rules::SETTLED_GAMES`). */
export const SETTLED_GAMES = 10;
/** Games shorter than this are void unless forfeited onchain (`rules::MIN_RATED_STEPS`). */
export const MIN_RATED_STEPS = 20;
/** The version of these constants (`GoRatingRules::VERSION`, a player's `params`). */
export const PARAMS = 2;
/** Starting μ of the four bands: 23k, 17k, 1500 (≈6k) and 1k. */
export const BAND_MU = [null, MU_T[7], MU_T[13], 0n, MU_T[29]];
export const BANDS = 4;

export const PHI0 = 2n * ONE;                 // new-player deviation, 2.0
export const MIN_PHI = 42949673n;             // 0.01
export const PROVISIONAL_PHI = ONE;           // "?" above 1.0
export const ANCHOR_PHI = ONE / 4n;           // an anchor's fixed deviation, 0.25
/** The ends of the μ an anchor may be pinned at: 30k and the top of 9d. */
export const ANCHOR_MU_MIN = MU_T[0], ANCHOR_MU_MAX = MU_T[39];
/** The largest rank offset the owner may set, in tenths: the whole scale, 30k to 9d. */
export const MAX_OFFSET = 390;

/** Surround's one pool: 9×9, 13×13 and 19×19 share a rating. */
export const GO = 'go';
const GO_ID = tag(GO);
/** The 'go' pool's constants (`rules::go_pool`), as `@arbiter/sdk/ratings` takes them. */
export const GO_POOL = Object.freeze({
  phi0: PHI0, minPhi: MIN_PHI, muMin: MU_MIN, muMax: MU_MAX, provisionalPhi: PROVISIONAL_PHI,
  settledGames: SETTLED_GAMES, minSteps: MIN_RATED_STEPS, anchorPhi: ANCHOR_PHI, anchorMuMin: ANCHOR_MU_MIN,
  anchorMuMax: ANCHOR_MU_MAX, maxOffset: MAX_OFFSET,
});

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
 * The rank shown, in tenths (`rules::shown_tenths`): μ's rank plus `offset`
 * tenths, held to 30k..9d (0..389). The offset applies before the hold.
 */
export function shownTenths(mu, offset = 0) {
  const tenths = Number(floorDiv(rawRank(BigInt(mu)) * 10n, ONE)) + Number(offset);
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

/**
 * Go's `RatingRules` (`GoRatingRules`), as `@arbiter/sdk/ratings` takes them:
 * one pool, 'go'; bands 1 (23k), 2 (17k), 3 (1500, about 6k) and 4 (1k);
 * KGS's aging, c = 1.15·2·ln 2 / half-life with the half-life by rank; and
 * ranks shown in tenths.
 */
export const GO_RULES = Object.freeze({
  tag: 'SURROUND',
  version: PARAMS,
  refereeRng: false,
  pool: id => (BigInt(id) === GO_ID ? GO_POOL : null),
  // Every pool id, as the Cairo matches only the band.
  start: (id, band) => (Number.isInteger(band) && band >= 1 && band <= BANDS ? BAND_MU[band] : null),
  drift: (id, mu) => driftOf(halfLife(rankOf(BigInt(mu)))),
  shown: (id, mu, offset) => shownTenths(mu, offset),
});

/** A new player's state for a starting band (1–4). φ = 0 marks "never rated". */
export function start(band) {
  const state = engine.start(GO_RULES, GO, band);
  if (state === null) throw Error(`invalid band ${band}`);
  return state;
}

/**
 * One rated game. `black`/`white` are { mu, phi, last } (φ = 0: new, μ its
 * band's start); `result` is black's score in half points: 2 black won, 1 draw,
 * 0 white won; `t` the game's time in seconds. Returns the new states and
 * P(black wins) before the game, all Q.
 */
export function update(black, white, result, t) {
  const { a, b, p } = engine.update(GO_RULES, GO, black, white, result, t);
  return { black: a, white: b, p };
}

/** An anchor as a game at `t` sees it: its pinned μ, never aged. */
export const anchorRating = (mu, t) => engine.anchorRating(GO_RULES, GO, mu, t);

/** "?" while φ > 1.0 or the player lacks a win or a loss. */
export const provisional = ({ phi, wins, losses }) => engine.provisional(GO_POOL, phi, wins, losses);

/** φ aged to `t`, as a game at `t` would use it; φ0 for a player never rated (`math::aged_phi`). */
export const agedPhi = (player, t) => engine.agedPhi(GO_RULES, GO, player, t);

/** A rated player aged to `t` without a game (`math::age`): the side a game doesn't count for. */
export const age = (player, t) => engine.age(GO_RULES, GO, player, t);

/** Settled: `SETTLED_GAMES` games or more and aged φ at most 1.0 (`math::settled`). */
export const settled = (player, games, t) => engine.settled(GO_RULES, GO, player, games, t);
