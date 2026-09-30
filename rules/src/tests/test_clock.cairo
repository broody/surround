//! Referee clocks under Go's turn order, with the standard time rules. A turn
//! runs while `due` stays with one seat, so scoring steps are timed like moves
//! and a proposer's own resume does not restart its turn. Ranked games use
//! Surround's per-turn timer (60 s per turn) or Japanese byo-yomi.
use referee::clocks::{Byoyomi, Standard, StandardClock, decode, encode};
use referee::{Clock, Envelope, Move, REASON_TIMEOUT, Terms, TimeControl, apply_steps, force, open};
use crate::go::{GoAction, GoConfig, GoRules, GoState, PLAYING};
use crate::replay::{go, opening_history, pass, stone};
use crate::rules::{self, WHITE};

const TURN: u64 = 60000;
/// Byo-yomi in these tests: 60 s of main time, then 3 periods of 10 s.
const MAIN: u64 = 60000;
const PERIOD: u64 = 10000;

fn per_turn() -> Standard {
    Standard { turn_ms: TURN, bank_ms: 0, increment_ms: 0, byoyomi: Option::None }
}

fn byoyomi() -> Standard {
    Standard {
        turn_ms: 0,
        bank_ms: MAIN,
        increment_ms: 0,
        byoyomi: Option::Some(Byoyomi { periods: 3, period_ms: PERIOD }),
    }
}

fn terms_with(settings: Standard) -> Terms<GoConfig> {
    Terms {
        chain_id: 'SN_TEST',
        channel: 0xc4a11e1,
        game_id: 1,
        prover: 0xad0b7e5,
        response_seconds: 3600,
        clock: Option::Some(
            TimeControl { referee: 0x7e7e7e, settings: encode(@settings), rng_tip: 0 },
        ),
        players: array!['BLACK', 'WHITE'].span(),
        keys: array![0x1a2b3c, 0x4d5e6f].span(),
        rng_tips: array![1, 2].span(),
        config: GoConfig { size: 9, komi_half: 13 },
    }
}

fn terms() -> Terms<GoConfig> {
    terms_with(per_turn())
}

fn opening() -> Envelope<GoState> {
    open::<GoRules>(@terms())
}

/// Apply stamped steps from the opening position under `settings`.
fn run_with(
    settings: Standard, steps: Array<Move<GoAction>>, stamps: Array<u64>,
) -> Envelope<GoState> {
    let t = terms_with(settings);
    apply_steps::<
        GoRules,
    >(0, @t, open::<GoRules>(@t), opening_history(@t.config), steps.span(), stamps.span())
}

fn run(steps: Array<Move<GoAction>>, stamps: Array<u64>) -> Envelope<GoState> {
    run_with(per_turn(), steps, stamps)
}

fn clock(env: @Envelope<GoState>) -> Clock {
    (*env.clock).unwrap()
}

/// Each seat's bank and byo-yomi periods.
fn seats(env: @Envelope<GoState>) -> StandardClock {
    decode(clock(env).seats)
}

/// The per-turn timer's clocks: no bank and no periods, whatever happens.
fn no_bank() -> Span<felt252> {
    encode(@StandardClock { banks: array![0, 0].span(), periods: array![].span() })
}

/// Black's stone at 40, stamped at 1 s, and the position history after it.
fn black_moved() -> (Envelope<GoState>, Span<felt252>) {
    let env = run(array![stone(40)], array![1000]);
    let mut history: Array<felt252> = opening_history(@terms().config).into();
    history.append(rules::position_hash(env.game.board, 9));
    (env, history.span())
}

#[test]
fn a_game_opens_with_a_paused_turn_clock() {
    assert_eq!(clock(@opening()), Clock { seats: no_bank(), used: 0, stamp: 0 });
}

#[test]
fn every_move_starts_a_fresh_turn() {
    let env = run(array![stone(40), stone(41)], array![1000, 60000]);
    assert_eq!(clock(@env), Clock { seats: no_bank(), used: 0, stamp: 60000 });
}

#[test]
#[should_panic(expected: 'Flag fell')]
fn the_proposer_is_on_the_clock() {
    // After two passes black is due to propose, with one turn to do it.
    run(
        array![pass(), pass(), go(GoAction::Propose(rules::empty_bits()))],
        array![1000, 2000, 62001],
    );
}

#[test]
#[should_panic(expected: 'Flag fell')]
fn resume_then_play_is_one_turn() {
    // Black stays due through its own resume, so the resume and the stone
    // share black's 60 s.
    run(array![pass(), pass(), go(GoAction::Resume), stone(40)], array![1000, 2000, 32000, 62001]);
}

#[test]
fn a_turn_adds_up_its_steps() {
    // Black's resume used 30 s of its turn; the stone that ends it, 30 s more.
    let resumed = run(array![pass(), pass(), go(GoAction::Resume)], array![1000, 2000, 32000]);
    assert_eq!(clock(@resumed).used, 30000);
    let env = run(
        array![pass(), pass(), go(GoAction::Resume), stone(40)], array![1000, 2000, 32000, 62000],
    );
    assert_eq!(clock(@env), Clock { seats: no_bank(), used: 0, stamp: 62000 });
}

#[test]
fn declining_a_proposal_ends_the_responders_turn() {
    // White's resume hands the move back to black, who gets a fresh turn.
    let env = run(
        array![
            pass(), pass(), go(GoAction::Propose(rules::empty_bits())), go(GoAction::Resume),
            stone(40),
        ],
        array![1000, 2000, 3000, 62000, 121000],
    );
    assert_eq!(env.game.phase, PLAYING);
    assert_eq!(env.game.next_player, WHITE);
}

#[test]
fn a_flag_ends_the_game_for_the_seat_on_the_clock() {
    let env = run(array![stone(40), Move::Flag], array![1000, 61001]);
    assert!(env.outcome.finished);
    assert_eq!(env.outcome.winner, 1); // black (seat 0) wins: white was flagged
    assert_eq!(env.outcome.reason, REASON_TIMEOUT);
    // The flag records its stamp and leaves the clocks as they were.
    assert_eq!(clock(@env), Clock { seats: no_bank(), used: 0, stamp: 61001 });
}

#[test]
#[should_panic(expected: 'Clock not expired')]
fn no_flag_inside_the_turn() {
    run(array![stone(40), Move::Flag], array![1000, 61000]);
}

#[test]
fn forced_steps_pause_the_clock() {
    let (stamped, history) = black_moved();
    // White's forced stone onchain carries no stamp: the clock stops.
    let forced = force::<GoRules>(0, @terms(), stamped, history, 1, array![stone(41)].span());
    assert_eq!(clock(@forced), Clock { seats: no_bank(), used: 0, stamp: 0 });
}

#[test]
#[should_panic(expected: 'Referee step needs a stamp')]
fn a_flag_needs_the_referees_stamp() {
    let (stamped, history) = black_moved();
    force::<GoRules>(0, @terms(), stamped, history, 1, array![Move::Flag].span());
}

#[test]
fn byoyomi_opens_with_main_time_and_every_period() {
    let env = open::<GoRules>(@terms_with(byoyomi()));
    assert_eq!(
        seats(@env),
        StandardClock { banks: array![MAIN, MAIN].span(), periods: array![3, 3].span() },
    );
}

#[test]
fn a_turn_that_ends_inside_a_period_costs_nothing() {
    // White spends its main time and 5 s of overtime.
    let env = run_with(byoyomi(), array![stone(40), stone(41)], array![1000, 66000]);
    assert_eq!(
        seats(@env), StandardClock { banks: array![MAIN, 0].span(), periods: array![3, 3].span() },
    );
}

#[test]
fn a_period_that_runs_out_is_lost() {
    // 15 s of overtime outlasts one period and ends inside the next.
    let env = run_with(byoyomi(), array![stone(40), stone(41)], array![1000, 76000]);
    assert_eq!(*seats(@env).periods.at(1), 2);
    // With no main time left, 19 s of the remaining 20 loses one more.
    let env = run_with(
        byoyomi(),
        array![stone(40), stone(41), stone(42), stone(43)],
        array![1000, 76000, 77000, 96000],
    );
    assert_eq!(*seats(@env).periods.at(1), 1);
}

#[test]
fn the_last_period_ends_on_its_last_millisecond() {
    // Main time and all three periods: 90 s. Answering on the last millisecond
    // keeps the period the turn ended in.
    let env = run_with(byoyomi(), array![stone(40), stone(41)], array![1000, 91000]);
    assert_eq!(*seats(@env).periods.at(1), 1);
}

#[test]
#[should_panic(expected: 'Flag fell')]
fn outlasting_the_last_period_is_refused() {
    run_with(byoyomi(), array![stone(40), stone(41)], array![1000, 91001]);
}

#[test]
fn outlasting_the_last_period_flags() {
    let env = run_with(byoyomi(), array![stone(40), Move::Flag], array![1000, 91001]);
    assert_eq!(env.outcome.winner, 1); // black: white flagged in overtime
    assert_eq!(env.outcome.reason, REASON_TIMEOUT);
    // A flag no longer empties the flagged seat's clocks.
    assert_eq!(
        seats(@env),
        StandardClock { banks: array![MAIN, MAIN].span(), periods: array![3, 3].span() },
    );
}
