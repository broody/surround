//! Go's rating rules for `arbiter_ratings`: one pool for every board size,
//! OGS's rank scale shown as kyu/dan, KGS's rank-dependent aging, and
//! starting bands at 23k, 17k, 6k and 1k (RANKING_PLAN.md).
use arbiter_ratings::math::{ONE, div, quot};
use arbiter_ratings::{Pool, RatingRules, drift_of};

/// Surround's one pool: 9×9, 13×13 and 19×19 share a rating.
pub const GO: felt252 = 'go';
/// New-player deviation, 2.0.
pub const PHI0: i128 = 0x200000000;
/// Deviation floor, 0.01.
pub const MIN_PHI: i128 = 42949673;
/// A rank shows "?" while φ is above 1.0.
pub const PROVISIONAL_PHI: i128 = ONE;
/// An anchor's fixed deviation, 0.25: an engine at a fixed strength.
pub const ANCHOR_PHI: i128 = 0x40000000;
/// μ at OGS ranks 0 (30k) to 39: round((525·e^(r/23.15) − 1500) / 173.7178 · 2^32).
pub const MU_T: [i128; 40] = [
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
/// Games shorter than this, in steps, are void, except onchain forfeits, which
/// only the loser's rating feels (a stale anchor may hide their length).
pub const MIN_RATED_STEPS: u32 = 20;
/// The ends of the μ an anchor may be pinned at: 30k and the top of 9d.
pub const ANCHOR_MU_MIN: i128 = -24105722693;
pub const ANCHOR_MU_MAX: i128 = 32884882086;
/// Version of the rating constants that last updated a player.
pub const PARAMS: u8 = 2;

pub fn go_pool() -> Pool {
    Pool {
        phi0: PHI0,
        min_phi: MIN_PHI,
        mu_min: MU_MIN,
        mu_max: MU_MAX,
        provisional_phi: PROVISIONAL_PHI,
        settled_games: SETTLED_GAMES,
        min_steps: MIN_RATED_STEPS,
        anchor_phi: ANCHOR_PHI,
        anchor_mu_min: ANCHOR_MU_MIN,
        anchor_mu_max: ANCHOR_MU_MAX,
        // Rank tenths: the whole scale, 30k to 9d.
        max_offset: 390,
    }
}

pub impl GoRatingRules of RatingRules {
    const TAG: felt252 = 'SURROUND';
    const VERSION: u8 = PARAMS;
    const REFEREE_RNG: bool = false;

    fn pool(pool: felt252) -> Option<Pool> {
        if pool == GO {
            Option::Some(go_pool())
        } else {
            Option::None
        }
    }

    /// 1 (23k), 2 (17k), 3 (1500, about 6k) or 4 (1k).
    fn start(pool: felt252, band: u8) -> Option<i128> {
        match band {
            1 => Option::Some(*MU_T.span()[7]),
            2 => Option::Some(*MU_T.span()[13]),
            3 => Option::Some(0),
            4 => Option::Some(*MU_T.span()[29]),
            _ => Option::None,
        }
    }

    /// KGS's aging: c = 1.15·2·ln 2 / half_life, the half-life by rank.
    fn drift(pool: felt252, mu: i128) -> i128 {
        drift_of(half_life(rank_of(mu)))
    }

    fn shown(pool: felt252, mu: i128, offset: i32) -> u16 {
        shown_tenths(mu, offset)
    }
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
