//! Measurement-only stand-in for the Dojo channel's `get_snapshot`. It lets a
//! ChannelProver of any class run in the virtual OS for capacity and proving
//! measurements without deploying a Dojo world. It cannot settle anything:
//! `accept_verified` always fails, and no real channel trusts it.
#[starknet::contract]
pub mod SnapshotStub {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_contract_address, get_tx_info};
    use surround_offchain::adapter::IChannel;
    use surround_offchain::channel_protocol::{self, ChannelState, Signature, Terms};

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

    #[abi(embed_v0)]
    impl Channel of IChannel<ContractState> {
        // Every game id is a fresh epoch-0 game between placeholder wallets 1 and 2.
        fn get_snapshot(self: @ContractState, game_id: felt252) -> (Terms, u32, ChannelState, u64) {
            let size = self.size.read();
            let terms = Terms {
                chain_id: get_tx_info().chain_id,
                channel: get_contract_address().into(),
                game_id,
                black: 1,
                white: 2,
                black_key: self.black_key.read(),
                white_key: self.white_key.read(),
                prover: self.prover.read().into(),
                size,
                komi_half: self.komi_half.read(),
                response_seconds: 3600,
            };
            (terms, 0, channel_protocol::initial_state(size), 0)
        }

        fn accept_verified(
            ref self: ContractState,
            game_id: felt252,
            epoch: u32,
            start_hash: felt252,
            end: ChannelState,
            black_ack: Signature,
            white_ack: Signature,
        ) {
            panic!("Measurement stub cannot settle");
        }
    }
}
