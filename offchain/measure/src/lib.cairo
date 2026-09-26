//! Measurement-only stand-in for the Dojo channel's `snapshot`. It lets a
//! ChannelProver of any class run in the virtual OS for capacity and proving
//! measurements without deploying a Dojo world. It cannot settle anything:
//! `accept_verified` always fails, and no real channel trusts it.
#[starknet::contract]
pub mod SnapshotStub {
    use referee::{Envelope, Signature, Terms, open, state_hash};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_contract_address, get_tx_info};
    use surround_rules::go::{GoConfig, GoRules, GoState};

    #[storage]
    struct Storage {
        prover: ContractAddress,
        size: u8,
        komi_half: u16,
        black_key: felt252,
        white_key: felt252,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        prover: ContractAddress,
        size: u8,
        komi_half: u16,
        black_key: felt252,
        white_key: felt252,
    ) {
        self.prover.write(prover);
        self.size.write(size);
        self.komi_half.write(komi_half);
        self.black_key.write(black_key);
        self.white_key.write(white_key);
    }

    #[external(v0)]
    // Every game id is a fresh epoch-0 game between placeholder wallets 1 and
    // 2. As in the real channel, session keys double as randomness tips.
    fn snapshot(self: @ContractState, game_id: felt252) -> (Terms<GoConfig>, u32, felt252, u64) {
        let keys = array![self.black_key.read(), self.white_key.read()].span();
        let terms = Terms {
            chain_id: get_tx_info().chain_id,
            channel: get_contract_address().into(),
            game_id,
            prover: self.prover.read().into(),
            response_seconds: 3600,
            players: array![1, 2].span(),
            keys,
            rng_tips: keys,
            config: GoConfig { size: self.size.read(), komi_half: self.komi_half.read() },
        };
        let opening = open::<GoRules>(@terms.config, keys);
        (terms, 0, state_hash::<GoRules>(@opening), 0)
    }

    #[external(v0)]
    fn accept_verified(
        ref self: ContractState,
        game_id: felt252,
        epoch: u32,
        start_hash: felt252,
        end: Envelope<GoState>,
        acks: Span<Signature>,
    ) {
        panic!("Measurement stub cannot settle");
    }
}
