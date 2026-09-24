use core::poseidon::poseidon_hash_span;
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, cheat_proof_facts, declare, get_class_hash,
    start_cheat_block_number, start_cheat_chain_id,
};
use starknet::{ContractAddress, SyscallResultTrait};
use surround_offchain::adapter::{
    self, IChannelDispatcher, IChannelDispatcherTrait, IChannelProverDispatcher,
    IChannelProverDispatcherTrait, ProofFacts,
};
use surround_offchain::channel_protocol::{self as protocol, ChannelState, Signature};

#[starknet::interface]
trait IMock<T> {
    fn configure(ref self: T, prover: ContractAddress);
    fn accepted(self: @T) -> felt252;
}

#[starknet::contract]
mod MockChannel {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_contract_address};
    use surround_offchain::channel_protocol::{self as protocol, ChannelState, Signature, Terms};
    #[storage]
    struct Storage {
        prover: ContractAddress,
        accepted: felt252,
    }
    #[abi(embed_v0)]
    impl MockImpl of super::IMock<ContractState> {
        fn configure(ref self: ContractState, prover: ContractAddress) {
            self.prover.write(prover);
        }
        fn accepted(self: @ContractState) -> felt252 {
            self.accepted.read()
        }
    }
    #[abi(embed_v0)]
    impl ChannelImpl of surround_offchain::adapter::IChannel<ContractState> {
        fn get_snapshot(self: @ContractState, game_id: felt252) -> (Terms, u32, ChannelState, u64) {
            (
                Terms {
                    chain_id: 'SN_SEPOLIA',
                    channel: get_contract_address().into(),
                    game_id,
                    black: 4,
                    white: 5,
                    black_key: 6,
                    white_key: 7,
                    prover: self.prover.read().into(),
                    size: 9,
                    komi_half: 13,
                    response_seconds: 3600,
                },
                0,
                protocol::initial_state(9),
                10,
            )
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
            assert(starknet::get_caller_address() == self.prover.read(), 'Wrong callback sender');
            self.accepted.write(protocol::state_hash(end));
        }
    }
}

fn setup() -> (IChannelProverDispatcher, IChannelDispatcher, IMockDispatcher) {
    let (prover, _) = declare("ChannelProver")
        .unwrap()
        .contract_class()
        .deploy(@array![])
        .unwrap_syscall();
    let (channel, _) = declare("MockChannel")
        .unwrap()
        .contract_class()
        .deploy(@array![])
        .unwrap_syscall();
    let mock = IMockDispatcher { contract_address: channel };
    mock.configure(prover);
    start_cheat_chain_id(prover, 'SN_SEPOLIA');
    start_cheat_block_number(prover, 30);
    (
        IChannelProverDispatcher { contract_address: prover },
        IChannelDispatcher { contract_address: channel },
        mock,
    )
}

fn facts(message: felt252) -> ProofFacts {
    ProofFacts {
        proof_version: 'PROOF1',
        program_variant: 'VIRTUAL_SNOS',
        virtual_program_hash: 123,
        output_version: 'VIRTUAL_SNOS0',
        base_block_number: 20,
        base_block_hash: 456,
        config_hash: 789,
        messages: [message].span(),
    }
}

fn inject(
    prover: IChannelProverDispatcher, channel: IChannelDispatcher, id: felt252, end: ChannelState,
) {
    let (terms, epoch, start, _) = channel.get_snapshot(id);
    let payload = adapter::payload(
        get_class_hash(prover.contract_address).into(),
        prover.contract_address.into(),
        terms,
        epoch,
        start,
        end,
    );
    let mut message = array![prover.contract_address.into(), 0];
    payload.serialize(ref message);
    let mut encoded = array![];
    facts(poseidon_hash_span(message.span())).serialize(ref encoded);
    cheat_proof_facts(prover.contract_address, encoded.span(), CheatSpan::TargetCalls(1));
}

fn zero() -> Signature {
    Signature { r: 0, s: 0 }
}
fn end() -> ChannelState {
    let mut state = protocol::initial_state(9);
    state.sequence = 10;
    state
}

#[test]
fn authenticated_fact_dispatches_exact_state_to_channel() {
    let (prover, channel, mock) = setup();
    inject(prover, channel, 17, end());
    prover.settle(channel.contract_address, 17, 0, end(), zero(), zero());
    assert(mock.accepted() == protocol::state_hash(end()), 'Wrong callback state');
}

#[test]
#[should_panic(expected: ('Missing proof facts',))]
fn calldata_alone_cannot_assert_a_verified_game() {
    let (prover, channel, _) = setup();
    prover.settle(channel.contract_address, 17, 0, end(), zero(), zero());
}

#[test]
#[should_panic(expected: ('Wrong proved transition',))]
fn changed_winner_is_rejected() {
    let (prover, channel, _) = setup();
    inject(prover, channel, 17, end());
    let mut changed = end();
    changed.winner = 2;
    prover.settle(channel.contract_address, 17, 0, changed, zero(), zero());
}

#[test]
#[should_panic(expected: ('Wrong proved transition',))]
fn changed_history_root_is_rejected() {
    let (prover, channel, _) = setup();
    inject(prover, channel, 17, end());
    let mut changed = end();
    changed.history_root += 1;
    prover.settle(channel.contract_address, 17, 0, changed, zero(), zero());
}

#[test]
#[should_panic(expected: ('Wrong proved transition',))]
fn proof_for_another_game_is_rejected() {
    let (prover, channel, _) = setup();
    inject(prover, channel, 17, end());
    prover.settle(channel.contract_address, 18, 0, end(), zero(), zero());
}

#[test]
#[should_panic(expected: ('Stale proof epoch',))]
fn stale_epoch_is_rejected() {
    let (prover, channel, _) = setup();
    inject(prover, channel, 17, end());
    prover.settle(channel.contract_address, 17, 1, end(), zero(), zero());
}

fn check(f: ProofFacts) {
    let mut data = array![];
    f.serialize(ref data);
    adapter::check_facts(data.span(), 42, 30, 10);
}

#[test]
#[should_panic(expected: ('Wrong proof version',))]
fn old_proof_schema_is_rejected() {
    let mut f = facts(42);
    f.proof_version = 'PROOF0';
    check(f);
}
#[test]
#[should_panic(expected: ('Wrong program variant',))]
fn another_program_variant_is_rejected() {
    let mut f = facts(42);
    f.program_variant = 0;
    check(f);
}
#[test]
#[should_panic(expected: ('Wrong output version',))]
fn another_output_schema_is_rejected() {
    let mut f = facts(42);
    f.output_version = 0;
    check(f);
}
#[test]
#[should_panic(expected: ('Proof predates anchor',))]
fn stale_base_is_rejected() {
    let mut f = facts(42);
    f.base_block_number = 9;
    check(f);
}
#[test]
#[should_panic(expected: ('Invalid base block',))]
fn future_base_is_rejected() {
    let mut f = facts(42);
    f.base_block_number = 30;
    check(f);
}
#[test]
#[should_panic(expected: ('Expired proof',))]
fn expired_fact_is_rejected() {
    let mut data = array![];
    facts(42).serialize(ref data);
    adapter::check_facts(data.span(), 42, 4021, 10);
}
#[test]
#[should_panic(expected: ('Wrong proved transition',))]
fn extra_messages_are_rejected() {
    let mut f = facts(42);
    f.messages = [42, 42].span();
    check(f);
}
#[test]
#[should_panic(expected: ('Trailing proof facts',))]
fn trailing_facts_are_rejected() {
    let mut data = array![];
    facts(42).serialize(ref data);
    data.append(1);
    adapter::check_facts(data.span(), 42, 30, 10);
}
#[test]
#[should_panic(expected: ('Malformed proof facts',))]
fn malformed_fact_is_rejected() {
    adapter::check_facts([1].span(), 42, 30, 10);
}
