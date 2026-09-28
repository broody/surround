use crate::math::{self, MIN_PHI, MU_MAX, MU_MIN, ONE, PHI0, Rating};
use super::vectors;

#[test]
fn cases_match_the_reference() {
    for case in vectors::cases() {
        let (black, white, p) = math::update(case.black, case.white, case.result, case.t);
        assert_eq!(black, case.black_out);
        assert_eq!(white, case.white_out);
        assert_eq!(p, case.p);
    }
}

#[test]
fn sequence_matches_the_reference() {
    let mut players = array![];
    for band in vectors::bands() {
        players.append(math::start(*band).unwrap());
    }
    let mut players = players.span();
    for game in vectors::sequence() {
        let (black, white, p) = math::update(
            *players[game.black], *players[game.white], game.result, game.t,
        );
        assert_eq!(black, game.black_out);
        assert_eq!(white, game.white_out);
        assert_eq!(p, game.p);
        players = replace(replace(players, game.black, black), game.white, white);
    }
}

#[test]
fn ranks_match_the_reference() {
    for (mu, tenths) in vectors::ranks() {
        assert_eq!(math::rank_tenths(mu), tenths);
    }
}

#[test]
fn primitives() {
    assert_eq!(math::div(5, 2), 2);
    assert_eq!(math::div(7, 2), 4);
    assert_eq!(math::div(-5, 2), -2);
    assert_eq!(math::div(-7, 2), -4);
    assert_eq!(math::div(11, 3), 4);
    assert_eq!(math::sqrt(6), 2);
    assert_eq!(math::sqrt(7), 3);
    assert_eq!(math::sqrt(0), 0);
    assert_eq!(math::exp_neg(0), ONE);
    assert_eq!(math::exp_neg(23 * ONE), 0);
    assert_eq!(math::sigmoid(0), ONE / 2);
}

#[test]
fn bands() {
    assert!(math::start(0).is_none());
    assert!(math::start(5).is_none());
    // 23k, 17k, 6k (rating 1500) and 1k.
    assert_eq!(math::rank_tenths(math::start(1).unwrap().mu), 70);
    assert_eq!(math::rank_tenths(math::start(2).unwrap().mu), 130);
    assert_eq!(math::rank_tenths(math::start(3).unwrap().mu), 242);
    assert_eq!(math::rank_tenths(math::start(4).unwrap().mu), 290);
    assert_eq!(math::rank_tenths(MU_MIN), 0);
    assert_eq!(math::rank_tenths(MU_MAX), 389);
}

/// No state the contract can store, at any time, makes the update panic.
#[test]
fn extremes_never_panic() {
    let mus = array![MU_MIN, MU_MIN - 0x10000000000, -ONE, 0, ONE, MU_MAX, MU_MAX + 0x10000000000];
    let phis = array![0, MIN_PHI, ONE / 7, ONE, PHI0];
    let times: Array<u64> = array![0, 1_700_000_000, 0xffffffffffffffff];
    for mu in mus.span() {
        for phi in phis.span() {
            for last in times.span() {
                for t in times.span() {
                    for result in 0..3_u8 {
                        let a = Rating { mu: *mu, phi: *phi, last: *last };
                        let b = Rating { mu: -*mu, phi: PHI0 - *phi, last: 1_700_000_000 };
                        let (x, y, p) = math::update(a, b, result, *t);
                        assert!(
                            x.mu >= MU_MIN && x.mu <= MU_MAX && y.mu >= MU_MIN && y.mu <= MU_MAX,
                        );
                        assert!(
                            x.phi >= MIN_PHI && x.phi <= PHI0 && y.phi >= MIN_PHI && y.phi <= PHI0,
                        );
                        assert!(p >= 0 && p <= ONE);
                        assert!(x.last >= *last && x.last >= *t);
                    }
                }
            }
        }
    }
}

#[test]
fn provisional() {
    assert!(!math::provisional(ONE, 1, 1));
    assert!(math::provisional(ONE + 1, 1, 1));
    assert!(math::provisional(ONE / 2, 3, 0));
    assert!(math::provisional(ONE / 2, 0, 3));
}

fn replace(players: Span<Rating>, index: u32, rating: Rating) -> Span<Rating> {
    let mut out = array![];
    for i in 0..players.len() {
        out.append(if i == index {
            rating
        } else {
            *players[i]
        });
    }
    out.span()
}
