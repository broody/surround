// Generated from the immutable native ChannelProver artifact by offchain/pin.mjs.
pub const PROVER_CLASS_HASH: felt252 =
    0x317e518fbafa9823d23907351a7322a55e31c4ae978584f7164923623ef663c;

#[cfg(not(test))]
pub fn prover_class() -> starknet::ClassHash {
    PROVER_CLASS_HASH.try_into().unwrap()
}

// Dojo unit tests use an explicit callback double; this is never a production pin.
#[cfg(test)]
pub fn prover_class() -> starknet::ClassHash {
    crate::tests::test_channel::proof_stub::TEST_CLASS_HASH
}
