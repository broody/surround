use core::poseidon::poseidon_hash_span;
use starknet::ContractAddress;
use crate::channel_protocol::{self, ChannelState, Signature, SignedAction, Terms};

pub const MAX_PROOF_AGE: u64 = 4000;

#[derive(Copy, Drop, Serde)]
pub struct ProofFacts {
    pub proof_version: felt252,
    pub program_variant: felt252,
    pub virtual_program_hash: felt252,
    pub output_version: felt252,
    pub base_block_number: u64,
    pub base_block_hash: felt252,
    pub config_hash: felt252,
    pub messages: Span<felt252>,
}

// PROOF1 is the small (log20) path; PROOF2 is the large path added in Starknet
// v0.14.4. Both attest the same virtual-OS facts layout.
pub fn check_facts(
    mut encoded: Span<felt252>, expected: felt252, os_program: felt252, current: u64, anchor: u64,
) {
    assert(!encoded.is_empty(), 'Missing proof facts');
    let facts: ProofFacts = Serde::deserialize(ref encoded).expect('Malformed proof facts');
    assert(encoded.is_empty(), 'Trailing proof facts');
    assert(
        facts.proof_version == 'PROOF1' || facts.proof_version == 'PROOF2', 'Wrong proof version',
    );
    assert(facts.program_variant == 'VIRTUAL_SNOS', 'Wrong program variant');
    assert(facts.virtual_program_hash == os_program, 'Wrong OS program');
    assert(facts.output_version == 'VIRTUAL_SNOS0', 'Wrong output version');
    assert(facts.base_block_number >= anchor, 'Proof predates anchor');
    assert(facts.base_block_number < current, 'Invalid base block');
    assert(current - facts.base_block_number <= MAX_PROOF_AGE, 'Expired proof');
    assert(facts.messages == [expected].span(), 'Wrong proved transition');
}

pub fn payload(
    class_hash: felt252,
    prover: felt252,
    terms: Terms,
    epoch: u32,
    start: ChannelState,
    end: ChannelState,
) -> Array<felt252> {
    array![
        class_hash, 'SURROUND_PROVED_GAME_V1', terms.chain_id, prover, terms.channel, terms.game_id,
        channel_protocol::context_hash(terms), epoch.into(), channel_protocol::state_hash(start),
        channel_protocol::state_hash(end),
    ]
}

#[starknet::interface]
pub trait IChannel<T> {
    fn get_snapshot(self: @T, game_id: felt252) -> (Terms, u32, ChannelState, u64);
    fn accept_verified(
        ref self: T,
        game_id: felt252,
        epoch: u32,
        start_hash: felt252,
        end: ChannelState,
        black_ack: Signature,
        white_ack: Signature,
    );
}

#[starknet::interface]
pub trait IChannelProver<T> {
    fn settle(
        ref self: T,
        channel: ContractAddress,
        game_id: felt252,
        epoch: u32,
        end: ChannelState,
        black_ack: Signature,
        white_ack: Signature,
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
        history: Span<felt252>,
        actions: Span<SignedAction>,
    ) -> felt252;
    fn __execute__(
        ref self: T,
        channel: ContractAddress,
        game_id: felt252,
        epoch: u32,
        history: Span<felt252>,
        actions: Span<SignedAction>,
    );
}

#[starknet::contract(account)]
pub mod ChannelProver {
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::syscalls::{
        get_class_hash_at_syscall, get_execution_info_v3_syscall, send_message_to_l1_syscall,
    };
    use starknet::{ContractAddress, SyscallResultTrait, VALIDATED, get_contract_address};
    use crate::channel_protocol::{self, ChannelState, Signature, SignedAction, Terms};
    use super::{
        IChannelDispatcher, IChannelDispatcherTrait, check_facts, payload, poseidon_hash_span,
    };

    // No mutable configuration, upgrade path, arbitrary calls or asset custody.
    // The virtual OS program is fixed at deployment; a Starknet OS upgrade needs a
    // new instance of this class, which the channel's class pin still accepts.
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
            end: ChannelState,
            black_ack: Signature,
            white_ack: Signature,
        ) {
            let mut game = IChannelDispatcher { contract_address: channel };
            let (terms, current_epoch, start, anchor_block) = game.get_snapshot(game_id);
            assert(
                terms.channel == channel.into() && terms.game_id == game_id, 'Wrong channel terms',
            );
            assert(terms.chain_id == starknet::get_tx_info().chain_id, 'Wrong chain terms');
            assert(epoch == current_epoch, 'Stale proof epoch');
            assert(terms.prover == get_contract_address().into(), 'Wrong game prover');
            let message = transition_payload(terms, epoch, start, end);
            let mut encoded = array![get_contract_address().into(), 0];
            message.serialize(ref encoded);
            let info = get_execution_info_v3_syscall().unwrap_syscall();
            check_facts(
                info.tx_info.proof_facts,
                poseidon_hash_span(encoded.span()),
                self.os_program.read(),
                info.block_info.block_number,
                anchor_block,
            );
            game
                .accept_verified(
                    game_id, epoch, channel_protocol::state_hash(start), end, black_ack, white_ack,
                );
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
            history: Span<felt252>,
            actions: Span<SignedAction>,
        ) -> felt252 {
            assert_virtual();
            VALIDATED
        }

        fn __execute__(
            ref self: ContractState,
            channel: ContractAddress,
            game_id: felt252,
            epoch: u32,
            history: Span<felt252>,
            actions: Span<SignedAction>,
        ) {
            assert_virtual();
            let game = IChannelDispatcher { contract_address: channel };
            let (terms, current_epoch, start, _) = game.get_snapshot(game_id);
            assert(
                terms.channel == channel.into() && terms.game_id == game_id, 'Wrong channel terms',
            );
            assert(terms.chain_id == starknet::get_tx_info().chain_id, 'Wrong chain terms');
            assert(epoch == current_epoch, 'Stale proof epoch');
            assert(terms.prover == get_contract_address().into(), 'Wrong game prover');
            let end = channel_protocol::replay(terms, start, history, actions);
            let message = transition_payload(terms, epoch, start, end);
            send_message_to_l1_syscall(0.try_into().unwrap(), message.span()).unwrap_syscall();
        }
    }

    fn transition_payload(
        terms: Terms, epoch: u32, start: ChannelState, end: ChannelState,
    ) -> Array<felt252> {
        let address = get_contract_address();
        let class_hash = get_class_hash_at_syscall(address).unwrap_syscall();
        payload(class_hash.into(), address.into(), terms, epoch, start, end)
    }

    fn assert_virtual() {
        let info = starknet::get_execution_info();
        assert(info.caller_address.is_zero(), 'Only OS caller');
        assert(
            info.tx_info.version == 3
                || info.tx_info.version == 0x100000000000000000000000000000003,
            'Only invoke v3',
        );
        assert(info.tx_info.tip == 0, 'Nonzero tip');
        for bound in info.tx_info.resource_bounds {
            assert(*bound.max_price_per_unit == 0, 'Nonzero gas price');
        };
    }
}
