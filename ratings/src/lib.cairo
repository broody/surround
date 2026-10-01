//! Surround's ratings: a plain Starknet contract (`SurroundRatings`) that
//! outlives Dojo worlds, and its fixed-point rating math. Each world's channel
//! is an allowlisted client; see RANKING_PLAN.md.
pub mod math;
pub mod ratings;
pub mod ticket;

#[cfg(test)]
mod tests {
    mod audit_vectors;
    mod test_audit;
    mod test_gas;
    mod test_math;
    mod test_anchors;
    mod test_ratings;
    mod test_tickets;
    mod vectors;
}
