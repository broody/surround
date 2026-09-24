// Generated from the immutable native ChannelProver artifact by offchain/pin.mjs.
pub const PROVER_CLASS_HASH: felt252 =
    0x3ae841db62e1822a6a24d636f9b3bcfba8afcb20c15cc0d1bc29d2987bdfd09;

#[cfg(not(test))]
pub fn prover_class() -> starknet::ClassHash {
    PROVER_CLASS_HASH.try_into().unwrap()
}

// Dojo unit tests use an explicit callback double; this is never a production pin.
#[cfg(test)]
pub fn prover_class() -> starknet::ClassHash {
    crate::tests::test_channel::proof_stub::TEST_CLASS_HASH
}
