use core::poseidon::poseidon_hash_span;
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, cheat_proof_facts, declare, get_class_hash,
    start_cheat_block_number, start_cheat_caller_address, start_cheat_chain_id,
};
use starknet::{ContractAddress, SyscallResultTrait};
use surround_native_bench::{
    INativeScoringDispatcher, INativeScoringDispatcherTrait, ProofFacts, check_facts,
};
use surround_score_bench::rules::{empty_bits, empty_position};

fn setup() -> INativeScoringDispatcher {
    let class = declare("NativeScoring").unwrap();
    let (address, _) = class.contract_class().deploy(@array![123]).unwrap_syscall();
    start_cheat_caller_address(address, 123.try_into().unwrap());
    start_cheat_block_number(address, 10);
    start_cheat_chain_id(address, 'SN_SEPOLIA');
    INativeScoringDispatcher { contract_address: address }
}

fn seal(d: INativeScoringDispatcher, id: felt252) {
    d.seal(id, 9, 15, empty_position(), empty_bits());
}

fn facts(message: felt252) -> ProofFacts {
    ProofFacts {
        proof_version: 'PROOF1',
        program_variant: 'VIRTUAL_SNOS',
        virtual_program_hash: 1,
        output_version: 'VIRTUAL_SNOS0',
        base_block_number: 20,
        base_block_hash: 2,
        config_hash: 3,
        messages: [message].span(),
    }
}

// Unit/integration tests deliberately inject facts. Only Sepolia receipts count
// as real native verification in the benchmark report.
fn mock_valid_facts(d: INativeScoringDispatcher, id: felt252) {
    let address = d.contract_address;
    let (commitment, _) = d.snapshot(id);
    let payload = array![
        get_class_hash(address).into(), 'SURROUND_NATIVE_SCORE_V1', 'SN_SEPOLIA', address.into(),
        id, commitment, 0, 15,
    ];
    let mut message = array![address.into(), 0];
    payload.serialize(ref message);
    let mut encoded = array![];
    facts(poseidon_hash_span(message.span())).serialize(ref encoded);
    start_cheat_block_number(address, 30);
    cheat_proof_facts(address, encoded.span(), CheatSpan::TargetCalls(1));
}

#[test]
fn direct_and_proved_results_agree() {
    let d = setup();
    seal(d, 1);
    d.direct(1, 9, 15, empty_position(), empty_bits());
    mock_valid_facts(d, 1);
    d.settle(1, 0, 15);
    assert(d.result(1, false) == (true, 0, 15), 'Wrong direct score');
    assert(d.result(1, true) == (true, 0, 15), 'Wrong proved score');
}

#[test]
#[should_panic(expected: ('Only owner',))]
fn unauthorized_seal_rejected() {
    let d = setup();
    start_cheat_caller_address(d.contract_address, 456.try_into().unwrap());
    seal(d, 1);
}

#[test]
#[should_panic(expected: ('Already sealed',))]
fn immutable_snapshot() {
    let d = setup();
    seal(d, 1);
    d.seal(1, 9, 13, empty_position(), empty_bits());
}

#[test]
#[should_panic(expected: ('Wrong scoring input',))]
fn changed_komi_rejected() {
    let d = setup();
    seal(d, 1);
    d.direct(1, 9, 13, empty_position(), empty_bits());
}

#[test]
#[should_panic(expected: ('Missing proof facts',))]
fn no_proof_rejected() {
    let d = setup();
    seal(d, 1);
    d.settle(1, 0, 15);
}

#[test]
#[should_panic(expected: ('Wrong proved message',))]
fn changed_score_rejected() {
    let d = setup();
    seal(d, 1);
    mock_valid_facts(d, 1);
    d.settle(1, 1, 15);
}

#[test]
#[should_panic(expected: ('Wrong proved message',))]
fn another_game_rejected() {
    let d = setup();
    seal(d, 1);
    seal(d, 2);
    mock_valid_facts(d, 1);
    d.settle(2, 0, 15);
}

#[test]
#[should_panic(expected: ('Already proof settled',))]
fn replay_rejected() {
    let d = setup();
    seal(d, 1);
    mock_valid_facts(d, 1);
    d.settle(1, 0, 15);
    d.settle(1, 0, 15);
}

fn check(f: ProofFacts) {
    let mut encoded = array![];
    f.serialize(ref encoded);
    check_facts(encoded.span(), 42, 30, 10);
}

#[test]
fn facts_schema_accepted() {
    check(facts(42));
}

#[test]
#[should_panic(expected: ('Wrong proof version',))]
fn old_proof_version_rejected() {
    let mut f = facts(42);
    f.proof_version = 'PROOF0';
    check(f);
}

#[test]
#[should_panic(expected: ('Wrong program variant',))]
fn wrong_program_rejected() {
    let mut f = facts(42);
    f.program_variant = 0;
    check(f);
}

#[test]
#[should_panic(expected: ('Wrong output version',))]
fn wrong_output_rejected() {
    let mut f = facts(42);
    f.output_version = 0;
    check(f);
}

#[test]
#[should_panic(expected: ('Proof predates seal',))]
fn proof_before_snapshot_rejected() {
    let mut f = facts(42);
    f.base_block_number = 9;
    check(f);
}

#[test]
#[should_panic(expected: ('Invalid base block',))]
fn future_base_rejected() {
    let mut f = facts(42);
    f.base_block_number = 30;
    check(f);
}

#[test]
#[should_panic(expected: ('Expired proof',))]
fn expired_proof_rejected() {
    let mut encoded = array![];
    facts(42).serialize(ref encoded);
    check_facts(encoded.span(), 42, 4021, 10);
}

#[test]
#[should_panic(expected: ('Wrong proved message',))]
fn extra_message_rejected() {
    let mut f = facts(42);
    f.messages = [42, 42].span();
    check(f);
}

#[test]
#[should_panic(expected: ('Trailing proof facts',))]
fn trailing_facts_rejected() {
    let mut encoded = array![];
    facts(42).serialize(ref encoded);
    encoded.append(99);
    check_facts(encoded.span(), 42, 30, 10);
}

#[test]
#[should_panic(expected: ('Malformed proof facts',))]
fn malformed_facts_rejected() {
    check_facts([1].span(), 42, 30, 10);
}
