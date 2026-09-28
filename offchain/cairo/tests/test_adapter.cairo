//! The Go proof adapter against a mock channel. The virtual `__execute__`
//! replays signed Go steps (and, in a ranked game, the referee's stamps and
//! attestation) and emits the transition message; `settle` accepts exactly
//! that message as proof facts and relays the end state. Proof facts are
//! cheated here; a real run attaches a native Stwo proof instead.
use referee::clocks::{Standard, encode};
use referee::{
    Batch, Envelope, Move, REASON_TIMEOUT, REFEREE, Signature, Terms, TimeControl, action_hash,
    actor, apply_steps, context_hash, open, stamp_hash, state_hash,
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
/// The keeper that referees ranked games.
const PK_REF: felt252 = 0x7e7e7e;
/// Signed moves replayed in the round trip (a prefix of a recorded game).
const MOVES: u32 = 12;

pub fn terms(
    channel: ContractAddress, game_id: felt252, prover: ContractAddress,
) -> Terms<GoConfig> {
    terms_for(channel, game_id, prover, false)
}

/// The mock channel's terms; a ranked game is timed at 60 s per turn,
/// refereed by PK_REF.
pub fn terms_for(
    channel: ContractAddress, game_id: felt252, prover: ContractAddress, timed: bool,
) -> Terms<GoConfig> {
    let keys = array![public_key(PK_BLACK), public_key(PK_WHITE)].span();
    let clock = if timed {
        let settings = Standard {
            turn_ms: 60000, bank_ms: 0, increment_ms: 0, byoyomi: Option::None,
        };
        Option::Some(TimeControl { referee: public_key(PK_REF), settings: encode(@settings) })
    } else {
        Option::None
    };
    Terms {
        chain_id: 'SN_SEPOLIA',
        channel: channel.into(),
        game_id,
        prover: prover.into(),
        response_seconds: 3600,
        clock,
        players: array![4, 5].span(),
        keys,
        // As in Surround's channel, session keys double as randomness tips.
        rng_tips: keys,
        config: GoConfig { size: 9, komi_half: 13 },
    }
}

pub fn opening(terms: @Terms<GoConfig>) -> Envelope<GoState> {
    open::<GoRules>(terms)
}

#[starknet::interface]
trait IMockChannel<T> {
    fn configure(ref self: T, prover: ContractAddress);
    fn set_timed(ref self: T, timed: bool);
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
        timed: bool,
        accepted: felt252,
    }

    #[abi(embed_v0)]
    impl MockImpl of super::IMockChannel<ContractState> {
        fn configure(ref self: ContractState, prover: ContractAddress) {
            self.prover.write(prover);
        }

        fn set_timed(ref self: ContractState, timed: bool) {
            self.timed.write(timed);
        }

        fn snapshot(
            self: @ContractState, game_id: felt252,
        ) -> (Terms<GoConfig>, u32, felt252, u64) {
            let terms = super::terms_for(
                get_contract_address(), game_id, self.prover.read(), self.timed.read(),
            );
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

/// The first MOVES moves of a recorded 9x9 game, then a flag if `flag`, with
/// the batch replay takes (each seat's final signature and, in a ranked game,
/// a stamp every 30 s and the referee's attestation) and the end state.
fn signed_moves_then(terms: @Terms<GoConfig>, flag: bool) -> (Batch<GoAction>, Envelope<GoState>) {
    let fixture = fixtures::cgos_9_1682827();
    let mut moves: Array<Move<GoAction>> = game_steps(@fixture).slice(0, MOVES).into();
    if flag {
        moves.append(Move::Flag);
    }
    let steps = moves.span();
    let timed = terms.clock.is_some();
    let mut stamps = array![];
    let context = context_hash::<GoRules>(terms);
    let mut env = opening(terms);
    let mut history = opening_history(terms.config);
    let zero = Signature { r: 0, s: 0 };
    let mut finals = array![zero, zero].span();
    let mut t: u64 = 1000;
    for step in steps {
        let seat = actor::<GoRules>(@env, step);
        let message = action_hash::<GoRules>(context, env.seq, env.transcript, step);
        finals =
            if seat == REFEREE {
                finals
            } else if seat == 0 {
                array![sign(message, PK_BLACK), *finals.at(1)].span()
            } else {
                array![*finals.at(0), sign(message, PK_WHITE)].span()
            };
        // The flag comes once the due seat's 60 s have run out.
        t += if seat == REFEREE {
            60001
        } else {
            30000
        };
        let stamp = if timed {
            array![t].span()
        } else {
            array![].span()
        };
        stamps.append_span(stamp);
        let before = env.game.board;
        env = apply_steps::<GoRules>(context, terms, env, history, array![*step].span(), stamp);
        if env.game.board != before {
            let mut next: Array<felt252> = history.into();
            next.append(rules::position_hash(env.game.board, 9));
            history = next.span();
        }
    }
    let attestation = match env.clock {
        Option::Some(clock) => sign(
            stamp_hash::<GoRules>(context, env.seq, env.transcript, @clock), PK_REF,
        ),
        Option::None => zero,
    };
    (Batch { steps, stamps: stamps.span(), signatures: finals, attestation }, env)
}

fn signed_moves(terms: @Terms<GoConfig>) -> (Batch<GoAction>, Envelope<GoState>) {
    signed_moves_then(terms, false)
}

/// Run `__execute__` as the OS runs a zero-fee virtual invoke.
fn execute_virtual(
    prover: ContractAddress,
    channel: ContractAddress,
    start: Envelope<GoState>,
    history: Span<felt252>,
    batch: Batch<GoAction>,
) {
    start_cheat_caller_address(prover, 0.try_into().unwrap());
    start_cheat_transaction_version(prover, 3);
    let free = array![
        ResourcesBounds { resource: 'L1_GAS', max_amount: 0, max_price_per_unit: 0 },
        ResourcesBounds { resource: 'L2_GAS', max_amount: 0, max_price_per_unit: 0 },
        ResourcesBounds { resource: 'L1_DATA', max_amount: 0, max_price_per_unit: 0 },
    ];
    cheat_resource_bounds(prover, free.span(), CheatSpan::TargetCalls(1));
    IVirtualChannelDispatcher { contract_address: prover }
        .__execute__(channel, GAME, 0, start, history, batch);
}

fn transition(
    prover: ContractAddress, channel: ContractAddress, end: @Envelope<GoState>,
) -> Array<felt252> {
    transition_for(prover, channel, end, false)
}

fn transition_for(
    prover: ContractAddress, channel: ContractAddress, end: @Envelope<GoState>, timed: bool,
) -> Array<felt252> {
    let terms = terms_for(channel, GAME, prover, timed);
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
    let (_, end) = signed_moves(@terms(channel, GAME, prover));
    end
}

#[test]
fn virtual_replay_emits_the_message_settle_accepts() {
    let (prover, mock) = setup();
    let terms = terms(mock.contract_address, GAME, prover.contract_address);
    let (batch, end) = signed_moves(@terms);

    // Proving path: the OS runs __execute__ as a zero-fee virtual invoke.
    let mut spy = spy_messages_to_l1();
    execute_virtual(
        prover.contract_address,
        mock.contract_address,
        opening(@terms),
        opening_history(@terms.config),
        batch,
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
    let (batch, _) = signed_moves(@terms);
    execute_virtual(
        prover.contract_address, mock.contract_address, opening(@terms), array![999].span(), batch,
    );
}

#[test]
fn timed_replay_emits_the_attested_transition() {
    let (prover, mock) = setup();
    mock.set_timed(true);
    let terms = terms_for(mock.contract_address, GAME, prover.contract_address, true);
    let (batch, end) = signed_moves(@terms);
    assert(batch.stamps.len() == batch.steps.len(), 'Expected a stamp per step');
    let mut spy = spy_messages_to_l1();
    execute_virtual(
        prover.contract_address,
        mock.contract_address,
        opening(@terms),
        opening_history(@terms.config),
        batch,
    );
    let expected = transition_for(prover.contract_address, mock.contract_address, @end, true);
    spy
        .assert_sent(
            @array![
                (
                    prover.contract_address,
                    MessageToL1 { to_address: 0.try_into().unwrap(), payload: expected.clone() },
                ),
            ],
        );
    inject(
        prover.contract_address,
        facts(message_hash(prover.contract_address.into(), expected.span())),
    );
    prover.settle(mock.contract_address, GAME, 0, end, no_acks());
    assert(mock.accepted() == state_hash::<GoRules>(@end), 'Wrong callback state');
}

#[test]
fn flagged_game_proves_like_any_other() {
    let (prover, mock) = setup();
    mock.set_timed(true);
    let terms = terms_for(mock.contract_address, GAME, prover.contract_address, true);
    let (batch, end) = signed_moves_then(@terms, true);
    assert(end.outcome.reason == REASON_TIMEOUT, 'Expected a timeout');
    let mut spy = spy_messages_to_l1();
    execute_virtual(
        prover.contract_address,
        mock.contract_address,
        opening(@terms),
        opening_history(@terms.config),
        batch,
    );
    let expected = transition_for(prover.contract_address, mock.contract_address, @end, true);
    spy
        .assert_sent(
            @array![
                (
                    prover.contract_address,
                    MessageToL1 { to_address: 0.try_into().unwrap(), payload: expected },
                ),
            ],
        );
}

#[test]
#[should_panic(expected: ('Invalid session signature', 'ENTRYPOINT_FAILED'))]
fn timed_replay_needs_the_referee() {
    let (prover, mock) = setup();
    mock.set_timed(true);
    let terms = terms_for(mock.contract_address, GAME, prover.contract_address, true);
    let (batch, end) = signed_moves(@terms);
    let context = context_hash::<GoRules>(@terms);
    let clock = end.clock.unwrap();
    // Signed by a seat instead of the referee.
    let forged = sign(stamp_hash::<GoRules>(context, end.seq, end.transcript, @clock), PK_BLACK);
    execute_virtual(
        prover.contract_address,
        mock.contract_address,
        opening(@terms),
        opening_history(@terms.config),
        Batch { attestation: forged, ..batch },
    );
}

#[test]
#[should_panic(expected: ('Wrong stamp count', 'ENTRYPOINT_FAILED'))]
fn timed_replay_needs_the_stamps() {
    let (prover, mock) = setup();
    mock.set_timed(true);
    // Signed for the ranked terms, sent without stamps.
    let terms = terms_for(mock.contract_address, GAME, prover.contract_address, true);
    let (batch, _) = signed_moves(@terms);
    execute_virtual(
        prover.contract_address,
        mock.contract_address,
        opening(@terms),
        opening_history(@terms.config),
        Batch { stamps: array![].span(), ..batch },
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
