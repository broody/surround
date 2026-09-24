//! Replay real SGF games through the public Dojo entry points, without seeding
//! boards or bypassing move validation. Recorded RE is the score oracle.
use crate::models::{FinishReason, Phase, Winner};
use crate::rules::{self, NO_POINT};
use crate::systems::actions::IActionsDispatcherTrait;
use super::sgf_fixtures::{self, ReplayFixture};
use super::test_game::{black, caller, setup, white};

fn replay(fixture: ReplayFixture) {
    let (_, api) = setup();
    caller(black());
    let id = api.create_game(fixture.size, fixture.komi_half, white(), 300, 600);
    caller(white());
    api.join_game(id);
    let mut move_number = 0;
    for point in fixture.moves {
        caller(if move_number % 2 == 0 {
            black()
        } else {
            white()
        });
        if *point == NO_POINT {
            api.pass(id, move_number);
        } else {
            api.play(id, move_number, *point);
        }
        move_number += 1;
    }

    let game = api.get_game(id);
    assert_eq!(game.move_number, fixture.moves.len());
    assert_eq!(game.phase, Phase::Scoring);
    assert_eq!(game.scoring_round, 1);
    assert_eq!(game.consecutive_passes, 2);
    assert_eq!(game.black_captures, fixture.black_captures);
    assert_eq!(game.white_captures, fixture.white_captures);
    assert_eq!(api.get_board(id), fixture.final_board);
    assert_eq!(game.board_hash, rules::position_hash(fixture.final_board, fixture.size));

    let before = api.preview_score(id, 1, 0);
    let black_before: i32 = before.black_half.into();
    let white_before: i32 = before.white_half.into();
    assert_eq!(black_before - white_before, fixture.raw_margin_half);

    // SGF territory annotations supply the markings. These test-account actions
    // simulate agreement; the SGF itself does not contain onchain approvals.
    caller(black());
    let mut revision = 0;
    for point in fixture.dead_groups {
        api.mark_group(id, 1, revision, *point, true);
        revision += 1;
    }
    assert_eq!(api.get_proposal(id).dead, fixture.dead);
    api.accept_score(id, 1, revision);
    assert_eq!(api.get_game(id).phase, Phase::Scoring);
    caller(white());
    api.accept_score(id, 1, revision);
    let result = api.get_game(id);
    assert_eq!(result.phase, Phase::Finished);
    assert_eq!(result.finish_reason, FinishReason::Agreement);
    let black_score: i32 = result.black_score_half.into();
    let white_score: i32 = result.white_score_half.into();
    assert_eq!(black_score - white_score, fixture.margin_half);
    assert_eq!(result.winner, if fixture.margin_half > 0 {
        Winner::Black
    } else {
        Winner::White
    });
    assert_eq!(api.get_board(id), fixture.final_board);
    let accepted = api.get_proposal(id);
    assert!(accepted.black_approved && accepted.white_approved);
    assert_eq!(accepted.dead, fixture.dead);
}

#[test]
#[available_gas(10000000000)]
fn cgos_9x9_white_by_2() {
    replay(sgf_fixtures::cgos_9_1682833());
}

#[test]
#[available_gas(10000000000)]
fn cgos_9x9_black_by_8_with_captures() {
    replay(sgf_fixtures::cgos_9_1682827());
}

#[test]
#[available_gas(10000000000)]
fn cgos_13x13_white_by_20_and_a_half() {
    replay(sgf_fixtures::cgos_13_277988());
}

#[test]
#[available_gas(10000000000)]
fn cgos_13x13_black_by_31_and_a_half() {
    replay(sgf_fixtures::cgos_13_277982());
}

#[test]
#[available_gas(10000000000)]
fn kgs_19x19_black_by_1_and_a_half_after_34_dead_stones() {
    replay(sgf_fixtures::kgs_2019_04_10_39());
}

#[test]
#[available_gas(10000000000)]
fn kgs_19x19_black_by_74_and_a_half_with_53_captures() {
    replay(sgf_fixtures::kgs_2019_04_26_17());
}
