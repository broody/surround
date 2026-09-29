//! Surround's native proof adapter: referee_adapter specialized to Go. The
//! virtual `__execute__` replays Go steps from the channel's anchor (or its candidate, to extend
//! it), against each seat's final
//! signature and, in a ranked (timed) game, the referee's final attestation of the stamps, and
//! emits the transition message a prover proves; `settle` checks the verified proof facts
//! against that message and relays the end state to the channel.
use referee::{Batch, Envelope, Signature};
use starknet::ContractAddress;
use surround_rules::go::{GoAction, GoState};

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
    ) -> felt252;
    fn __execute__(
        ref self: T,
        channel: ContractAddress,
        game_id: felt252,
        epoch: u32,
        start: Envelope<GoState>,
        history: Span<felt252>,
        batch: Batch<GoAction>,
    );
}

#[starknet::contract(account)]
pub mod ChannelProver {
    use referee::{Batch, Envelope, Signature};
    use referee_adapter::prover;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, VALIDATED};
    use surround_rules::go::{GoAction, GoRules, GoState};

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
        ) {
            prover::execute::<GoRules>(channel, game_id, epoch, start, history, batch);
        }
    }
}
