//! Surround's ratings: `SurroundRatings`, a plain Starknet contract that
//! outlives Dojo worlds, built from arbiter's `RatingsComponent` with Go's
//! rules (`GoRatingRules`). Each world's channel is an allowlisted client; see
//! RANKING_PLAN.md.
pub mod math;
pub mod ratings;
pub mod rules;

#[cfg(test)]
mod tests {
    mod audit_vectors;
    mod test_audit;
    mod test_gas;
    mod test_math;
    mod test_surround;
    mod vectors;
}
