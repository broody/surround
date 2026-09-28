//! Surround's channel in a Dojo test world: recorded games settle through
//! `submit_history`, disputes fall back to forced onchain Go, and the
//! superko witness cannot be erased. Ranked games are timed: the referee's
//! stamps and attestation replay onchain, a flag settles as a timeout, and
//! forced play pauses the clock.
use dojo::world::{WorldStorage, WorldStorageTrait, world};
use dojo_cairo_test::{
    ContractDef, ContractDefTrait, NamespaceDef, TestResource, WorldStorageTestTrait,
    spawn_test_world,
};
use referee::channel::{ACTIVE, DISPUTE, FORCED, SETTLED};
use referee::clocks::{Byoyomi, Standard, StandardClock, decode, encode};
use referee::{
    Batch, Clock, Envelope, Move, REASON_RESIGN, REASON_TIMEOUT, REFEREE, Signature, Terms,
    TimeControl, action_hash, actor, apply_steps, checkpoint_hash, context_hash, force, open,
    reopen_hash, stamp_hash, state_hash,
};
use referee_dojo::models::{e_ChannelUpdated, m_ChannelGame, m_ProverAllowed};
use referee_testing::{public_key, sign};
use starknet::ContractAddress;
use starknet::testing::{set_account_contract_address, set_block_timestamp, set_contract_address};
use surround_rules::fixtures::{self, ReplayFixture};
use surround_rules::go::{AGREEMENT, GoAction, GoConfig, GoRules, GoState};
use surround_rules::replay::{config, game_steps, opening_history, stone};
use surround_rules::rules::{self, BLACK, WHITE};
use crate::models::{
    e_KifuSummary, e_PlayerRank, e_RatingChanged, m_Kifu, m_RatedGame, m_RatingsConfig,
    m_Settlement,
};
use crate::systems::channel::{IChannelDispatcher, IChannelDispatcherTrait, channel};
use crate::systems::kifu::kifu;

const PK_BLACK: felt252 = 0x1a2b3c;
const PK_WHITE: felt252 = 0x4d5e6f;
/// The keeper that referees ranked games.
const PK_REF: felt252 = 0x7e7e7e;
pub const WINDOW: u32 = 3600;
const TURN: u64 = 60000;

pub fn black() -> ContractAddress {
    'BLACK'.try_into().unwrap()
}

pub fn white() -> ContractAddress {
    'WHITE'.try_into().unwrap()
}

pub fn keeper() -> ContractAddress {
    'KEEPER'.try_into().unwrap()
}

pub fn caller(address: ContractAddress) {
    set_contract_address(address);
    set_account_contract_address(address);
}

/// The Surround namespace: the channel and Kifu, with their models.
pub fn deploy() -> WorldStorage {
    let ndef = NamespaceDef {
        namespace: "surround",
        resources: [
            TestResource::Model(m_ChannelGame::TEST_CLASS_HASH),
            TestResource::Model(m_ProverAllowed::TEST_CLASS_HASH),
            TestResource::Event(e_ChannelUpdated::TEST_CLASS_HASH),
            TestResource::Model(m_Settlement::TEST_CLASS_HASH),
            TestResource::Model(m_RatedGame::TEST_CLASS_HASH),
            TestResource::Model(m_RatingsConfig::TEST_CLASS_HASH),
            TestResource::Event(e_PlayerRank::TEST_CLASS_HASH),
            TestResource::Event(e_RatingChanged::TEST_CLASS_HASH),
            TestResource::Model(m_Kifu::TEST_CLASS_HASH),
            TestResource::Event(e_KifuSummary::TEST_CLASS_HASH),
            TestResource::Contract(channel::TEST_CLASS_HASH),
            TestResource::Contract(kifu::TEST_CLASS_HASH),
        ]
            .span(),
    };
    let defs: Span<ContractDef> = [
        ContractDefTrait::new(@"surround", @"channel")
            .with_writer_of([dojo::utils::bytearray_hash(@"surround")].span()),
        ContractDefTrait::new(@"surround", @"kifu")
            .with_writer_of(
                [selector_from_tag!("surround-Kifu"), selector_from_tag!("surround-KifuSummary")]
                    .span(),
            ),
    ]
        .span();
    let mut world: WorldStorage = spawn_test_world(world::TEST_CLASS_HASH, [ndef].span());
    world.sync_perms_and_inits(defs);
    world
}

fn setup() -> IChannelDispatcher {
    channel_in(deploy())
}

pub fn channel_in(world: WorldStorage) -> IChannelDispatcher {
    let (contract_address, _) = world.dns(@"channel").unwrap();
    IChannelDispatcher { contract_address }
}

/// A time control refereed by PK_REF.
fn refereed(settings: Standard) -> Option<TimeControl> {
    Option::Some(TimeControl { referee: public_key(PK_REF), settings: encode(@settings) })
}

/// Surround's per-turn timer: 60 s per turn.
pub fn ranked() -> Option<TimeControl> {
    refereed(Standard { turn_ms: TURN, bank_ms: 0, increment_ms: 0, byoyomi: Option::None })
}

/// Byo-yomi in these tests: 60 s of main time, then 3 periods of 10 s.
fn byoyomi() -> Option<TimeControl> {
    refereed(
        Standard {
            turn_ms: 0,
            bank_ms: 60000,
            increment_ms: 0,
            byoyomi: Option::Some(Byoyomi { periods: 3, period_ms: 10000 }),
        },
    )
}

/// The per-turn timer's clocks: no bank and no periods.
fn no_bank() -> Span<felt252> {
    encode(@StandardClock { banks: array![0, 0].span(), periods: array![].span() })
}

/// Black creates, white joins. The channel system itself stands in as the
/// trusted prover; these tests settle by onchain replay.
fn started(config: GoConfig) -> (IChannelDispatcher, felt252) {
    started_with(config, Option::None)
}

fn started_with(config: GoConfig, clock: Option<TimeControl>) -> (IChannelDispatcher, felt252) {
    started_in(deploy(), config, clock)
}

pub fn started_in(
    world: WorldStorage, config: GoConfig, clock: Option<TimeControl>,
) -> (IChannelDispatcher, felt252) {
    let api = channel_in(world);
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
            clock,
        );
    caller(white());
    api.join_channel(id, public_key(PK_WHITE));
    (api, id)
}

pub fn opening(terms: @Terms<GoConfig>) -> Envelope<GoState> {
    open::<GoRules>(terms)
}

/// Sign each step as the two clients would and, in a timed game, stamp it as
/// the referee would, tracking the superko witness from `history`. Returns the
/// batch replay takes (each seat's final signature, the stamps and the
/// referee's final attestation) and the end state.
pub fn stamp_game(
    terms: @Terms<GoConfig>,
    start: Envelope<GoState>,
    history: Span<felt252>,
    steps: Span<Move<GoAction>>,
    stamps: Span<u64>,
) -> (Batch<GoAction>, Envelope<GoState>) {
    let context = context_hash::<GoRules>(terms);
    let size = *terms.config.size;
    let mut env = start;
    let mut history = history;
    let mut finals = no_approvals();
    let mut i = 0;
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
        let stamp = if stamps.is_empty() {
            stamps
        } else {
            stamps.slice(i, 1)
        };
        let before = env.game.board;
        env = apply_steps::<GoRules>(context, terms, env, history, array![*step].span(), stamp);
        if env.game.board != before {
            let mut next: Array<felt252> = history.into();
            next.append(rules::position_hash(env.game.board, size));
            history = next.span();
        }
        i += 1;
    }
    let attestation = match env.clock {
        Option::Some(clock) => sign(
            stamp_hash::<GoRules>(context, env.seq, env.transcript, @clock), PK_REF,
        ),
        Option::None => Signature { r: 0, s: 0 },
    };
    (Batch { steps, stamps, signatures: finals, attestation }, env)
}

/// Sign an untimed game from the opening.
pub fn sign_game(
    terms: @Terms<GoConfig>, steps: Span<Move<GoAction>>,
) -> (Batch<GoAction>, Envelope<GoState>) {
    stamp_game(terms, opening(terms), opening_history(terms.config), steps, array![].span())
}

/// One stamp per step, `interval` ms apart from the first at 1 s.
pub fn every(interval: u64, steps: Span<Move<GoAction>>) -> Span<u64> {
    let mut stamps = array![];
    let mut t = 1000;
    for _ in steps {
        stamps.append(t);
        t += interval;
    }
    stamps.span()
}

pub fn approvals(message: felt252) -> Span<Signature> {
    array![sign(message, PK_BLACK), sign(message, PK_WHITE)].span()
}

pub fn no_approvals() -> Span<Signature> {
    array![Signature { r: 0, s: 0 }, Signature { r: 0, s: 0 }].span()
}

fn settle_recorded(fixture: ReplayFixture) {
    let (api, id) = started(config(@fixture));
    let terms = api.terms(id);
    let steps = game_steps(@fixture);
    let (batch, end) = sign_game(@terms, steps);
    let context = context_hash::<GoRules>(@terms);
    let acks = approvals(checkpoint_hash::<GoRules>(context, 0, state_hash::<GoRules>(@end)));
    caller(keeper());
    api.submit_history(id, 0, opening(@terms), opening_history(@terms.config), batch, acks);
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
    let (batch, _) = sign_game(@terms, game_steps(@fixture));
    caller(white());
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
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
    api
        .create_channel(
            9, 13, white(), public_key(PK_BLACK), api.contract_address, WINDOW, Option::None,
        );
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Unsupported board size', 'ENTRYPOINT_FAILED'))]
fn unsupported_board_size_rejected() {
    let api = setup();
    api.allow_prover(channel::TEST_CLASS_HASH.try_into().unwrap(), true);
    caller(black());
    api
        .create_channel(
            10, 13, white(), public_key(PK_BLACK), api.contract_address, WINDOW, Option::None,
        );
}

#[test]
#[available_gas(100000000000)]
fn ranked_terms_carry_the_clock() {
    let (api, id) = started_with(GoConfig { size: 19, komi_half: 13 }, ranked());
    let terms = api.terms(id);
    assert_eq!(terms.clock, ranked());
    let channel = api.get_channel(id);
    assert_eq!(channel.referee, public_key(PK_REF));
    assert_eq!(decode::<Standard>(channel.clock_settings).turn_ms, TURN);
    assert_eq!(channel.context, context_hash::<GoRules>(@terms));
    assert_eq!(channel.anchor.hash, state_hash::<GoRules>(@opening(@terms)));
    assert_eq!(opening(@terms).clock, Option::Some(Clock { seats: no_bank(), used: 0, stamp: 0 }));
}

#[test]
#[available_gas(1000000000000)]
fn stamped_recorded_game_settles_in_one_transaction() {
    let fixture = fixtures::cgos_9_1682827();
    let (api, id) = started_with(config(@fixture), ranked());
    let terms = api.terms(id);
    let steps = game_steps(@fixture);
    // Every answer, scoring included, inside its 60 s turn.
    let (batch, end) = stamp_game(
        @terms, opening(@terms), opening_history(@terms.config), steps, every(59000, steps),
    );
    let context = context_hash::<GoRules>(@terms);
    let acks = approvals(checkpoint_hash::<GoRules>(context, 0, state_hash::<GoRules>(@end)));
    caller(keeper());
    api.submit_history(id, 0, opening(@terms), opening_history(@terms.config), batch, acks);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    assert_eq!(channel.anchor.hash, state_hash::<GoRules>(@end));
    assert_eq!(channel.result.winner, BLACK);
    assert_eq!(channel.result.reason, AGREEMENT);
}

#[test]
#[available_gas(100000000000)]
fn flag_settles_as_a_timeout() {
    let (api, id) = started_with(GoConfig { size: 9, komi_half: 13 }, ranked());
    let terms = api.terms(id);
    // Black plays; white lets its 60 s run out and the referee flags it.
    let steps = array![stone(40), Move::Flag].span();
    let (batch, end) = stamp_game(
        @terms, opening(@terms), opening_history(@terms.config), steps, array![1000, 61001].span(),
    );
    assert_eq!(end.outcome.reason, REASON_TIMEOUT);
    // The flagged seat will not approve it; the winner's submission waits out
    // the dispute window.
    caller(black());
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
    assert_eq!(api.get_channel(id).status, DISPUTE);
    set_block_timestamp(WINDOW.into());
    api.resolve_dispute(id, 0);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    assert_eq!(channel.result.winner, BLACK);
    assert_eq!(channel.result.reason, REASON_TIMEOUT);
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Clock not expired', 'ENTRYPOINT_FAILED'))]
fn no_flag_inside_the_turn() {
    let (api, id) = started_with(GoConfig { size: 9, komi_half: 13 }, ranked());
    let terms = api.terms(id);
    let steps = array![stone(40), Move::Flag].span();
    let (batch, _) = stamp_game(
        @terms, opening(@terms), opening_history(@terms.config), steps, array![1000, 61001].span(),
    );
    // The same flag a millisecond earlier, while white still had time.
    let batch = Batch { stamps: array![1000, 61000].span(), ..batch };
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Invalid session signature', 'ENTRYPOINT_FAILED'))]
fn stamps_need_the_referees_attestation() {
    let (api, id) = started_with(GoConfig { size: 9, komi_half: 13 }, ranked());
    let terms = api.terms(id);
    let steps = array![stone(40), stone(41)].span();
    let (batch, end) = stamp_game(
        @terms, opening(@terms), opening_history(@terms.config), steps, array![1000, 2000].span(),
    );
    // The same attestation, signed by a seat instead of the referee.
    let context = context_hash::<GoRules>(@terms);
    let clock = end.clock.unwrap();
    let forged = sign(stamp_hash::<GoRules>(context, end.seq, end.transcript, @clock), PK_BLACK);
    let batch = Batch { attestation: forged, ..batch };
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Wrong stamp count', 'ENTRYPOINT_FAILED'))]
fn ranked_steps_need_their_stamps() {
    let (api, id) = started_with(GoConfig { size: 9, komi_half: 13 }, ranked());
    let terms = api.terms(id);
    let (batch, _) = sign_game(@terms, array![stone(40)].span());
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
}

#[test]
#[available_gas(100000000000)]
fn forced_play_pauses_the_clock() {
    let config = GoConfig { size: 9, komi_half: 13 };
    let (api, id) = started_with(config, ranked());
    let terms = api.terms(id);
    let context = context_hash::<GoRules>(@terms);
    // The referee is down: black disputes and the window resolves into forced
    // play on the channel's windows.
    caller(black());
    api.open_dispute(id, 0);
    set_block_timestamp(WINDOW.into());
    api.resolve_dispute(id, 0);
    api.force_steps(id, 1, opening(@terms), opening_history(@config), array![stone(40)].span());
    let forced = force::<
        GoRules,
    >(context, @terms, opening(@terms), opening_history(@config), 0, array![stone(40)].span());
    assert_eq!(forced.clock.unwrap(), Clock { seats: no_bank(), used: 0, stamp: 0 });
    let anchor = api.get_channel(id).anchor.hash;
    assert_eq!(anchor, state_hash::<GoRules>(@forced));
    // Back offchain, the next stamp restarts the clock without charging
    // white for the hours spent onchain.
    api.resume_channel(id, 2, approvals(reopen_hash::<GoRules>(context, 2, anchor)));
    let mut history: Array<felt252> = opening_history(@config).into();
    history.append(rules::position_hash(forced.game.board, 9));
    let steps = array![stone(41), stone(42)].span();
    let (batch, end) = stamp_game(
        @terms, forced, history.span(), steps, array![10000000, 10030000].span(),
    );
    assert_eq!(end.clock.unwrap(), Clock { seats: no_bank(), used: 0, stamp: 10030000 });
    let acks = approvals(checkpoint_hash::<GoRules>(context, 3, state_hash::<GoRules>(@end)));
    api.submit_history(id, 3, forced, history.span(), batch, acks);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, ACTIVE);
    assert_eq!(channel.anchor.hash, state_hash::<GoRules>(@end));
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Referee is a seat', 'ENTRYPOINT_FAILED'))]
fn a_seat_cannot_referee() {
    let api = setup();
    api.allow_prover(channel::TEST_CLASS_HASH.try_into().unwrap(), true);
    caller(black());
    let clock = TimeControl { referee: public_key(PK_BLACK), settings: ranked().unwrap().settings };
    api
        .create_channel(
            9, 13, white(), public_key(PK_BLACK), api.contract_address, WINDOW, Option::Some(clock),
        );
}

#[test]
#[available_gas(100000000000)]
fn byoyomi_game_loses_a_period_then_flags() {
    let (api, id) = started_with(GoConfig { size: 9, komi_half: 13 }, byoyomi());
    let terms = api.terms(id);
    assert_eq!(terms.clock, byoyomi());
    let channel = api.get_channel(id);
    let settings: Standard = decode(channel.clock_settings);
    assert_eq!(settings.byoyomi, Option::Some(Byoyomi { periods: 3, period_ms: 10000 }));
    // White spends its main time and 15 s: one period lost. Then, with 20 s
    // of periods left, it stalls and the referee flags it.
    let steps = array![stone(40), stone(41), stone(42), Move::Flag].span();
    let (batch, end) = stamp_game(
        @terms,
        opening(@terms),
        opening_history(@terms.config),
        steps,
        array![1000, 76000, 77000, 97001].span(),
    );
    let seats: StandardClock = decode(end.clock.unwrap().seats);
    assert_eq!(seats.periods, array![3, 2].span());
    caller(black());
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
    set_block_timestamp(WINDOW.into());
    api.resolve_dispute(id, 0);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    assert_eq!(channel.result.winner, BLACK);
    assert_eq!(channel.result.reason, REASON_TIMEOUT);
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Invalid byo-yomi', 'ENTRYPOINT_FAILED'))]
fn byoyomi_needs_a_period() {
    let api = setup();
    api.allow_prover(channel::TEST_CLASS_HASH.try_into().unwrap(), true);
    caller(black());
    let clock = refereed(
        Standard {
            turn_ms: 0,
            bank_ms: 60000,
            increment_ms: 0,
            byoyomi: Option::Some(Byoyomi { periods: 0, period_ms: 10000 }),
        },
    );
    api.create_channel(9, 13, white(), public_key(PK_BLACK), api.contract_address, WINDOW, clock);
}
