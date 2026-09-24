use core::poseidon::poseidon_hash_span;
use starknet::ContractAddress;
use surround_score_bench::rules::{Bits, Position};

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

pub fn check_facts(
    mut encoded: Span<felt252>, expected_message: felt252, current_block: u64, sealed_block: u64,
) {
    assert(!encoded.is_empty(), 'Missing proof facts');
    let facts: ProofFacts = Serde::deserialize(ref encoded).expect('Malformed proof facts');
    assert(encoded.is_empty(), 'Trailing proof facts');
    assert(facts.proof_version == 'PROOF1', 'Wrong proof version');
    assert(facts.program_variant == 'VIRTUAL_SNOS', 'Wrong program variant');
    assert(facts.output_version == 'VIRTUAL_SNOS0', 'Wrong output version');
    assert(facts.base_block_number >= sealed_block, 'Proof predates seal');
    assert(facts.base_block_number < current_block, 'Invalid base block');
    assert(current_block - facts.base_block_number <= MAX_PROOF_AGE, 'Expired proof');
    assert(facts.messages == [expected_message].span(), 'Wrong proved message');
    // Native verification authenticates the OS program/config and canonical base
// block hash. This function is only called with syscall-provided facts.
}

#[starknet::interface]
pub trait INativeScoring<T> {
    fn seal(ref self: T, id: felt252, size: u8, komi: u16, board: Position, dead: Bits);
    fn direct(ref self: T, id: felt252, size: u8, komi: u16, board: Position, dead: Bits);
    fn settle(ref self: T, id: felt252, black_half: u16, white_half: u16);
    fn snapshot(self: @T, id: felt252) -> (felt252, u64);
    fn result(self: @T, id: felt252, proved: bool) -> (bool, u16, u16);
}

#[starknet::interface]
pub trait IVirtualScorer<T> {
    fn __validate__(
        self: @T, id: felt252, size: u8, komi: u16, board: Position, dead: Bits,
    ) -> felt252;
    fn __execute__(ref self: T, id: felt252, size: u8, komi: u16, board: Position, dead: Bits);
}

// Sepolia measurement harness. The owner seals immutable recorded-game inputs;
// this does not replace the production Dojo player agreement flow.
#[starknet::contract(account)]
pub mod NativeScoring {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::syscalls::{
        get_class_hash_at_syscall, get_execution_info_v3_syscall, send_message_to_l1_syscall,
    };
    use starknet::{SyscallResultTrait, VALIDATED, get_caller_address, get_contract_address};
    use surround_score_bench::rules::{self, Bits, Position};
    use super::{ContractAddress, check_facts, poseidon_hash_span};

    #[storage]
    struct Storage {
        owner: ContractAddress,
        commitments: Map<felt252, felt252>,
        sealed_blocks: Map<felt252, u64>,
        results: Map<(felt252, bool), (bool, u16, u16)>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        assert(owner.is_non_zero(), 'Zero owner');
        self.owner.write(owner);
    }

    #[abi(embed_v0)]
    impl ScoringImpl of super::INativeScoring<ContractState> {
        fn seal(
            ref self: ContractState, id: felt252, size: u8, komi: u16, board: Position, dead: Bits,
        ) {
            assert(get_caller_address() == self.owner.read(), 'Only owner');
            assert(self.commitments.read(id).is_zero(), 'Already sealed');
            rules::validate_size(size);
            let commitment = input_hash(id, size, komi, board, dead);
            assert(commitment.is_non_zero(), 'Zero commitment');
            self.commitments.write(id, commitment);
            self.sealed_blocks.write(id, starknet::get_block_number());
        }

        fn direct(
            ref self: ContractState, id: felt252, size: u8, komi: u16, board: Position, dead: Bits,
        ) {
            self.check_input(id, size, komi, board, dead);
            let (done, _, _) = self.results.read((id, false));
            assert(!done, 'Already direct scored');
            let score = rules::score(board, size, dead, komi);
            self.results.write((id, false), (true, score.black_half, score.white_half));
        }

        fn settle(ref self: ContractState, id: felt252, black_half: u16, white_half: u16) {
            let commitment = self.commitments.read(id);
            assert(commitment.is_non_zero(), 'Unsealed game');
            let (done, _, _) = self.results.read((id, true));
            assert(!done, 'Already proof settled');
            let payload = message_payload(id, commitment, black_half, white_half);
            let mut message = array![get_contract_address().into(), 0];
            payload.serialize(ref message);
            let expected = poseidon_hash_span(message.span());
            let info = get_execution_info_v3_syscall().unwrap_syscall();
            check_facts(
                info.tx_info.proof_facts,
                expected,
                info.block_info.block_number,
                self.sealed_blocks.read(id),
            );
            self.results.write((id, true), (true, black_half, white_half));
        }

        fn snapshot(self: @ContractState, id: felt252) -> (felt252, u64) {
            (self.commitments.read(id), self.sealed_blocks.read(id))
        }

        fn result(self: @ContractState, id: felt252, proved: bool) -> (bool, u16, u16) {
            self.results.read((id, proved))
        }
    }

    #[abi(embed_v0)]
    impl VirtualImpl of super::IVirtualScorer<ContractState> {
        fn __validate__(
            self: @ContractState, id: felt252, size: u8, komi: u16, board: Position, dead: Bits,
        ) -> felt252 {
            assert_virtual_invocation();
            VALIDATED
        }

        fn __execute__(
            ref self: ContractState, id: felt252, size: u8, komi: u16, board: Position, dead: Bits,
        ) {
            assert_virtual_invocation();
            let commitment = self.check_input(id, size, komi, board, dead);
            let score = rules::score(board, size, dead, komi);
            let payload = message_payload(id, commitment, score.black_half, score.white_half);
            send_message_to_l1_syscall(0.try_into().unwrap(), payload.span()).unwrap_syscall();
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn check_input(
            self: @ContractState, id: felt252, size: u8, komi: u16, board: Position, dead: Bits,
        ) -> felt252 {
            let stored = self.commitments.read(id);
            assert(stored.is_non_zero(), 'Unsealed game');
            assert(stored == input_hash(id, size, komi, board, dead), 'Wrong scoring input');
            stored
        }
    }

    fn input_hash(id: felt252, size: u8, komi: u16, board: Position, dead: Bits) -> felt252 {
        poseidon_hash_span(
            array![
                'SURROUND_NATIVE_INPUT_V1', starknet::get_tx_info().chain_id,
                get_contract_address().into(), id, rules::RULES_VERSION.into(), size.into(),
                komi.into(), rules::position_hash(board, size), dead.low.into(), dead.mid.into(),
                dead.high.into(),
            ]
                .span(),
        )
    }

    fn message_payload(
        id: felt252, commitment: felt252, black_half: u16, white_half: u16,
    ) -> Array<felt252> {
        let address = get_contract_address();
        let class_hash = get_class_hash_at_syscall(address).unwrap_syscall();
        array![
            class_hash.into(), 'SURROUND_NATIVE_SCORE_V1', starknet::get_tx_info().chain_id,
            address.into(), id, commitment, black_half.into(), white_half.into(),
        ]
    }

    // No arbitrary calls, signatures or token transfers: this account interface
    // only proves public scoring and cannot spend an account's assets.
    fn assert_virtual_invocation() {
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
