//! Surround's onchain channel: a referee_dojo system for Go. The rules live in
//! the Dojo-free `surround_rules` crate (`rules/`).
pub mod systems {
    pub mod channel;
}

#[cfg(test)]
mod tests {
    mod test_channel;
}
