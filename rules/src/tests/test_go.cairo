//! Go as a referee game. Replays the recorded SGF games through
//! `referee::apply_steps` and `referee::replay`, with Go scoring by agreement, and
//! checks superko across passes and scoring.
use referee::{
    Envelope, Move, REASON_RESIGN, Signature, Terms, action_hash, actor, apply_steps, context_hash,
    open, replay,
};
use referee_testing::{public_key, sign};
use crate::fixtures::{self as sgf_fixtures, ReplayFixture};
use crate::go::{AGREEMENT, FINISHED, GoAction, GoConfig, GoRules, GoState, append_history};
use crate::replay::{config, game_steps, go, opening_history, pass, stone};
use crate::rules::{self, BLACK, EMPTY, Position, WHITE};

const PK_BLACK: felt252 = 0x1a2b3c;
const PK_WHITE: felt252 = 0x4d5e6f;


fn terms(config: GoConfig) -> Terms<GoConfig> {
    Terms {
        chain_id: 'SN_TEST',
        channel: 0xc4a11e1,
        game_id: 1,
        prover: 0xad0b7e5,
        response_seconds: 3600,
        players: array!['BLACK', 'WHITE'].span(),
        keys: array![public_key(PK_BLACK), public_key(PK_WHITE)].span(),
        // Go never requests randomness; any nonzero tips will do.
        rng_tips: array![1, 2].span(),
        config,
    }
}

fn start(config: @GoConfig) -> Envelope<GoState> {
    open::<GoRules>(config, array![1, 2].span())
}


fn check_result(fixture: @ReplayFixture, end: @Envelope<GoState>) {
    assert!(*end.outcome.finished);
    assert_eq!(*end.outcome.reason, AGREEMENT);
    let expected_winner = if *fixture.margin_half > 0 {
        BLACK
    } else {
        WHITE
    };
    assert_eq!(*end.outcome.winner, expected_winner);
    let game = *end.game;
    assert_eq!(game.phase, FINISHED);
    assert_eq!(game.board, *fixture.final_board);
    assert_eq!(game.black_captures, *fixture.black_captures);
    assert_eq!(game.white_captures, *fixture.white_captures);
    let black: i32 = game.black_half.into();
    let white: i32 = game.white_half.into();
    assert_eq!(black - white, *fixture.margin_half);
}

fn replay_unsigned(fixture: ReplayFixture) {
    let config = config(@fixture);
    let end = apply_steps::<
        GoRules,
    >(0x1234, @config, start(@config), opening_history(@config), game_steps(@fixture));
    check_result(@fixture, @end);
}

/// Sign every step as the two clients would, and return each seat's final
/// signature, as replay takes them.
fn sign_game(context: felt252, config: @GoConfig, steps: Span<Move<GoAction>>) -> Span<Signature> {
    let mut env = start(config);
    let mut history = opening_history(config);
    let mut finals = array![Signature { r: 0, s: 0 }, Signature { r: 0, s: 0 }].span();
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
        env = apply_steps::<GoRules>(context, config, env, history, array![*step].span());
        if env.game.board != before {
            let mut next: Array<felt252> = history.into();
            next.append(rules::position_hash(env.game.board, *config.size));
            history = next.span();
        }
    }
    finals
}

#[test]
#[available_gas(10000000000)]
fn cgos_9x9_white_by_2() {
    replay_unsigned(sgf_fixtures::cgos_9_1682833());
}

#[test]
#[available_gas(10000000000)]
fn cgos_9x9_black_by_8_with_captures() {
    replay_unsigned(sgf_fixtures::cgos_9_1682827());
}

#[test]
#[available_gas(10000000000)]
fn cgos_13x13_white_by_20_and_a_half() {
    replay_unsigned(sgf_fixtures::cgos_13_277988());
}

#[test]
#[available_gas(10000000000)]
fn cgos_13x13_black_by_31_and_a_half() {
    replay_unsigned(sgf_fixtures::cgos_13_277982());
}

#[test]
#[available_gas(10000000000)]
fn kgs_19x19_black_by_1_and_a_half_after_34_dead_stones() {
    replay_unsigned(sgf_fixtures::kgs_2019_04_10_39());
}

#[test]
#[available_gas(10000000000)]
fn kgs_19x19_black_by_74_and_a_half_with_53_captures() {
    replay_unsigned(sgf_fixtures::kgs_2019_04_26_17());
}

#[test]
#[available_gas(100000000000)]
fn signed_9x9_game_replays_with_final_signatures() {
    let fixture = sgf_fixtures::cgos_9_1682827();
    let config = config(@fixture);
    let terms = terms(config);
    let context = context_hash::<GoRules>(@terms);
    let steps = game_steps(@fixture);
    let finals = sign_game(context, @config, steps);
    let end = replay::<
        GoRules,
    >(context, terms.keys, @config, start(@config), opening_history(@config), steps, finals);
    check_result(@fixture, @end);
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: 'Invalid session signature')]
fn changed_opening_move_breaks_black_final_signature() {
    let fixture = sgf_fixtures::cgos_9_1682833();
    let config = config(@fixture);
    let terms = terms(config);
    let context = context_hash::<GoRules>(@terms);
    let steps = game_steps(@fixture).slice(0, 10);
    let finals = sign_game(context, @config, steps);
    // In the first ten moves, black's opening stone moves from the centre to
    // the far corner, where it touches nothing, under the original signatures.
    // Every step stays legal, so only black's final signature can object.
    let mut tampered = array![stone(80)];
    tampered.append_span(steps.slice(1, 9));
    replay::<
        GoRules,
    >(
        context,
        terms.keys,
        @config,
        start(@config),
        opening_history(@config),
        tampered.span(),
        finals,
    );
}

// Canonical ko: white 10 has only liberty 11; black 11 captures it and has
// only liberty 10. White 10 would restore this exact board.
fn ko() -> (GoConfig, Envelope<GoState>, Span<felt252>) {
    let config = GoConfig { size: 9, komi_half: 13 };
    let mut board: Position = rules::empty_position();
    for p in array![1, 9, 19].span() {
        rules::insert(ref board.black, *p);
    }
    for p in array![10, 2, 12, 20].span() {
        rules::insert(ref board.white, *p);
    }
    let hash = rules::position_hash(board, 9);
    let mut env = start(@config);
    env.game.board = board;
    env.game.history_root = append_history(0, hash);
    (config, env, array![hash].span())
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: 'Positional superko')]
fn immediate_ko_recapture_rejected() {
    let (config, env, history) = ko();
    apply_steps::<GoRules>(0, @config, env, history, array![stone(11), stone(10)].span());
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: 'Positional superko')]
fn ko_history_survives_passes_and_scoring_resume() {
    let (config, env, history) = ko();
    let steps = array![stone(11), pass(), pass(), go(GoAction::Resume), stone(10)];
    apply_steps::<GoRules>(0, @config, env, history, steps.span());
}

#[test]
#[available_gas(1000000000)]
fn ko_can_be_recaptured_after_board_changes_elsewhere() {
    let (config, env, history) = ko();
    let steps = array![stone(11), stone(80), stone(78), stone(10)];
    let end = apply_steps::<GoRules>(0, @config, env, history, steps.span());
    assert_eq!(rules::stone_at(end.game.board, 10), WHITE);
    assert_eq!(rules::stone_at(end.game.board, 11), EMPTY);
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: 'Wrong position history')]
fn history_witness_must_match_the_state() {
    let (config, env, _) = ko();
    apply_steps::<GoRules>(0, @config, env, array![999].span(), array![stone(40)].span());
}

#[test]
#[available_gas(1000000000)]
fn resignation_is_a_referee_move() {
    let config = GoConfig { size: 9, komi_half: 13 };
    let steps = array![stone(40), Move::Resign(0)];
    let end = apply_steps::<
        GoRules,
    >(0, @config, start(@config), opening_history(@config), steps.span());
    assert!(end.outcome.finished);
    assert_eq!(end.outcome.winner, WHITE);
    assert_eq!(end.outcome.reason, REASON_RESIGN);
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: 'Not your step')]
fn white_cannot_open() {
    let config = GoConfig { size: 9, komi_half: 13 };
    referee::force::<
        GoRules,
    >(0, @config, start(@config), opening_history(@config), 1, array![stone(40)].span());
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: 'Unexpected entropy')]
fn go_never_takes_entropy() {
    let config = GoConfig { size: 9, komi_half: 13 };
    let steps = array![Move::PlayRandom((GoAction::Play(40), 1))];
    apply_steps::<GoRules>(0, @config, start(@config), opening_history(@config), steps.span());
}
