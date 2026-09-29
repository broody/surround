//! Audit fuzz tests for surround_ratings::math. Run with
//! `~/.asdf/shims/snforge test` in this directory (the PATH snforge is stale).
//! Random u64/u128 inputs are folded onto storable states: μ in [30k, 9d],
//! φ in {new} ∪ [0.01, 2.0], any u64 times.
#[cfg(test)]
mod tests {
    use surround_ratings::math::{self, MIN_PHI, MU_MAX, MU_MIN, ONE, PHI0, Rating};

    fn mu_of(x: u128) -> i128 {
        let span: u128 = (MU_MAX - MU_MIN + 1).try_into().unwrap();
        match x % 5 {
            0 => MU_MIN,
            1 => MU_MAX,
            _ => MU_MIN + ((x / 5) % span).try_into().unwrap(),
        }
    }

    fn phi_of(x: u128) -> i128 {
        let span: u128 = (PHI0 - MIN_PHI + 1).try_into().unwrap();
        match x % 6 {
            0 => 0,
            1 => MIN_PHI,
            2 => PHI0,
            _ => MIN_PHI + ((x / 6) % span).try_into().unwrap(),
        }
    }

    fn player(m: u128, p: u128, last: u64, band: u8) -> Rating {
        let phi = phi_of(p);
        if phi == 0 {
            math::start(1 + band % 4).unwrap()
        } else {
            Rating { mu: mu_of(m), phi, last }
        }
    }

    fn check_side(before: Rating, after: Rating, score: u8, opponent_mu: i128, t: u64) {
        let d = after.mu - before.mu;
        if score == 2 {
            assert!(d >= 0, "winner lost mu");
        } else if score == 0 {
            assert!(d <= 0, "loser gained mu");
        } else if before.mu < opponent_mu {
            assert!(d >= 0, "draw moved the lower player down");
        } else if before.mu > opponent_mu {
            assert!(d <= 0, "draw moved the higher player up");
        }
        assert!(after.mu >= MU_MIN && after.mu <= MU_MAX, "mu out of clamp");
        assert!(after.phi >= MIN_PHI && after.phi <= PHI0, "phi out of range");
        assert!(after.last >= before.last && after.last >= t, "clock moved back");
        // |Δμ| ≤ φ0²·g·1 < 4 logits.
        assert!(d < 4 * ONE && d > -4 * ONE, "step too large");
    }

    #[test]
    #[fuzzer(runs: 3000, seed: 20260928)]
    fn update_properties(
        bm: u128, bp: u128, wm: u128, wp: u128, bl: u64, wl: u64, t: u64, result: u8, band: u8,
    ) {
        let result = result % 3;
        let black = player(bm, bp, bl, band);
        let white = player(wm, wp, wl, band / 4);
        let (b, w, p) = math::update(black, white, result, t);
        check_side(black, b, result, white.mu, t);
        check_side(white, w, 2 - result, black.mu, t);
        assert!(p >= 0 && p <= ONE, "p out of range");
    }

    /// Aging: φ after a game never exceeds the aged φ, and more idle time
    /// never lowers it (monotone), capped at φ0.
    #[test]
    #[fuzzer(runs: 3000, seed: 7)]
    fn aging_is_monotone_and_capped(m: u128, p: u128, om: u128, last: u64, gap: u64, extra: u64) {
        let mut phi = phi_of(p);
        if phi == 0 {
            phi = MIN_PHI;
        }
        let me = Rating { mu: mu_of(m), phi, last: last / 2 };
        let opp = Rating { mu: mu_of(om), phi: ONE, last: last / 2 };
        let t1 = me.last + gap / 4;
        let t2 = t1 + extra / 4;
        // Same result against the same opponent: a longer layoff can only leave
        // φ' higher or equal (more uncertainty in, more out).
        let (a, _, _) = math::update(me, opp, 1, t1);
        let (b, _, _) = math::update(me, opp, 1, t2);
        assert!(b.phi >= a.phi, "aging not monotone");
        assert!(b.phi <= PHI0, "aging above phi0");
    }

    /// Winning is always better than drawing, which is better than losing.
    #[test]
    #[fuzzer(runs: 3000, seed: 11)]
    fn results_are_ordered(bm: u128, bp: u128, wm: u128, wp: u128, bl: u64, wl: u64, t: u64) {
        let black = player(bm, bp, bl, 2);
        let white = player(wm, wp, wl, 1);
        let (b0, w0, _) = math::update(black, white, 0, t);
        let (b1, w1, _) = math::update(black, white, 1, t);
        let (b2, w2, _) = math::update(black, white, 2, t);
        assert!(b0.mu <= b1.mu && b1.mu <= b2.mu, "black not ordered");
        assert!(w0.mu >= w1.mu && w1.mu >= w2.mu, "white not ordered");
        assert!(b0.phi == b1.phi && b1.phi == b2.phi, "phi depends on the result");
    }
}
