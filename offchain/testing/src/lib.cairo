//! Sepolia test harness: lets one funded test wallet control two distinct seats.
//! Not part of the game or proof adapter; holds no signing key or funds.
use starknet::ContractAddress;

#[starknet::interface]
pub trait IJoin<T> {
    fn join_channel(ref self: T, game_id: felt252, session_key: felt252);
}

#[starknet::interface]
pub trait ITestPlayer<T> {
    fn join(ref self: T, channel: ContractAddress, game_id: felt252, session_key: felt252);
}

#[starknet::contract]
pub mod TestPlayer {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use super::{IJoinDispatcher, IJoinDispatcherTrait};

    #[storage]
    struct Storage {
        owner: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.owner.write(owner);
    }

    #[abi(embed_v0)]
    impl Player of super::ITestPlayer<ContractState> {
        fn join(
            ref self: ContractState,
            channel: ContractAddress,
            game_id: felt252,
            session_key: felt252,
        ) {
            assert(get_caller_address() == self.owner.read(), 'Only test owner');
            IJoinDispatcher { contract_address: channel }.join_channel(game_id, session_key);
        }
    }
}
