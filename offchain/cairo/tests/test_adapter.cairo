//! The Go proof adapter against a mock channel. The virtual `__execute__`
//! replays signed Go steps and emits the transition message; `settle` accepts
//! exactly that message as proof facts and relays the end state. Proof facts
//! are cheated here; a real run attaches a native Stwo proof instead.
use referee::{
    Envelope, Move, Signature, Terms, action_hash, actor, apply_steps, context_hash, open,
    state_hash,
};
use referee_adapter::{ProofFacts, check_facts, message_hash, payload};
use referee_testing::{public_key, sign};
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, MessageToL1, MessageToL1SpyAssertionsTrait,
    cheat_proof_facts, cheat_resource_bounds, declare, get_class_hash, spy_messages_to_l1,
    start_cheat_block_number, start_cheat_caller_address, start_cheat_chain_id,
    start_cheat_transaction_version,
};
use starknet::{ContractAddress, ResourcesBounds, SyscallResultTrait};
use surround_offchain::adapter::{
    IChannelProverDispatcher, IChannelProverDispatcherTrait, IVirtualChannelDispatcher,
    IVirtualChannelDispatcherTrait,
};
use surround_rules::go::{GoAction, GoConfig, GoRules, GoState};
use surround_rules::replay::{game_steps, opening_history};
use surround_rules::{fixtures, rules};

const OS_PROGRAM: felt252 = 123;
const GAME: felt252 = 17;
const PK_BLACK: felt252 = 0x1a2b3c;
const PK_WHITE: felt252 = 0x4d5e6f;
/// Signed moves replayed in the round trip (a prefix of a recorded game).
const MOVES: u32 = 12;

pub fn terms(
    channel: ContractAddress, game_id: felt252, prover: ContractAddress,
) -> Terms<GoConfig> {
    let keys = array![public_key(PK_BLACK), public_key(PK_WHITE)].span();
    Terms {
        chain_id: 'SN_SEPOLIA',
        channel: channel.into(),
        game_id,
        prover: prover.into(),
        response_seconds: 3600,
        players: array![4, 5].span(),
        keys,
        // As in Surround's channel, session keys double as randomness tips.
        rng_tips: keys,
        config: GoConfig { size: 9, komi_half: 13 },
    }
}

pub fn opening(terms: @Terms<GoConfig>) -> Envelope<GoState> {
    open::<GoRules>(terms.config, *terms.rng_tips)
}

#[starknet::interface]
trait IMockChannel<T> {
    fn configure(ref self: T, prover: ContractAddress);
    fn snapshot(self: @T, game_id: felt252) -> (Terms<GoConfig>, u32, felt252, u64);
    fn accept_verified(
        ref self: T,
        game_id: felt252,
        epoch: u32,
        start_hash: felt252,
        end: Envelope<GoState>,
        acks: Span<Signature>,
    );
    fn accepted(self: @T) -> felt252;
}

/// Stands in for Surround's Dojo channel: epoch 0, anchored at the opening
/// position in block 10.
#[starknet::contract]
mod MockChannel {
    use referee::{Envelope, Signature, Terms, state_hash};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use surround_rules::go::{GoConfig, GoRules, GoState};

    #[storage]
    struct Storage {
        prover: ContractAddress,
        accepted: felt252,
    }

    #[abi(embed_v0)]
    impl MockImpl of super::IMockChannel<ContractState> {
        fn configure(ref self: ContractState, prover: ContractAddress) {
            self.prover.write(prover);
        }

        fn snapshot(
            self: @ContractState, game_id: felt252,
        ) -> (Terms<GoConfig>, u32, felt252, u64) {
            let terms = super::terms(get_contract_address(), game_id, self.prover.read());
            (terms, 0, state_hash::<GoRules>(@super::opening(@terms)), 10)
        }

        fn accept_verified(
            ref self: ContractState,
            game_id: felt252,
            epoch: u32,
            start_hash: felt252,
            end: Envelope<GoState>,
            acks: Span<Signature>,
        ) {
            assert(get_caller_address() == self.prover.read(), 'Wrong callback sender');
            self.accepted.write(state_hash::<GoRules>(@end));
        }

        fn accepted(self: @ContractState) -> felt252 {
            self.accepted.read()
        }
    }
}

fn setup() -> (IChannelProverDispatcher, IMockChannelDispatcher) {
    let (prover, _) = declare("ChannelProver")
        .unwrap()
        .contract_class()
        .deploy(@array![OS_PROGRAM])
        .unwrap_syscall();
    let (channel, _) = declare("MockChannel")
        .unwrap()
        .contract_class()
        .deploy(@array![])
        .unwrap_syscall();
    let mock = IMockChannelDispatcher { contract_address: channel };
    mock.configure(prover);
    start_cheat_chain_id(prover, 'SN_SEPOLIA');
    start_cheat_block_number(prover, 30);
    (IChannelProverDispatcher { contract_address: prover }, mock)
}

/// The first MOVES moves of a recorded 9x9 game, each seat's final signature
/// over them, and the end state.
fn signed_moves(
    terms: @Terms<GoConfig>,
) -> (Span<Move<GoAction>>, Span<Signature>, Envelope<GoState>) {
    let fixture = fixtures::cgos_9_1682827();
    let steps = game_steps(@fixture).slice(0, MOVES);
    let context = context_hash::<GoRules>(terms);
    let mut env = opening(terms);
    let mut history = opening_history(terms.config);
    let zero = Signature { r: 0, s: 0 };
    let mut finals = array![zero, zero].span();
    for step in steps {
        let seat = actor::<GoRules>(@env, step);
        let message = action_hash::<GoRules>(context, env.seq, env.transcript, step);
        finals =
            if seat == 0 {
                array![sign(message, PK_BLACK), *finals.at(1)].span()
            } else {
                array![*finals.at(0), sign(message, PK_WHITE)].span()
            };
        let before = env.game.board;
        env = apply_steps::<GoRules>(context, terms.config, env, history, array![*step].span());
        if env.game.board != before {
            let mut next: Array<felt252> = history.into();
            next.append(rules::position_hash(env.game.board, 9));
            history = next.span();
        }
    }
    (steps, finals, env)
}

fn transition(
    prover: ContractAddress, channel: ContractAddress, end: @Envelope<GoState>,
) -> Array<felt252> {
    let terms = terms(channel, GAME, prover);
    payload::<
        GoRules,
    >(
        get_class_hash(prover).into(),
        prover.into(),
        'SN_SEPOLIA',
        channel.into(),
        GAME,
        context_hash::<GoRules>(@terms),
        0,
        state_hash::<GoRules>(@opening(@terms)),
        state_hash::<GoRules>(end),
    )
}

fn facts(message: felt252) -> ProofFacts {
    ProofFacts {
        proof_version: 'PROOF1',
        program_variant: 'VIRTUAL_SNOS',
        virtual_program_hash: OS_PROGRAM,
        output_version: 'VIRTUAL_SNOS0',
        base_block_number: 20,
        base_block_hash: 456,
        config_hash: 789,
        messages: [message].span(),
    }
}

fn inject(prover: ContractAddress, f: ProofFacts) {
    let mut encoded = array![];
    f.serialize(ref encoded);
    cheat_proof_facts(prover, encoded.span(), CheatSpan::TargetCalls(1));
}

fn inject_for(prover: ContractAddress, channel: ContractAddress, end: @Envelope<GoState>) {
    let expected = transition(prover, channel, end);
    inject(prover, facts(message_hash(prover.into(), expected.span())));
}

fn no_acks() -> Span<Signature> {
    array![Signature { r: 0, s: 0 }, Signature { r: 0, s: 0 }].span()
}

fn end_state(prover: ContractAddress, channel: ContractAddress) -> Envelope<GoState> {
    let (_, _, end) = signed_moves(@terms(channel, GAME, prover));
    end
}

#[test]
fn virtual_replay_emits_the_message_settle_accepts() {
    let (prover, mock) = setup();
    let terms = terms(mock.contract_address, GAME, prover.contract_address);
    let (steps, signatures, end) = signed_moves(@terms);

    // Proving path: the OS runs __execute__ as a zero-fee virtual invoke.
    let mut spy = spy_messages_to_l1();
    start_cheat_caller_address(prover.contract_address, 0.try_into().unwrap());
    start_cheat_transaction_version(prover.contract_address, 3);
    let free = array![
        ResourcesBounds { resource: 'L1_GAS', max_amount: 0, max_price_per_unit: 0 },
        ResourcesBounds { resource: 'L2_GAS', max_amount: 0, max_price_per_unit: 0 },
        ResourcesBounds { resource: 'L1_DATA', max_amount: 0, max_price_per_unit: 0 },
    ];
    cheat_resource_bounds(prover.contract_address, free.span(), CheatSpan::TargetCalls(1));
    let virtual = IVirtualChannelDispatcher { contract_address: prover.contract_address };
    virtual
        .__execute__(
            mock.contract_address,
            GAME,
            0,
            opening(@terms),
            opening_history(@terms.config),
            steps,
            signatures,
        );
    let expected = transition(prover.contract_address, mock.contract_address, @end);
    spy
        .assert_sent(
            @array![
                (
                    prover.contract_address,
                    MessageToL1 { to_address: 0.try_into().unwrap(), payload: expected.clone() },
                ),
            ],
        );

    // Settlement path: facts carrying that message settle the end state.
    inject(
        prover.contract_address,
        facts(message_hash(prover.contract_address.into(), expected.span())),
    );
    prover.settle(mock.contract_address, GAME, 0, end, no_acks());
    assert(mock.accepted() == state_hash::<GoRules>(@end), 'Wrong callback state');
}

#[test]
#[should_panic(expected: ('Wrong position history', 'ENTRYPOINT_FAILED'))]
fn virtual_replay_checks_the_superko_witness() {
    let (prover, mock) = setup();
    let terms = terms(mock.contract_address, GAME, prover.contract_address);
    let (steps, signatures, _) = signed_moves(@terms);
    start_cheat_caller_address(prover.contract_address, 0.try_into().unwrap());
    start_cheat_transaction_version(prover.contract_address, 3);
    let free = array![ResourcesBounds { resource: 'L2_GAS', max_amount: 0, max_price_per_unit: 0 }];
    cheat_resource_bounds(prover.contract_address, free.span(), CheatSpan::TargetCalls(1));
    let virtual = IVirtualChannelDispatcher { contract_address: prover.contract_address };
    virtual
        .__execute__(
            mock.contract_address, GAME, 0, opening(@terms), array![999].span(), steps, signatures,
        );
}

#[test]
fn authenticated_fact_dispatches_exact_state_to_channel() {
    let (prover, mock) = setup();
    let end = end_state(prover.contract_address, mock.contract_address);
    inject_for(prover.contract_address, mock.contract_address, @end);
    prover.settle(mock.contract_address, GAME, 0, end, no_acks());
    assert(mock.accepted() == state_hash::<GoRules>(@end), 'Wrong callback state');
}

#[test]
#[should_panic(expected: ('Missing proof facts', 'ENTRYPOINT_FAILED'))]
fn calldata_alone_cannot_assert_a_verified_game() {
    let (prover, mock) = setup();
    let end = end_state(prover.contract_address, mock.contract_address);
    prover.settle(mock.contract_address, GAME, 0, end, no_acks());
}

#[test]
#[should_panic(expected: ('Wrong proved transition', 'ENTRYPOINT_FAILED'))]
fn changed_winner_is_rejected() {
    let (prover, mock) = setup();
    let end = end_state(prover.contract_address, mock.contract_address);
    inject_for(prover.contract_address, mock.contract_address, @end);
    let mut changed = end;
    changed.outcome.winner = 2;
    prover.settle(mock.contract_address, GAME, 0, changed, no_acks());
}

#[test]
#[should_panic(expected: ('Wrong proved transition', 'ENTRYPOINT_FAILED'))]
fn changed_history_root_is_rejected() {
    let (prover, mock) = setup();
    let end = end_state(prover.contract_address, mock.contract_address);
    inject_for(prover.contract_address, mock.contract_address, @end);
    let mut changed = end;
    changed.game.history_root += 1;
    prover.settle(mock.contract_address, GAME, 0, changed, no_acks());
}

#[test]
#[should_panic(expected: ('Wrong proved transition', 'ENTRYPOINT_FAILED'))]
fn proof_for_another_game_is_rejected() {
    let (prover, mock) = setup();
    let end = end_state(prover.contract_address, mock.contract_address);
    inject_for(prover.contract_address, mock.contract_address, @end);
    prover.settle(mock.contract_address, GAME + 1, 0, end, no_acks());
}

#[test]
#[should_panic(expected: ('Stale proof epoch', 'ENTRYPOINT_FAILED'))]
fn stale_epoch_is_rejected() {
    let (prover, mock) = setup();
    let end = end_state(prover.contract_address, mock.contract_address);
    prover.settle(mock.contract_address, GAME, 1, end, no_acks());
}

#[test]
fn large_path_proof_is_accepted() {
    let (prover, mock) = setup();
    let end = end_state(prover.contract_address, mock.contract_address);
    let expected = transition(prover.contract_address, mock.contract_address, @end);
    let mut f = facts(message_hash(prover.contract_address.into(), expected.span()));
    f.proof_version = 'PROOF2';
    inject(prover.contract_address, f);
    prover.settle(mock.contract_address, GAME, 0, end, no_acks());
    assert(mock.accepted() == state_hash::<GoRules>(@end), 'Wrong callback state');
}

#[test]
fn deployment_pins_the_os_program() {
    let (prover, _) = setup();
    assert(prover.os_program() == OS_PROGRAM, 'Wrong pinned OS program');
}

#[test]
fn zero_os_program_cannot_be_pinned() {
    let class = declare("ChannelProver").unwrap().contract_class();
    assert(class.deploy(@array![0]).is_err(), 'Zero OS program accepted');
}

fn check(f: ProofFacts) {
    let mut data = array![];
    f.serialize(ref data);
    check_facts(data.span(), 42, OS_PROGRAM, 30, 10);
}

#[test]
#[should_panic(expected: 'Wrong proof version')]
fn old_proof_schema_is_rejected() {
    let mut f = facts(42);
    f.proof_version = 'PROOF0';
    check(f);
}

#[test]
#[should_panic(expected: 'Wrong program variant')]
fn another_program_variant_is_rejected() {
    let mut f = facts(42);
    f.program_variant = 0;
    check(f);
}

#[test]
#[should_panic(expected: 'Wrong output version')]
fn another_output_schema_is_rejected() {
    let mut f = facts(42);
    f.output_version = 0;
    check(f);
}

#[test]
#[should_panic(expected: 'Wrong OS program')]
fn proof_of_another_os_program_is_rejected() {
    let mut f = facts(42);
    f.virtual_program_hash = OS_PROGRAM + 1;
    check(f);
}

#[test]
#[should_panic(expected: 'Proof predates anchor')]
fn stale_base_is_rejected() {
    let mut f = facts(42);
    f.base_block_number = 9;
    check(f);
}

#[test]
#[should_panic(expected: 'Invalid base block')]
fn future_base_is_rejected() {
    let mut f = facts(42);
    f.base_block_number = 30;
    check(f);
}

#[test]
#[should_panic(expected: 'Expired proof')]
fn expired_fact_is_rejected() {
    let mut data = array![];
    facts(42).serialize(ref data);
    check_facts(data.span(), 42, OS_PROGRAM, 4021, 10);
}

#[test]
#[should_panic(expected: 'Wrong proved transition')]
fn extra_messages_are_rejected() {
    let mut f = facts(42);
    f.messages = [42, 42].span();
    check(f);
}

#[test]
#[should_panic(expected: 'Trailing proof facts')]
fn trailing_facts_are_rejected() {
    let mut data = array![];
    facts(42).serialize(ref data);
    data.append(1);
    check_facts(data.span(), 42, OS_PROGRAM, 30, 10);
}

#[test]
#[should_panic(expected: 'Malformed proof facts')]
fn malformed_fact_is_rejected() {
    check_facts([1].span(), 42, OS_PROGRAM, 30, 10);
}
