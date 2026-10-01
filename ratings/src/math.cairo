//! Surround's rating update in Q32.32 fixed point (x / 2^32), integer only. It
//! mirrors offchain/sdk/src/rating.mjs bit for bit (tests/vectors.cairo).
//!
//! Glicko-2's update, one game at a time, without the volatility step:
//! deviation grows with idle time instead (`c = 1.15·2·ln 2 / half_life`, KGS's
//! half-lives), the opponent's deviation is aged too, and μ stays within OGS's
//! ratings 100 to 3500 (ranks show 30k to 9d).
//! Values are logits on Glicko-2's μ scale; variances are Q64 so aging needs no
//! square root. Every division rounds half to even: truncation would bias
//! ratings downward over millions of updates. Intermediates stay below 2^99, so
//! i128 never overflows for any stored state.
use core::num::traits::Sqrt;

pub const ONE: i128 = 0x100000000;
const ONE2: i128 = 0x10000000000000000;
const ONE3: i128 = 0x1000000000000000000000000;
const DAY: i128 = 86400;
/// New-player deviation, 2.0.
pub const PHI0: i128 = 0x200000000;
const PHI0_2: i128 = 0x40000000000000000;
/// Deviation floor, 0.01.
pub const MIN_PHI: i128 = 42949673;
/// A rank shows "?" while φ is above 1.0.
pub const PROVISIONAL_PHI: i128 = ONE;
/// An anchor's fixed deviation, 0.25: an engine at a fixed strength.
pub const ANCHOR_PHI: i128 = 0x40000000;
const LN2: i128 = 2977044472;
const PI2: i128 = 42389628127;
/// 1.15·2·ln 2, scaled by 2^64: the drift is c = CNUM_ONE / half_life (Q).
const CNUM_ONE: i128 = 29408509883171471360;
/// Idle seconds past which aging stops adding (long after the φ0 cap).
const MAX_IDLE: i128 = 0x40000000;
const EXP_STEP: i128 = 0x10000000;
const EXP_CUT: i128 = 33;
const EXP_TERMS: i128 = 6;

/// μ at OGS ranks 0 (30k) to 39: round((525·e^(r/23.15) − 1500) / 173.7178 · 2^32).
const MU_T: [i128; 40] = [
    -24105722693, -23532745119, -22934474543, -22309794451, -21657539046, -20976491070,
    -20265379527, -19522877321, -18747598769, -17938097022, -17092861362, -16210314385,
    -15288809052, -14326625622, -13321968437, -12272962575, -11177650347, -10033987647, -8839840137,
    -7592979259, -6291078083, -4931706959, -3512328987, -2030295279, -482840015, 1132924713,
    2820014298, 4581577238, 6420901018, 8341418243, 10346713043, 12440527761, 14626769941,
    16909519618, 19293036930, 21781770074, 24380363601, 27093667090, 29926744192, 32884882086,
];
/// Stored μ stays within OGS's ratings 100 and 3500, well past the ranks shown
/// (30k to 9d), so a player losing on purpose at the bottom keeps losing μ
/// and the clamp adds no inflation: round((rating − 1500) / 173.7178 · 2^32).
pub const MU_MIN: i128 = -34613345405;
pub const MU_MAX: i128 = 49447636293;
/// A player counts as settled (their queue games against other settled
/// players move their peak) from this many games, with aged φ at most
/// `PROVISIONAL_PHI`.
pub const SETTLED_GAMES: u32 = 10;
/// e^(−j/16) for j = 0…11.
const EXP_T: [i128; 12] = [
    4294967296, 4034748382, 3790295335, 3560652950, 3344923893, 3142265200, 2951884975, 2773039306,
    2605029347, 2447198598, 2298930330, 2159645183,
];
const POW2: [i128; 33] = [
    1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072,
    262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216, 33554432, 67108864, 134217728,
    268435456, 536870912, 1073741824, 2147483648, 4294967296,
];

/// A player's rating state.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct Rating {
    /// μ, Q.
    pub mu: i128,
    /// φ, Q; zero for a player never rated.
    pub phi: i128,
    /// When the player last played, in seconds.
    pub last: u64,
}

/// A new player's state for a starting band: 1 (23k), 2 (17k), 3 (1500, about
/// 6k) or 4 (1k). φ = 0 marks it as never rated.
pub fn start(band: u8) -> Option<Rating> {
    let mu = match band {
        0 => { return Option::None; },
        1 => *MU_T.span()[7],
        2 => *MU_T.span()[13],
        3 => 0,
        4 => *MU_T.span()[29],
        _ => { return Option::None; },
    };
    Option::Some(Rating { mu, phi: 0, last: 0 })
}

/// One rated game. `result` is black's score in half points: 2 black won, 1
/// draw, 0 white won. `t` is the game's time. Returns both new states and
/// P(black wins) before the game (Q).
pub fn update(black: Rating, white: Rating, result: u8, t: u64) -> (Rating, Rating, i128) {
    let vb = variance(black, t);
    let vw = variance(white, t);
    let p = sigmoid(div(g_of(vb + vw) * (black.mu - white.mu), ONE));
    let (black, white) = sides(black, white, vb, vw, result, t);
    (black, white, p)
}

/// `update` without P(black wins), which the contract doesn't need.
pub fn update_states(black: Rating, white: Rating, result: u8, t: u64) -> (Rating, Rating) {
    sides(black, white, variance(black, t), variance(white, t), result, t)
}

fn sides(black: Rating, white: Rating, vb: i128, vw: i128, result: u8, t: u64) -> (Rating, Rating) {
    let s = match result {
        0 => 0,
        1 => ONE / 2,
        _ => ONE,
    };
    (side(black, vb, g_of(vw), white.mu, s, t), side(white, vw, g_of(vb), black.mu, ONE - s, t))
}

/// A rated player's state aged to `t` without a game: φ grows as it would for
/// a game at `t`, and the clock moves to `t`. For the side of a game that
/// doesn't count for it.
pub fn age(player: Rating, t: u64) -> Rating {
    Rating {
        mu: player.mu,
        phi: aged_phi(player, t),
        last: if player.last > t {
            player.last
        } else {
            t
        },
    }
}

/// φ aged to `t`, as a game at `t` would use it; φ0 for a player never rated.
pub fn aged_phi(player: Rating, t: u64) -> i128 {
    sqrt(variance(player, t))
}

/// Settled: enough games, and aged φ no more than `PROVISIONAL_PHI`.
pub fn settled(player: Rating, games: u32, t: u64) -> bool {
    games >= SETTLED_GAMES && aged_phi(player, t) <= PROVISIONAL_PHI
}

/// Rank on OGS's scale in tenths: 0 is 30k, 300 is 1d.
pub fn rank_tenths(mu: i128) -> u16 {
    shown_tenths(mu, 0)
}

/// The rank shown, in tenths: μ's rank shifted by `offset` tenths, then held to
/// 30k..9d (0..389). The offset applies before the hold, so it moves players
/// beyond the ends too.
pub fn shown_tenths(mu: i128, offset: i32) -> u16 {
    let scaled = raw_rank(mu) * 10;
    // Floor, for ranks below 30k too.
    let tenths = if scaled >= 0 {
        quot(scaled, ONE)
    } else {
        -quot(-scaled + ONE - 1, ONE)
    }
        + offset.into();
    if tenths < 0 {
        0
    } else if tenths > 389 {
        389
    } else {
        tenths.try_into().unwrap()
    }
}

/// Rank on OGS's scale (Q), extended past 30k and 9d along the end segments.
fn raw_rank(mu: i128) -> i128 {
    let table = MU_T.span();
    if mu < *table[0] {
        return div((mu - *table[0]) * ONE, *table[1] - *table[0]);
    }
    if mu > *table[39] {
        return 39 * ONE + div((mu - *table[39]) * ONE, *table[39] - *table[38]);
    }
    rank_of(mu)
}

/// "?" while φ is above 1.0 or the player lacks a win or a loss.
pub fn provisional(phi: i128, wins: u32, losses: u32) -> bool {
    phi > PROVISIONAL_PHI || wins == 0 || losses == 0
}

/// Rank on OGS's scale (Q), linear between whole ranks.
pub fn rank_of(mu: i128) -> i128 {
    let table = MU_T.span();
    if mu <= *table[0] {
        return 0;
    }
    if mu >= *table[39] {
        return 39 * ONE;
    }
    // The first segment i with MU_T[i + 1] > μ.
    let mut lo: u32 = 0;
    let mut hi: u32 = 38;
    while lo < hi {
        let mid = (lo + hi) / 2;
        if *table[mid + 1] > mu {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    let base: i128 = lo.into();
    base * ONE + div((mu - *table[lo]) * ONE, *table[lo + 1] - *table[lo])
}

/// n / d rounded half to even, for d > 0. Symmetric in the sign of n.
pub fn div(n: i128, d: i128) -> i128 {
    if n < 0 {
        return -div(-n, d);
    }
    let n: u128 = n.try_into().unwrap();
    let d: u128 = d.try_into().unwrap();
    let (q, r) = DivRem::div_rem(n, d.try_into().unwrap());
    let r2 = r + r;
    let q = if r2 > d || (r2 == d && q % 2 == 1) {
        q + 1
    } else {
        q
    };
    q.try_into().unwrap()
}

/// The nearest integer to √n.
pub fn sqrt(n: i128) -> i128 {
    if n <= 0 {
        return 0;
    }
    let n: u128 = n.try_into().unwrap();
    let s: u128 = n.sqrt().into();
    let s = if n - s * s > s {
        s + 1
    } else {
        s
    };
    s.try_into().unwrap()
}

/// e^(−x) for x ≥ 0: x = n·ln 2 + r and e^(−r) = T[j]·e^(−u), u < 1/16, by Horner.
pub fn exp_neg(x: i128) -> i128 {
    let n = quot(x, LN2);
    if n >= EXP_CUT {
        return 0;
    }
    let r = x - n * LN2;
    let j = quot(r, EXP_STEP);
    let u = r - j * EXP_STEP;
    let mut acc = ONE;
    let mut k = EXP_TERMS;
    while k > 0 {
        acc = ONE - div(u * acc, ONE * k);
        k -= 1;
    }
    let j: u32 = j.try_into().unwrap();
    let e = div(*EXP_T.span()[j] * acc, ONE);
    if n == 0 {
        e
    } else {
        let n: u32 = n.try_into().unwrap();
        div(e, *POW2.span()[n])
    }
}

/// 1 / (1 + e^(−z)), Q.
pub fn sigmoid(z: i128) -> i128 {
    if z >= 0 {
        div(ONE2, ONE + exp_neg(z))
    } else {
        let e = exp_neg(-z);
        div(e * ONE, ONE + e)
    }
}

/// Floor of n / d for n ≥ 0 and d > 0.
fn quot(n: i128, d: i128) -> i128 {
    let n: u128 = n.try_into().unwrap();
    let d: u128 = d.try_into().unwrap();
    (n / d).try_into().unwrap()
}

/// g = 1/√(1 + 3·var/π²) for a Q64 variance.
fn g_of(variance: i128) -> i128 {
    sqrt(div(ONE3, ONE + div(3 * variance, PI2)))
}

/// Days' half-life (Q) at a rank: 15 below 15k, rising to 45 at 1d.
fn half_life(rank: i128) -> i128 {
    if rank < 16 * ONE {
        15 * ONE
    } else if rank >= 30 * ONE {
        45 * ONE
    } else {
        15 * ONE + div(30 * (rank - 16 * ONE), 14)
    }
}

/// The variance a player brings to a game at `t`: φ0² for a new player,
/// otherwise min(φ0², φ² + c(rank)²·idle days).
fn variance(player: Rating, t: u64) -> i128 {
    if player.phi == 0 {
        return PHI0_2;
    }
    let base = player.phi * player.phi;
    if t <= player.last {
        return base;
    }
    let mut dt: i128 = (t - player.last).into();
    if dt > MAX_IDLE {
        dt = MAX_IDLE;
    }
    let c = div(CNUM_ONE, half_life(rank_of(player.mu)));
    let aged = base + div(c * c * dt, DAY);
    if aged > PHI0_2 {
        PHI0_2
    } else {
        aged
    }
}

fn side(player: Rating, variance: i128, g: i128, opponent_mu: i128, s: i128, t: u64) -> Rating {
    let e = sigmoid(div(g * (player.mu - opponent_mu), ONE));
    // g²E(1 − E), the game's information.
    let info = div(div(g * g, ONE) * div(e * (ONE - e), ONE), ONE);
    // φ'², Q64.
    let v2 = div(ONE3, div(ONE3, variance) + info);
    // φ'²·g·(s − E).
    let delta = div(div(v2 * g, ONE2) * (s - e), ONE);
    let phi = sqrt(v2);
    Rating {
        mu: clamp(player.mu + delta),
        phi: if phi < MIN_PHI {
            MIN_PHI
        } else {
            phi
        },
        last: if player.last > t {
            player.last
        } else {
            t
        },
    }
}

fn clamp(mu: i128) -> i128 {
    if mu < MU_MIN {
        MU_MIN
    } else if mu > MU_MAX {
        MU_MAX
    } else {
        mu
    }
}
