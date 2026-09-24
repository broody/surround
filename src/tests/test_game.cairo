use dojo::model::{ModelStorage, ModelStorageTest};
use dojo::world::{WorldStorage, WorldStorageTrait, world};
use dojo_cairo_test::{
    ContractDefTrait, NamespaceDef, TestResource, WorldStorageTestTrait, spawn_test_world,
};
use starknet::{ContractAddress, testing};
use crate::models::{
    Board, FinishReason, Game, Phase, PositionHistory, Winner, e_GameUpdated, m_Board, m_Game,
    m_PositionHistory, m_ScoreProposal,
};
use crate::rules::{self, BLACK, EMPTY, WHITE};
use crate::systems::actions::{IActionsDispatcher, IActionsDispatcherTrait, actions};

pub fn black() -> ContractAddress {
    0x111.try_into().unwrap()
}
pub fn white() -> ContractAddress {
    0x222.try_into().unwrap()
}
fn spectator() -> ContractAddress {
    0x333.try_into().unwrap()
}
fn zero() -> ContractAddress {
    0.try_into().unwrap()
}

// For dispatched contract calls, the test's contract address becomes the caller.
pub fn caller(address: ContractAddress) {
    testing::set_contract_address(address);
}

pub fn setup() -> (WorldStorage, IActionsDispatcher) {
    testing::set_block_timestamp(1000);
    let namespace = NamespaceDef {
        namespace: "surround",
        resources: array![
            TestResource::Model(m_Game::TEST_CLASS_HASH),
            TestResource::Model(m_Board::TEST_CLASS_HASH),
            TestResource::Model(m_PositionHistory::TEST_CLASS_HASH),
            TestResource::Model(m_ScoreProposal::TEST_CLASS_HASH),
            TestResource::Event(e_GameUpdated::TEST_CLASS_HASH),
            TestResource::Contract(actions::TEST_CLASS_HASH),
        ]
            .span(),
    };
    let mut world = spawn_test_world(world::TEST_CLASS_HASH, array![namespace].span());
    let definitions = array![
        ContractDefTrait::new(@"surround", @"actions")
            .with_writer_of(
                array![
                    dojo::utils::selector_from_names(@"surround", @"Game"),
                    dojo::utils::selector_from_names(@"surround", @"Board"),
                    dojo::utils::selector_from_names(@"surround", @"PositionHistory"),
                    dojo::utils::selector_from_names(@"surround", @"ScoreProposal"),
                    dojo::utils::selector_from_names(@"surround", @"GameUpdated"),
                ]
                    .span(),
            ),
    ];
    world.sync_perms_and_inits(definitions.span());
    let (contract_address, _) = world.dns(@"actions").unwrap();
    (world, IActionsDispatcher { contract_address })
}

fn started(api: IActionsDispatcher) -> felt252 {
    caller(black());
    let id = api.create_game(9, 13, zero(), 300, 600);
    caller(white());
    api.join_game(id);
    id
}

fn two_passes(api: IActionsDispatcher, id: felt252) {
    let game = api.get_game(id);
    caller(if game.next_player == BLACK {
        black()
    } else {
        white()
    });
    api.pass(id, game.move_number);
    caller(if game.next_player == BLACK {
        white()
    } else {
        black()
    });
    api.pass(id, game.move_number + 1);
}

// Legal compact corner fight, leaving White's connected group at 0,1 in atari.
fn corner_game(api: IActionsDispatcher) -> felt252 {
    let id = started(api);
    caller(black());
    api.play(id, 0, 2);
    caller(white());
    api.play(id, 1, 0);
    caller(black());
    api.play(id, 2, 10);
    caller(white());
    api.play(id, 3, 1);
    caller(black());
    api.play(id, 4, 18);
    caller(white());
    api.play(id, 5, 80);
    id
}

#[test]
#[available_gas(500000000)]
fn create_join_move_capture_and_read_models() {
    let (world, api) = setup();
    let id = corner_game(api);
    caller(black());
    api.play(id, 6, 9);
    let game: Game = world.read_model(id);
    let board: Board = world.read_model(id);
    assert_eq!(game.phase, Phase::Playing);
    assert_eq!(game.black, black());
    assert_eq!(game.white, white());
    assert_eq!(game.move_number, 7);
    assert_eq!(game.next_player, WHITE);
    assert_eq!(game.black_captures, 2);
    assert_eq!(rules::stone_at(board.position, 0), EMPTY);
    assert_eq!(rules::stone_at(board.position, 1), EMPTY);
    assert_eq!(game.board_hash, rules::position_hash(board.position, 9));
    let history: PositionHistory = world.read_model((id, game.board_hash));
    assert!(history.seen);
}

#[test]
#[available_gas(500000000)]
fn matching_approvals_finalize_exact_area_score() {
    let (_, api) = setup();
    let id = corner_game(api);
    two_passes(api, id);
    caller(black());
    api.mark_group(id, 1, 0, 0, true);
    let proposal = api.get_proposal(id);
    assert!(rules::contains(proposal.dead, 0));
    assert!(rules::contains(proposal.dead, 1));
    let score = api.preview_score(id, 1, 1);
    assert_eq!(score.black_half, 12);
    assert_eq!(score.white_half, 15);
    api.accept_score(id, 1, 1);
    assert_eq!(api.get_game(id).phase, Phase::Scoring);
    caller(white());
    api.accept_score(id, 1, 1);
    let game = api.get_game(id);
    assert_eq!(game.phase, Phase::Finished);
    assert_eq!(game.winner, Winner::White);
    assert_eq!(game.finish_reason, FinishReason::Agreement);
    assert_eq!(game.black_score_half, 12);
    assert_eq!(game.white_score_half, 15);
    // The actual final played position is preserved for inspection.
    assert_eq!(rules::stone_at(api.get_board(id), 0), WHITE);
}

#[test]
#[available_gas(500000000)]
fn edits_reset_approvals_without_extending_deadline() {
    let (_, api) = setup();
    let id = corner_game(api);
    two_passes(api, id);
    let deadline = api.get_game(id).deadline;
    caller(black());
    api.accept_score(id, 1, 0);
    caller(white());
    api.mark_group(id, 1, 0, 0, true);
    let p = api.get_proposal(id);
    assert!(!p.black_approved && !p.white_approved);
    assert_eq!(p.revision, 1);
    api.accept_score(id, 1, 1);
    caller(black());
    api.mark_group(id, 1, 1, 1, false);
    let p = api.get_proposal(id);
    assert!(!p.black_approved && !p.white_approved);
    assert_eq!(p.revision, 2);
    assert_eq!(p.dead, rules::empty_bits());
    assert_eq!(api.get_game(id).deadline, deadline);
}

#[test]
#[available_gas(500000000)]
fn disagreement_resumes_unchanged_board_and_four_passes_do_not_finish() {
    let (world, api) = setup();
    let id = corner_game(api);
    let board = api.get_board(id);
    let hash = api.get_game(id).board_hash;
    two_passes(api, id);
    caller(black());
    api.mark_group(id, 1, 0, 0, true);
    api.accept_score(id, 1, 1);
    caller(white());
    api.resume_play(id, 1);
    let game = api.get_game(id);
    assert_eq!(game.phase, Phase::Playing);
    assert_eq!(game.next_player, BLACK);
    assert_eq!(game.consecutive_passes, 0);
    assert_eq!(api.get_board(id), board);
    let history: PositionHistory = world.read_model((id, hash));
    assert!(history.seen);
    let p = api.get_proposal(id);
    assert_eq!(p.dead, rules::empty_bits());
    assert!(!p.black_approved && !p.white_approved);
    two_passes(api, id);
    assert_eq!(api.get_game(id).phase, Phase::Scoring);
    assert_eq!(api.get_game(id).scoring_round, 2);
}

#[test]
#[available_gas(500000000)]
fn scoring_expiry_resumes_and_turn_expiry_forfeits() {
    let (_, api) = setup();
    let id = started(api);
    two_passes(api, id);
    caller(black());
    api.accept_score(id, 1, 0);
    testing::set_block_timestamp(1600);
    caller(spectator());
    api.expire_scoring(id, 1);
    let game = api.get_game(id);
    assert_eq!(game.phase, Phase::Playing);
    assert_eq!(game.deadline, 1900);
    assert_eq!(game.next_player, BLACK);
    testing::set_block_timestamp(1900);
    api.claim_timeout(id);
    let game = api.get_game(id);
    assert_eq!(game.winner, Winner::White);
    assert_eq!(game.finish_reason, FinishReason::Timeout);
}

#[test]
#[available_gas(500000000)]
fn resignation_during_scoring_awards_opponent() {
    let (_, api) = setup();
    let id = started(api);
    two_passes(api, id);
    caller(white());
    api.resign(id);
    assert_eq!(api.get_game(id).winner, Winner::Black);
    assert_eq!(api.get_game(id).finish_reason, FinishReason::Resignation);
}

#[test]
#[available_gas(500000000)]
fn zero_komi_empty_board_can_draw_by_agreement() {
    let (_, api) = setup();
    caller(black());
    let id = api.create_game(9, 0, white(), 300, 600);
    caller(white());
    api.join_game(id);
    two_passes(api, id);
    caller(black());
    api.accept_score(id, 1, 0);
    caller(white());
    api.accept_score(id, 1, 0);
    assert_eq!(api.get_game(id).winner, Winner::Draw);
}

#[test]
#[available_gas(500000000)]
fn games_have_separate_boards_and_repetition_histories() {
    let (_, api) = setup();
    let first = started(api);
    let second = started(api);
    assert!(first != second);
    caller(black());
    api.play(first, 0, 0);
    assert_eq!(api.get_board(second), rules::empty_position());
    api.play(second, 0, 0);
    assert_eq!(api.get_game(first).board_hash, api.get_game(second).board_hash);
}

#[test]
#[available_gas(500000000)]
fn waiting_game_can_be_cancelled_by_creator_or_expired_by_anyone() {
    let (_, api) = setup();
    caller(black());
    let first = api.create_game(9, 13, zero(), 300, 600);
    api.cancel_game(first);
    assert_eq!(api.get_game(first).phase, Phase::Cancelled);
    let second = api.create_game(9, 13, zero(), 300, 600);
    testing::set_block_timestamp(87400);
    caller(spectator());
    api.cancel_game(second);
    assert_eq!(api.get_game(second).phase, Phase::Cancelled);
}

#[test]
#[available_gas(500000000)]
#[should_panic(expected: ('Not your turn', 'ENTRYPOINT_FAILED'))]
fn out_of_turn_move_rejected() {
    let (_, api) = setup();
    let id = started(api);
    caller(white());
    api.play(id, 0, 0);
}

#[test]
#[available_gas(500000000)]
#[should_panic(expected: ('Not a player', 'ENTRYPOINT_FAILED'))]
fn spectator_cannot_mark_groups() {
    let (_, api) = setup();
    let id = corner_game(api);
    two_passes(api, id);
    caller(spectator());
    api.mark_group(id, 1, 0, 0, true);
}

#[test]
#[available_gas(500000000)]
#[should_panic(expected: ('Stale proposal revision', 'ENTRYPOINT_FAILED'))]
fn stale_approval_rejected_after_marking_edit() {
    let (_, api) = setup();
    let id = corner_game(api);
    two_passes(api, id);
    caller(black());
    api.mark_group(id, 1, 0, 0, true);
    caller(white());
    api.accept_score(id, 1, 0);
}

#[test]
#[available_gas(500000000)]
#[should_panic(expected: ('Stale scoring round', 'ENTRYPOINT_FAILED'))]
fn approval_from_previous_scoring_round_rejected() {
    let (_, api) = setup();
    let id = started(api);
    two_passes(api, id);
    caller(black());
    api.resume_play(id, 1);
    two_passes(api, id);
    caller(white());
    api.accept_score(id, 1, 0);
}

#[test]
#[available_gas(500000000)]
#[should_panic(expected: ('Already approved', 'ENTRYPOINT_FAILED'))]
fn one_player_cannot_approve_twice_to_finalize() {
    let (_, api) = setup();
    let id = started(api);
    two_passes(api, id);
    caller(black());
    api.accept_score(id, 1, 0);
    api.accept_score(id, 1, 0);
}

#[test]
#[available_gas(500000000)]
#[should_panic(expected: ('Stale move number', 'ENTRYPOINT_FAILED'))]
fn stale_move_rejected() {
    let (_, api) = setup();
    let id = started(api);
    caller(black());
    api.play(id, 0, 0);
    caller(white());
    api.play(id, 0, 1);
}

#[test]
#[available_gas(500000000)]
#[should_panic(expected: ('Game not playing', 'ENTRYPOINT_FAILED'))]
fn moves_during_scoring_rejected() {
    let (_, api) = setup();
    let id = started(api);
    two_passes(api, id);
    caller(black());
    api.play(id, 2, 0);
}

#[test]
#[available_gas(500000000)]
#[should_panic(expected: ('Game not playing', 'ENTRYPOINT_FAILED'))]
fn finished_game_cannot_be_changed() {
    let (_, api) = setup();
    let id = started(api);
    caller(black());
    api.resign(id);
    api.play(id, 0, 0);
}

#[test]
#[available_gas(500000000)]
#[should_panic(expected: ('Game is invitation only', 'ENTRYPOINT_FAILED'))]
fn invitation_cannot_be_taken_by_someone_else() {
    let (_, api) = setup();
    caller(black());
    let id = api.create_game(9, 13, white(), 300, 600);
    caller(spectator());
    api.join_game(id);
}

#[test]
#[available_gas(500000000)]
#[should_panic(expected: ('Game does not exist', 'ENTRYPOINT_FAILED'))]
fn missing_game_rejected() {
    let (_, api) = setup();
    api.get_game(123456789);
}

#[test]
#[available_gas(500000000)]
#[should_panic(expected: ('Deadline reached', 'ENTRYPOINT_FAILED'))]
fn move_at_exact_deadline_rejected() {
    let (_, api) = setup();
    let id = started(api);
    testing::set_block_timestamp(1300);
    caller(black());
    api.play(id, 0, 0);
}

#[test]
#[available_gas(500000000)]
#[should_panic(expected: ('Deadline not reached', 'ENTRYPOINT_FAILED'))]
fn premature_timeout_rejected() {
    let (_, api) = setup();
    let id = started(api);
    caller(spectator());
    api.claim_timeout(id);
}

// Canonical ko: white 10 has only liberty 11; black 11 captures it and has
// only liberty 10. White 10 would restore this exact board.
fn ko_fixture(ref world: WorldStorage, api: IActionsDispatcher, id: felt252) {
    let mut position = rules::empty_position();
    for p in array![1, 9, 19].span() {
        rules::insert(ref position.black, *p);
    }
    for p in array![10, 2, 12, 20].span() {
        rules::insert(ref position.white, *p);
    }
    let hash = rules::position_hash(position, 9);
    let mut game = api.get_game(id);
    game.board_hash = hash;
    world.write_model_test(@game);
    world.write_model_test(@Board { game_id: id, position });
    world.write_model_test(@PositionHistory { game_id: id, board_hash: hash, seen: true });
}

#[test]
#[available_gas(500000000)]
#[should_panic(expected: ('Positional superko', 'ENTRYPOINT_FAILED'))]
fn immediate_ko_recapture_rejected() {
    let (mut world, api) = setup();
    let id = started(api);
    ko_fixture(ref world, api, id);
    caller(black());
    api.play(id, 0, 11);
    caller(white());
    api.play(id, 1, 10);
}

#[test]
#[available_gas(500000000)]
#[should_panic(expected: ('Positional superko', 'ENTRYPOINT_FAILED'))]
fn ko_history_survives_passes_and_scoring_dispute() {
    let (mut world, api) = setup();
    let id = started(api);
    ko_fixture(ref world, api, id);
    caller(black());
    api.play(id, 0, 11);
    two_passes(api, id);
    caller(white());
    api.resume_play(id, 1);
    api.play(id, 3, 10);
}

#[test]
#[available_gas(500000000)]
fn ko_can_be_recaptured_after_board_changes_elsewhere() {
    let (mut world, api) = setup();
    let id = started(api);
    ko_fixture(ref world, api, id);
    caller(black());
    api.play(id, 0, 11);
    caller(white());
    api.play(id, 1, 80);
    caller(black());
    api.play(id, 2, 78);
    caller(white());
    api.play(id, 3, 10);
    assert_eq!(rules::stone_at(api.get_board(id), 10), WHITE);
    assert_eq!(rules::stone_at(api.get_board(id), 11), EMPTY);
}
