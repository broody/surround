//! Go as a referee game. The transition is Surround's channel protocol minus
//! the bookkeeping referee now owns (sequence, transcript, signer changes,
//! resignation). Seat 0 plays black and seat 1 plays white.
use core::dict::{Felt252Dict, Felt252DictTrait};
use core::poseidon::poseidon_hash_span;
use referee::GameRules;
use crate::rules::{self, BLACK, Bits, Position, WHITE};

pub const PLAYING: u8 = 0;
pub const SCORING: u8 = 1;
pub const FINISHED: u8 = 2;

/// Finish reason: both players agreed on the dead stones after two passes.
pub const AGREEMENT: u8 = 1;
/// `GoState.winner` for a drawn score (integer komi).
pub const DRAW: u8 = 3;

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct GoConfig {
    pub size: u8,
    pub komi_half: u16,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct GoState {
    pub move_number: u32,
    pub board: Position,
    /// Chained hash of every position so far, for positional superko.
    pub history_root: felt252,
    pub next_player: u8,
    pub phase: u8,
    pub consecutive_passes: u8,
    pub scoring_round: u32,
    pub resume_player: u8,
    pub proposed: bool,
    pub dead: Bits,
    pub black_captures: u32,
    pub white_captures: u32,
    /// 0 while playing; BLACK, WHITE or DRAW once scored.
    pub winner: u8,
    pub finish_reason: u8,
    pub black_half: u16,
    pub white_half: u16,
}

/// A Go action. Its Serde encoding is the variant index then the payload, so a
/// stone is 2 felts and only a scoring proposal carries the dead-stone mask.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub enum GoAction {
    Play: u16,
    Pass,
    /// The dead stones, after two passes.
    Propose: Bits,
    Accept,
    /// Decline scoring and play on.
    Resume,
}

pub fn append_history(root: felt252, position: felt252) -> felt252 {
    poseidon_hash_span(array!['SURROUND_HISTORY_V1', root, position].span())
}

pub impl GoRules of GameRules {
    type Config = GoConfig;
    type State = GoState;
    type Action = GoAction;
    /// Every position hash since the start, in order. Replays check it against
    /// `history_root` and use it for superko.
    type Witness = Span<felt252>;
    type Scratch = Felt252Dict<felt252>;

    const TAG: felt252 = 'SURROUND';
    const RULES_VERSION: u32 = 2;
    const SEATS: u8 = 2;

    fn init(config: @GoConfig) -> GoState {
        let size = *config.size;
        rules::validate_size(size);
        assert(*config.komi_half <= rules::point_count(size) * 2, 'Komi out of bounds');
        let board = rules::empty_position();
        GoState {
            move_number: 0,
            board,
            history_root: append_history(0, rules::position_hash(board, size)),
            next_player: BLACK,
            phase: PLAYING,
            consecutive_passes: 0,
            scoring_round: 0,
            resume_player: BLACK,
            proposed: false,
            dead: rules::empty_bits(),
            black_captures: 0,
            white_captures: 0,
            winner: 0,
            finish_reason: 0,
            black_half: 0,
            white_half: 0,
        }
    }

    fn load(config: @GoConfig, state: @GoState, witness: Span<felt252>) -> Felt252Dict<felt252> {
        assert(!witness.is_empty(), 'Missing position history');
        let mut seen: Felt252Dict<felt252> = Default::default();
        let mut root = 0;
        for position in witness {
            assert(seen.get(*position) == 0, 'Repeated history position');
            seen.insert(*position, 1);
            root = append_history(root, *position);
        }
        assert(root == *state.history_root, 'Wrong position history');
        seen
    }

    fn apply(
        config: @GoConfig,
        ref scratch: Felt252Dict<felt252>,
        mut state: GoState,
        seat: u8,
        action: GoAction,
    ) -> (GoState, Option<u8>) {
        assert(state.phase != FINISHED, 'Game already finished');
        let color = seat + 1;
        let size = *config.size;
        match action {
            GoAction::Play(point) => {
                assert(state.phase == PLAYING, 'Not playing');
                let (board, captured) = rules::play(state.board, size, color, point);
                let position = rules::position_hash(board, size);
                assert(scratch.get(position) == 0, 'Positional superko');
                scratch.insert(position, 1);
                state.board = board;
                state.history_root = append_history(state.history_root, position);
                if color == BLACK {
                    state.black_captures += captured.into();
                } else {
                    state.white_captures += captured.into();
                }
                state.move_number += 1;
                state.consecutive_passes = 0;
                state.next_player = rules::other(color);
            },
            GoAction::Pass => {
                assert(state.phase == PLAYING, 'Not playing');
                state.move_number += 1;
                state.consecutive_passes += 1;
                state.next_player = rules::other(color);
                if state.consecutive_passes == 2 {
                    state.phase = SCORING;
                    state.scoring_round += 1;
                    state.resume_player = state.next_player;
                    state.proposed = false;
                    state.dead = rules::empty_bits();
                }
            },
            GoAction::Propose(dead) => {
                assert(state.phase == SCORING && !state.proposed, 'Cannot propose');
                // Validates complete dead groups; the score is recomputed on accept.
                rules::score(state.board, size, dead, *config.komi_half);
                state.dead = dead;
                state.proposed = true;
                state.next_player = rules::other(color);
            },
            GoAction::Accept => {
                assert(state.phase == SCORING && state.proposed, 'No scoring proposal');
                let score = rules::score(state.board, size, state.dead, *config.komi_half);
                state.black_half = score.black_half;
                state.white_half = score.white_half;
                state
                    .winner =
                        if score.black_half > score.white_half {
                            BLACK
                        } else if score.white_half > score.black_half {
                            WHITE
                        } else {
                            DRAW
                        };
                state.phase = FINISHED;
                state.finish_reason = AGREEMENT;
            },
            GoAction::Resume => {
                assert(state.phase == SCORING, 'Cannot resume play');
                state.phase = PLAYING;
                state.next_player = state.resume_player;
                state.proposed = false;
                state.dead = rules::empty_bits();
                state.consecutive_passes = 0;
            },
        }
        (state, Option::None)
    }

    fn resolve(
        config: @GoConfig, ref scratch: Felt252Dict<felt252>, state: GoState, seed: felt252,
    ) -> GoState {
        panic!("Go has no randomness")
    }

    fn due(state: @GoState) -> u8 {
        *state.next_player - 1
    }

    fn outcome(state: @GoState) -> Option<(u8, u8)> {
        if *state.phase != FINISHED {
            return Option::None;
        }
        // BLACK (1) and WHITE (2) are already seat + 1.
        let winner = if *state.winner == DRAW {
            referee::DRAW
        } else {
            *state.winner
        };
        Option::Some((winner, *state.finish_reason))
    }
}
