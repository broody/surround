//! Surround's native proof adapter: arbiter_adapter specialized to Go. The
//! virtual `__execute__` replays Go steps from the channel's anchor (or its
//! candidate, to extend it), or for a game no channel has opened yet from its
//! terms' opening state, against each seat's final signature and, in a ranked
//! (timed) game, the referee's final attestation of the stamps, and emits the
//! transition message a prover proves; `settle` checks the verified proof
//! facts against that message and relays the end state to the channel.
use arbiter::{Batch, Envelope, Signature, Terms};
use starknet::ContractAddress;
use surround_rules::go::{GoAction, GoConfig, GoState};

#[starknet::interface]
pub trait IChannelProver<T> {
    /// `start_hash` is the channel's anchor or candidate the proof starts from.
    fn settle(
        ref self: T,
        channel: ContractAddress,
        game_id: felt252,
        epoch: u32,
        start_hash: felt252,
        end: Envelope<GoState>,
        acks: Span<Signature>,
    );
    fn os_program(self: @T) -> felt252;
}

#[starknet::interface]
pub trait IVirtualChannel<T> {
    fn __validate__(
        self: @T,
        channel: ContractAddress,
        game_id: felt252,
        epoch: u32,
        start: Envelope<GoState>,
        history: Span<felt252>,
        batch: Batch<GoAction>,
        opening: Option<Terms<GoConfig>>,
    ) -> felt252;
    /// `opening` is the terms of a game no channel has opened yet, `None`
    /// otherwise: the proof then starts from their opening state, and its
    /// `settle` goes in one transaction after `open_game`.
    fn __execute__(
        ref self: T,
        channel: ContractAddress,
        game_id: felt252,
        epoch: u32,
        start: Envelope<GoState>,
        history: Span<felt252>,
        batch: Batch<GoAction>,
        opening: Option<Terms<GoConfig>>,
    );
}

#[starknet::contract(account)]
pub mod ChannelProver {
    use arbiter::{Batch, Envelope, Signature, Terms};
    use arbiter_adapter::prover;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, VALIDATED};
    use surround_rules::go::{GoAction, GoConfig, GoRules, GoState};

    // No admin, upgrade path, arbitrary calls or custody. The virtual OS
    // program is fixed at deployment; an OS upgrade needs a new instance,
    // which the channel's owner allowlists by class.
    #[storage]
    struct Storage {
        os_program: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, os_program: felt252) {
        assert(os_program != 0, 'Zero OS program');
        self.os_program.write(os_program);
    }

    #[abi(embed_v0)]
    impl ProverImpl of super::IChannelProver<ContractState> {
        fn settle(
            ref self: ContractState,
            channel: ContractAddress,
            game_id: felt252,
            epoch: u32,
            start_hash: felt252,
            end: Envelope<GoState>,
            acks: Span<Signature>,
        ) {
            prover::settle::<
                GoRules,
            >(channel, game_id, epoch, start_hash, end, acks, self.os_program.read());
        }

        fn os_program(self: @ContractState) -> felt252 {
            self.os_program.read()
        }
    }

    #[abi(embed_v0)]
    impl VirtualImpl of super::IVirtualChannel<ContractState> {
        fn __validate__(
            self: @ContractState,
            channel: ContractAddress,
            game_id: felt252,
            epoch: u32,
            start: Envelope<GoState>,
            history: Span<felt252>,
            batch: Batch<GoAction>,
            opening: Option<Terms<GoConfig>>,
        ) -> felt252 {
            prover::assert_virtual();
            VALIDATED
        }

        fn __execute__(
            ref self: ContractState,
            channel: ContractAddress,
            game_id: felt252,
            epoch: u32,
            start: Envelope<GoState>,
            history: Span<felt252>,
            batch: Batch<GoAction>,
            opening: Option<Terms<GoConfig>>,
        ) {
            prover::execute::<GoRules>(channel, game_id, epoch, start, history, batch, opening);
        }
    }
}
