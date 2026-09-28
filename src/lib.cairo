//! Surround's onchain channel: a referee_dojo system for Go. The rules live in
//! the Dojo-free `surround_rules` crate (`rules/`). Kifu mints each settled
//! ranked game to its winner as an ERC-721 whose image is drawn onchain.
pub mod models;

pub mod kifu {
    pub mod record;
    pub mod render;
    pub mod text;
}

pub mod systems {
    pub mod channel;
    pub mod kifu;
}

#[cfg(test)]
mod tests {
    mod test_channel;
    mod test_kifu;
    mod test_kifu_stress;
    mod test_rated;
}
