//! Surround's onchain channel: an arbiter_dojo system for Go. The rules live in
//! the Dojo-free `surround_rules` crate (`rules/`). Kifu mints each settled
//! ranked game to its winner as an ERC-721 whose image is drawn onchain.
pub mod models;

pub mod kifu {
    pub mod record;
    pub mod render;
    pub mod text;
}

/// Soulbound rank cards: each rated player's rank and record, drawn onchain
/// from `SurroundRatings`. A plain Starknet contract, outside the world.
pub mod rank_card {
    pub mod card;
    pub mod render;
}

pub mod systems {
    pub mod channel;
    pub mod kifu;
}

#[cfg(test)]
mod tests {
    mod account;
    mod test_channel;
    mod test_gas;
    mod test_kifu;
    mod test_kifu_stress;
    mod test_rank_card;
    mod test_rated;
    mod test_redteam;
}
