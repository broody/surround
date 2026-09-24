use starknet::ContractAddress;
use crate::models::{Game, ScoreProposal};
use crate::rules::{Position, Score};

#[starknet::interface]
pub trait IActions<T> {
    fn create_game(
        ref self: T,
        size: u8,
        komi_half: u16,
        invited_white: ContractAddress,
        turn_seconds: u32,
        scoring_seconds: u32,
    ) -> felt252;
    fn join_game(ref self: T, game_id: felt252);
    fn cancel_game(ref self: T, game_id: felt252);
    fn play(ref self: T, game_id: felt252, expected_move: u32, point: u16);
    fn pass(ref self: T, game_id: felt252, expected_move: u32);
    fn mark_group(ref self: T, game_id: felt252, round: u32, revision: u32, point: u16, dead: bool);
    fn accept_score(ref self: T, game_id: felt252, round: u32, revision: u32);
    fn resume_play(ref self: T, game_id: felt252, round: u32);
    fn expire_scoring(ref self: T, game_id: felt252, round: u32);
    fn resign(ref self: T, game_id: felt252);
    fn claim_timeout(ref self: T, game_id: felt252);
    fn get_game(self: @T, game_id: felt252) -> Game;
    fn get_board(self: @T, game_id: felt252) -> Position;
    fn get_proposal(self: @T, game_id: felt252) -> ScoreProposal;
    fn preview_score(self: @T, game_id: felt252, round: u32, revision: u32) -> Score;
}

#[dojo::contract]
pub mod actions {
    use core::num::traits::Zero;
    use dojo::event::EventStorage;
    use dojo::model::ModelStorage;
    use dojo::world::{IWorldDispatcherTrait, WorldStorage};
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};
    use crate::models::{
        Action, Board, FinishReason, Game, GameUpdated, Phase, PositionHistory, ScoreProposal,
        Winner,
    };
    use crate::rules::{self, BLACK, NO_POINT, Position, RULES_VERSION, Score, WHITE};
    use super::IActions;

    #[abi(embed_v0)]
    impl ActionsImpl of IActions<ContractState> {
        fn create_game(
            ref self: ContractState,
            size: u8,
            komi_half: u16,
            invited_white: ContractAddress,
            turn_seconds: u32,
            scoring_seconds: u32,
        ) -> felt252 {
            rules::validate_size(size);
            assert(komi_half <= rules::point_count(size) * 2, 'Komi out of bounds');
            assert(turn_seconds >= 60 && turn_seconds <= 2592000, 'Invalid turn duration');
            assert(scoring_seconds >= 60 && scoring_seconds <= 604800, 'Invalid scoring duration');
            let black = get_caller_address();
            assert(black.is_non_zero(), 'Zero caller');
            assert(invited_white != black, 'Cannot play yourself');
            let mut world = self.world(@"surround");
            let id: felt252 = world.dispatcher.uuid().into();
            let position = rules::empty_position();
            let board_hash = rules::position_hash(position, size);
            let game = Game {
                id,
                black,
                white: invited_white,
                size,
                komi_half,
                rules_version: RULES_VERSION,
                phase: Phase::Waiting,
                next_player: BLACK,
                move_number: 0,
                consecutive_passes: 0,
                scoring_round: 0,
                turn_seconds,
                scoring_seconds,
                deadline: get_block_timestamp() + 86400,
                board_hash,
                black_captures: 0,
                white_captures: 0,
                winner: Winner::None,
                finish_reason: FinishReason::None,
                black_score_half: 0,
                white_score_half: 0,
            };
            world.write_model(@game);
            world.write_model(@Board { game_id: id, position });
            // The initial position participates in superko as well.
            world.write_model(@PositionHistory { game_id: id, board_hash, seen: true });
            emit(ref world, game, Action::Created, 0, NO_POINT);
            id
        }

        fn join_game(ref self: ContractState, game_id: felt252) {
            let mut world = self.world(@"surround");
            let mut game = load_game(@world, game_id);
            assert(game.phase == Phase::Waiting, 'Game not waiting');
            require_before_deadline(game);
            let caller = get_caller_address();
            assert(caller.is_non_zero() && caller != game.black, 'Invalid opponent');
            assert(game.white.is_zero() || game.white == caller, 'Game is invitation only');
            game.white = caller;
            game.phase = Phase::Playing;
            game.deadline = get_block_timestamp() + game.turn_seconds.into();
            world.write_model(@game);
            emit(ref world, game, Action::Joined, 0, NO_POINT);
        }

        fn cancel_game(ref self: ContractState, game_id: felt252) {
            let mut world = self.world(@"surround");
            let mut game = load_game(@world, game_id);
            assert(game.phase == Phase::Waiting, 'Game not waiting');
            assert(
                get_caller_address() == game.black || get_block_timestamp() >= game.deadline,
                'Cannot cancel game',
            );
            game.phase = Phase::Cancelled;
            game.deadline = 0;
            world.write_model(@game);
            emit(ref world, game, Action::Cancelled, 0, NO_POINT);
        }

        fn play(ref self: ContractState, game_id: felt252, expected_move: u32, point: u16) {
            let mut world = self.world(@"surround");
            let mut game = load_game(@world, game_id);
            require_turn(game, expected_move);
            let board: Board = world.read_model(game_id);
            let (position, captured) = rules::play(
                board.position, game.size, game.next_player, point,
            );
            let board_hash = rules::position_hash(position, game.size);
            let history: PositionHistory = world.read_model((game_id, board_hash));
            assert(!history.seen, 'Positional superko');
            if game.next_player == BLACK {
                game.black_captures += captured.into();
            } else {
                game.white_captures += captured.into();
            }
            game.board_hash = board_hash;
            game.consecutive_passes = 0;
            advance_turn(ref game);
            world.write_model(@Board { game_id, position });
            world.write_model(@PositionHistory { game_id, board_hash, seen: true });
            world.write_model(@game);
            emit(ref world, game, Action::Played, 0, point);
        }

        fn pass(ref self: ContractState, game_id: felt252, expected_move: u32) {
            let mut world = self.world(@"surround");
            let mut game = load_game(@world, game_id);
            require_turn(game, expected_move);
            game.consecutive_passes += 1;
            advance_turn(ref game);
            if game.consecutive_passes == 2 {
                game.phase = Phase::Scoring;
                game.scoring_round += 1;
                game.deadline = get_block_timestamp() + game.scoring_seconds.into();
                world
                    .write_model(
                        @ScoreProposal {
                            game_id,
                            round: game.scoring_round,
                            revision: 0,
                            board_hash: game.board_hash,
                            dead: rules::empty_bits(),
                            black_approved: false,
                            white_approved: false,
                        },
                    );
            }
            // Passes are always legal with respect to superko and add no position.
            world.write_model(@game);
            emit(ref world, game, Action::Passed, 0, NO_POINT);
        }

        fn mark_group(
            ref self: ContractState,
            game_id: felt252,
            round: u32,
            revision: u32,
            point: u16,
            dead: bool,
        ) {
            let mut world = self.world(@"surround");
            let game = load_game(@world, game_id);
            participant(game);
            require_scoring(game, round);
            require_before_deadline(game);
            let mut proposal = load_proposal(@world, game, revision);
            let board: Board = world.read_model(game_id);
            proposal
                .dead = rules::mark_group(board.position, game.size, proposal.dead, point, dead);
            proposal.revision += 1;
            proposal.black_approved = false;
            proposal.white_approved = false;
            world.write_model(@proposal);
            // The fixed scoring deadline does not change when proposals change.
            emit(ref world, game, Action::Marked, proposal.revision, point);
        }

        fn accept_score(ref self: ContractState, game_id: felt252, round: u32, revision: u32) {
            let mut world = self.world(@"surround");
            let mut game = load_game(@world, game_id);
            let color = participant(game);
            require_scoring(game, round);
            require_before_deadline(game);
            let mut proposal = load_proposal(@world, game, revision);
            if color == BLACK {
                assert(!proposal.black_approved, 'Already approved');
                proposal.black_approved = true;
            } else {
                assert(!proposal.white_approved, 'Already approved');
                proposal.white_approved = true;
            }
            world.write_model(@proposal);
            emit(ref world, game, Action::Approved, revision, NO_POINT);
            if proposal.black_approved && proposal.white_approved {
                let board: Board = world.read_model(game_id);
                let score = rules::score(board.position, game.size, proposal.dead, game.komi_half);
                game.black_score_half = score.black_half;
                game.white_score_half = score.white_half;
                let winner = if score.black_half > score.white_half {
                    Winner::Black
                } else if score.white_half > score.black_half {
                    Winner::White
                } else {
                    Winner::Draw
                };
                finish(ref world, ref game, winner, FinishReason::Agreement, revision);
            }
        }

        fn resume_play(ref self: ContractState, game_id: felt252, round: u32) {
            let mut world = self.world(@"surround");
            let mut game = load_game(@world, game_id);
            participant(game);
            require_scoring(game, round);
            resume(ref world, ref game);
        }

        fn expire_scoring(ref self: ContractState, game_id: felt252, round: u32) {
            let mut world = self.world(@"surround");
            let mut game = load_game(@world, game_id);
            require_scoring(game, round);
            assert(get_block_timestamp() >= game.deadline, 'Deadline not reached');
            // Permissionless liveness fallback: resume, never impose an estimate
            // or treat silence as approval of another player's markings.
            resume(ref world, ref game);
        }

        fn resign(ref self: ContractState, game_id: felt252) {
            let mut world = self.world(@"surround");
            let mut game = load_game(@world, game_id);
            let color = participant(game);
            assert(game.phase == Phase::Playing || game.phase == Phase::Scoring, 'Game not active');
            require_before_deadline(game);
            finish(
                ref world,
                ref game,
                color_winner(rules::other(color)),
                FinishReason::Resignation,
                0,
            );
        }

        fn claim_timeout(ref self: ContractState, game_id: felt252) {
            let mut world = self.world(@"surround");
            let mut game = load_game(@world, game_id);
            assert(game.phase == Phase::Playing, 'Game not playing');
            assert(get_block_timestamp() >= game.deadline, 'Deadline not reached');
            let winner = color_winner(rules::other(game.next_player));
            finish(ref world, ref game, winner, FinishReason::Timeout, 0);
        }

        fn get_game(self: @ContractState, game_id: felt252) -> Game {
            let world = self.world(@"surround");
            load_game(@world, game_id)
        }

        fn get_board(self: @ContractState, game_id: felt252) -> Position {
            let world = self.world(@"surround");
            load_game(@world, game_id);
            let board: Board = world.read_model(game_id);
            board.position
        }

        fn get_proposal(self: @ContractState, game_id: felt252) -> ScoreProposal {
            let world = self.world(@"surround");
            let game = load_game(@world, game_id);
            assert(game.scoring_round > 0, 'No scoring proposal');
            world.read_model(game_id)
        }

        fn preview_score(
            self: @ContractState, game_id: felt252, round: u32, revision: u32,
        ) -> Score {
            let world = self.world(@"surround");
            let game = load_game(@world, game_id);
            require_scoring(game, round);
            let proposal = load_proposal(@world, game, revision);
            let board: Board = world.read_model(game_id);
            rules::score(board.position, game.size, proposal.dead, game.komi_half)
        }
    }

    fn load_game(world: @WorldStorage, game_id: felt252) -> Game {
        let game: Game = world.read_model(game_id);
        assert(game.black.is_non_zero(), 'Game does not exist');
        game
    }

    fn participant(game: Game) -> u8 {
        let caller = get_caller_address();
        assert(caller.is_non_zero(), 'Zero caller');
        if caller == game.black {
            BLACK
        } else {
            assert(caller == game.white, 'Not a player');
            WHITE
        }
    }

    fn require_before_deadline(game: Game) {
        assert(get_block_timestamp() < game.deadline, 'Deadline reached');
    }

    fn require_turn(game: Game, expected_move: u32) {
        assert(game.phase == Phase::Playing, 'Game not playing');
        assert(game.move_number == expected_move, 'Stale move number');
        assert(participant(game) == game.next_player, 'Not your turn');
        require_before_deadline(game);
    }

    fn require_scoring(game: Game, round: u32) {
        assert(game.phase == Phase::Scoring, 'Game not scoring');
        assert(game.scoring_round == round, 'Stale scoring round');
    }

    fn load_proposal(world: @WorldStorage, game: Game, revision: u32) -> ScoreProposal {
        let proposal: ScoreProposal = world.read_model(game.id);
        assert(proposal.round == game.scoring_round, 'Stale scoring round');
        assert(proposal.revision == revision, 'Stale proposal revision');
        assert(proposal.board_hash == game.board_hash, 'Proposal board mismatch');
        proposal
    }

    fn advance_turn(ref game: Game) {
        game.next_player = rules::other(game.next_player);
        game.move_number += 1;
        game.deadline = get_block_timestamp() + game.turn_seconds.into();
    }

    fn resume(ref world: WorldStorage, ref game: Game) {
        game.phase = Phase::Playing;
        game.consecutive_passes = 0;
        game.deadline = get_block_timestamp() + game.turn_seconds.into();
        // Clear the abandoned proposal, keeping its round identity for inspection.
        world
            .write_model(
                @ScoreProposal {
                    game_id: game.id,
                    round: game.scoring_round,
                    revision: 0,
                    board_hash: game.board_hash,
                    dead: rules::empty_bits(),
                    black_approved: false,
                    white_approved: false,
                },
            );
        world.write_model(@game);
        emit(ref world, game, Action::Resumed, 0, NO_POINT);
    }

    fn color_winner(color: u8) -> Winner {
        if color == BLACK {
            Winner::Black
        } else {
            Winner::White
        }
    }

    fn finish(
        ref world: WorldStorage,
        ref game: Game,
        winner: Winner,
        reason: FinishReason,
        revision: u32,
    ) {
        game.phase = Phase::Finished;
        game.winner = winner;
        game.finish_reason = reason;
        game.deadline = 0;
        world.write_model(@game);
        emit(ref world, game, Action::Finished, revision, NO_POINT);
    }

    fn emit(ref world: WorldStorage, game: Game, action: Action, revision: u32, point: u16) {
        world
            .emit_event(
                @GameUpdated {
                    game_id: game.id,
                    actor: get_caller_address(),
                    action,
                    move_number: game.move_number,
                    scoring_round: game.scoring_round,
                    proposal_revision: revision,
                    point,
                    board_hash: game.board_hash,
                },
            );
    }
}
