//! The rating audit's parity checks (offchain/ratings/audit): the Cairo update
//! matches the SDK bit for bit on random extreme states and on a 400-game
//! career. Regenerate with `node offchain/ratings/audit/audit-vectors.mjs`.
use crate::math::{self, Rating};
use super::audit_vectors;

#[test]
#[available_gas(20000000000)]
fn random_extremes_match_the_sdk() {
    for (black, white, result, t, black_out, white_out, p) in audit_vectors::cases() {
        let (b, w, q) = math::update(black, white, result, t);
        assert_eq!(b, black_out);
        assert_eq!(w, white_out);
        assert_eq!(q, p);
    }
}

#[test]
#[available_gas(20000000000)]
fn a_long_career_matches_the_sdk() {
    let mut hero: Rating = audit_vectors::hero_start();
    for (opponent, result, t, after) in audit_vectors::hero() {
        let (b, _, _) = math::update(hero, opponent, result, t);
        assert_eq!(b, after);
        hero = b;
    }
}
