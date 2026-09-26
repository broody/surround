//! Surround's channel in a Dojo test world: recorded games settle through
//! `submit_history`, disputes fall back to forced onchain Go, and the
//! superko witness cannot be erased.
use dojo::world::{WorldStorage, WorldStorageTrait, world};
use dojo_cairo_test::{
    ContractDef, ContractDefTrait, NamespaceDef, TestResource, WorldStorageTestTrait,
    spawn_test_world,
};
use referee::channel::{ACTIVE, DISPUTE, FORCED, SETTLED};
use referee::{
    Envelope, Move, REASON_RESIGN, REASON_TIMEOUT, Signature, Terms, action_hash, actor,
    apply_steps, checkpoint_hash, context_hash, open, reopen_hash, state_hash,
};
use referee_dojo::models::{e_ChannelUpdated, m_ChannelGame, m_ProverAllowed};
use referee_testing::{public_key, sign};
use starknet::ContractAddress;
use starknet::testing::{set_account_contract_address, set_block_timestamp, set_contract_address};
use surround_rules::fixtures::{self, ReplayFixture};
use surround_rules::go::{AGREEMENT, GoAction, GoConfig, GoRules, GoState};
use surround_rules::replay::{config, game_steps, opening_history, stone};
use surround_rules::rules::{self, BLACK, WHITE};
use crate::systems::channel::{IChannelDispatcher, IChannelDispatcherTrait, channel};

const PK_BLACK: felt252 = 0x1a2b3c;
const PK_WHITE: felt252 = 0x4d5e6f;
const WINDOW: u32 = 3600;

fn black() -> ContractAddress {
    'BLACK'.try_into().unwrap()
}

fn white() -> ContractAddress {
    'WHITE'.try_into().unwrap()
}

fn keeper() -> ContractAddress {
    'KEEPER'.try_into().unwrap()
}

fn caller(address: ContractAddress) {
    set_contract_address(address);
    set_account_contract_address(address);
}

fn setup() -> IChannelDispatcher {
    let ndef = NamespaceDef {
        namespace: "surround",
        resources: [
            TestResource::Model(m_ChannelGame::TEST_CLASS_HASH),
            TestResource::Model(m_ProverAllowed::TEST_CLASS_HASH),
            TestResource::Event(e_ChannelUpdated::TEST_CLASS_HASH),
            TestResource::Contract(channel::TEST_CLASS_HASH),
        ]
            .span(),
    };
    let defs: Span<ContractDef> = [
        ContractDefTrait::new(@"surround", @"channel")
            .with_writer_of([dojo::utils::bytearray_hash(@"surround")].span()),
    ]
        .span();
    let mut world: WorldStorage = spawn_test_world(world::TEST_CLASS_HASH, [ndef].span());
    world.sync_perms_and_inits(defs);
    let (contract_address, _) = world.dns(@"channel").unwrap();
    IChannelDispatcher { contract_address }
}

/// Black creates, white joins. The channel system itself stands in as the
/// trusted prover; these tests settle by onchain replay.
fn started(config: GoConfig) -> (IChannelDispatcher, felt252) {
    let api = setup();
    api.allow_prover(channel::TEST_CLASS_HASH.try_into().unwrap(), true);
    caller(black());
    let id = api
        .create_channel(
            config.size,
            config.komi_half,
            white(),
            public_key(PK_BLACK),
            api.contract_address,
            WINDOW,
        );
    caller(white());
    api.join_channel(id, public_key(PK_WHITE));
    (api, id)
}

fn opening(terms: @Terms<GoConfig>) -> Envelope<GoState> {
    open::<GoRules>(terms.config, *terms.rng_tips)
}

/// Sign each step as the two clients would, tracking the superko witness.
/// Returns each seat's final signature, as replay takes them, and the end state.
fn sign_game(
    terms: @Terms<GoConfig>, steps: Span<Move<GoAction>>,
) -> (Span<Signature>, Envelope<GoState>) {
    let context = context_hash::<GoRules>(terms);
    let size = *terms.config.size;
    let mut env = opening(terms);
    let mut history = opening_history(terms.config);
    let mut finals = no_approvals();
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
            next.append(rules::position_hash(env.game.board, size));
            history = next.span();
        }
    }
    (finals, env)
}

fn approvals(message: felt252) -> Span<Signature> {
    array![sign(message, PK_BLACK), sign(message, PK_WHITE)].span()
}

fn no_approvals() -> Span<Signature> {
    array![Signature { r: 0, s: 0 }, Signature { r: 0, s: 0 }].span()
}

fn settle_recorded(fixture: ReplayFixture) {
    let (api, id) = started(config(@fixture));
    let terms = api.terms(id);
    let steps = game_steps(@fixture);
    let (finals, end) = sign_game(@terms, steps);
    let context = context_hash::<GoRules>(@terms);
    let acks = approvals(checkpoint_hash::<GoRules>(context, 0, state_hash::<GoRules>(@end)));
    caller(keeper());
    api.submit_history(id, 0, opening(@terms), opening_history(@terms.config), steps, finals, acks);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    assert_eq!(channel.anchor.hash, state_hash::<GoRules>(@end));
    assert_eq!(channel.result.reason, AGREEMENT);
    let winner = if fixture.margin_half > 0 {
        BLACK
    } else {
        WHITE
    };
    assert_eq!(channel.result.winner, winner);
}

/// Dispute from the opening anchor and resolve into forced play (epoch 1).
fn forced_play() -> (IChannelDispatcher, felt252) {
    let (api, id) = started(GoConfig { size: 9, komi_half: 13 });
    caller(black());
    api.open_dispute(id, 0);
    set_block_timestamp(WINDOW.into());
    api.resolve_dispute(id, 0);
    (api, id)
}

#[test]
#[available_gas(100000000000)]
fn join_fixes_context_and_opening_anchor() {
    let (api, id) = started(GoConfig { size: 19, komi_half: 13 });
    let terms = api.terms(id);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, ACTIVE);
    assert_eq!(channel.context, context_hash::<GoRules>(@terms));
    assert_eq!(channel.anchor.hash, state_hash::<GoRules>(@opening(@terms)));
    assert_eq!(channel.anchor.due, 0);
}

#[test]
#[available_gas(100000000000)]
fn recorded_9x9_game_settles_in_one_transaction() {
    settle_recorded(fixtures::cgos_9_1682827());
}

#[test]
#[available_gas(1000000000000)]
fn recorded_13x13_game_settles_in_one_transaction() {
    settle_recorded(fixtures::cgos_13_277988());
}

#[test]
#[available_gas(100000000000)]
fn unapproved_result_settles_after_the_window() {
    let fixture = fixtures::cgos_9_1682833();
    let (api, id) = started(config(@fixture));
    let terms = api.terms(id);
    let steps = game_steps(@fixture);
    let (finals, _) = sign_game(@terms, steps);
    caller(white());
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), steps, finals, no_approvals(),
        );
    assert_eq!(api.get_channel(id).status, DISPUTE);
    set_block_timestamp(WINDOW.into());
    api.resolve_dispute(id, 0);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    assert_eq!(channel.result.winner, WHITE);
}

#[test]
#[available_gas(100000000000)]
fn forced_move_then_timeout() {
    let (api, id) = forced_play();
    let terms = api.terms(id);
    assert_eq!(api.get_channel(id).status, FORCED);
    caller(black());
    api
        .force_steps(
            id, 1, opening(@terms), opening_history(@terms.config), array![stone(40)].span(),
        );
    let channel = api.get_channel(id);
    assert_eq!(channel.anchor.due, 1);
    set_block_timestamp(channel.deadline);
    api.claim_timeout(id, 2);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    assert_eq!(channel.result.winner, BLACK);
    assert_eq!(channel.result.reason, REASON_TIMEOUT);
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Wrong position history', 'ENTRYPOINT_FAILED'))]
fn forced_move_cannot_erase_superko_history() {
    let (api, id) = forced_play();
    let terms = api.terms(id);
    caller(black());
    api.force_steps(id, 1, opening(@terms), array![999].span(), array![stone(40)].span());
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Not your step', 'ENTRYPOINT_FAILED'))]
fn white_cannot_play_blacks_forced_move() {
    let (api, id) = forced_play();
    let terms = api.terms(id);
    caller(white());
    api
        .force_steps(
            id, 1, opening(@terms), opening_history(@terms.config), array![stone(40)].span(),
        );
}

#[test]
#[available_gas(100000000000)]
fn both_players_can_resume_offchain_play() {
    let (api, id) = forced_play();
    let terms = api.terms(id);
    let anchor = api.get_channel(id).anchor.hash;
    let context = context_hash::<GoRules>(@terms);
    api.resume_channel(id, 1, approvals(reopen_hash::<GoRules>(context, 1, anchor)));
    assert_eq!(api.get_channel(id).status, ACTIVE);
}

#[test]
#[available_gas(100000000000)]
fn wallet_resignation_needs_no_prover() {
    let (api, id) = started(GoConfig { size: 9, komi_half: 13 });
    caller(black());
    api.resign_channel(id);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    assert_eq!(channel.result.winner, WHITE);
    assert_eq!(channel.result.reason, REASON_RESIGN);
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Untrusted prover class', 'ENTRYPOINT_FAILED'))]
fn untrusted_prover_rejected() {
    let api = setup();
    caller(black());
    api.create_channel(9, 13, white(), public_key(PK_BLACK), api.contract_address, WINDOW);
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Unsupported board size', 'ENTRYPOINT_FAILED'))]
fn unsupported_board_size_rejected() {
    let api = setup();
    api.allow_prover(channel::TEST_CLASS_HASH.try_into().unwrap(), true);
    caller(black());
    api.create_channel(10, 13, white(), public_key(PK_BLACK), api.contract_address, WINDOW);
}
