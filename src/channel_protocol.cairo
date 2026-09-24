//! Shared deterministic channel protocol. Copied verbatim (minus Dojo derives)
//! into the native Stwo package by offchain/prepare.py.
use core::dict::{Felt252Dict, Felt252DictTrait};
use core::ecdsa::check_ecdsa_signature;
use core::poseidon::poseidon_hash_span;
use crate::rules::{self, Bits, Position};

pub const PROTOCOL_VERSION: u16 = 1;
pub const PLAYING: u8 = 0;
pub const SCORING: u8 = 1;
pub const FINISHED: u8 = 2;
pub const PLAY: u8 = 0;
pub const PASS: u8 = 1;
pub const PROPOSE: u8 = 2;
pub const ACCEPT: u8 = 3;
pub const RESUME: u8 = 4;
pub const RESIGN: u8 = 5;
pub const AGREEMENT: u8 = 1;
pub const RESIGNATION: u8 = 2;
pub const TIMEOUT: u8 = 3;
pub const DRAW: u8 = 3;

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct Terms {
    pub chain_id: felt252,
    pub channel: felt252,
    pub game_id: felt252,
    pub black: felt252,
    pub white: felt252,
    pub black_key: felt252,
    pub white_key: felt252,
    pub prover: felt252,
    pub size: u8,
    pub komi_half: u16,
    pub response_seconds: u32,
}

#[derive(Copy, Drop, Serde, Introspect, DojoStore, PartialEq, Debug)]
pub struct ChannelState {
    pub sequence: u32,
    pub move_number: u32,
    pub board: Position,
    pub history_root: felt252,
    pub transcript_hash: felt252,
    pub next_player: u8,
    pub phase: u8,
    pub consecutive_passes: u8,
    pub scoring_round: u32,
    pub resume_player: u8,
    pub proposed: bool,
    pub dead: Bits,
    pub black_captures: u32,
    pub white_captures: u32,
    pub winner: u8,
    pub finish_reason: u8,
    pub black_half: u16,
    pub white_half: u16,
    // Consecutive actions by one signer add no new opponent acknowledgement.
    pub support_turn: u32,
    pub last_actor: u8,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct Action {
    pub kind: u8,
    pub actor: u8,
    pub point: u16,
    pub dead: Bits,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct Signature {
    pub r: felt252,
    pub s: felt252,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct SignedAction {
    pub action: Action,
    pub signature: Signature,
}

pub fn context_hash(terms: Terms) -> felt252 {
    let mut fields = array![
        'SURROUND_CHANNEL_V1', PROTOCOL_VERSION.into(), rules::RULES_VERSION.into(),
    ];
    terms.serialize(ref fields);
    poseidon_hash_span(fields.span())
}

pub fn state_hash(state: ChannelState) -> felt252 {
    let mut fields = array!['SURROUND_STATE_V1'];
    state.serialize(ref fields);
    poseidon_hash_span(fields.span())
}

// Stark signatures require a message below 2^251. Use an explicit 250-bit mask
// in every language; never reinterpret a field hash as an unrestricted message.
pub fn signing_hash(fields: Span<felt252>) -> felt252 {
    let digest: u256 = poseidon_hash_span(fields).into();
    let high: felt252 = (digest.high & 0x3ffffffffffffffffffffffffffffff).into();
    let low: felt252 = digest.low.into();
    low + high * 0x100000000000000000000000000000000
}

pub fn action_hash(context: felt252, state: ChannelState, action: Action) -> felt252 {
    let mut fields = array!['SURROUND_ACTION_V1', context, state_hash(state)];
    action.serialize(ref fields);
    signing_hash(fields.span())
}

pub fn checkpoint_hash(context: felt252, epoch: u32, state: ChannelState) -> felt252 {
    signing_hash(array!['SURROUND_CHECKPOINT_V1', context, epoch.into(), state_hash(state)].span())
}

pub fn reopen_hash(context: felt252, epoch: u32, state: ChannelState) -> felt252 {
    signing_hash(array!['SURROUND_REOPEN_V1', context, epoch.into(), state_hash(state)].span())
}

pub fn verify(key: felt252, message: felt252, signature: Signature) {
    let r: u256 = signature.r.into();
    let s: u256 = signature.s.into();
    let order: u256 = core::ec::stark_curve::ORDER.into();
    assert(
        r > 0 && r < 0x800000000000000000000000000000000000000000000000000000000000000,
        'Invalid signature r',
    );
    assert(s > 0 && s < order, 'Invalid signature s');
    assert(
        check_ecdsa_signature(message, key, signature.r, signature.s), 'Invalid session signature',
    );
}

pub fn both_approve(terms: Terms, message: felt252, black: Signature, white: Signature) -> bool {
    let empty = Signature { r: 0, s: 0 };
    if black == empty && white == empty {
        false
    } else {
        verify(terms.black_key, message, black);
        verify(terms.white_key, message, white);
        true
    }
}

pub fn append_history(root: felt252, board_hash: felt252) -> felt252 {
    poseidon_hash_span(array!['SURROUND_HISTORY_V1', root, board_hash].span())
}

pub fn initial_state(size: u8) -> ChannelState {
    rules::validate_size(size);
    let board = rules::empty_position();
    ChannelState {
        sequence: 0,
        move_number: 0,
        board,
        history_root: append_history(0, rules::position_hash(board, size)),
        transcript_hash: 0,
        next_player: rules::BLACK,
        phase: PLAYING,
        consecutive_passes: 0,
        scoring_round: 0,
        resume_player: rules::BLACK,
        proposed: false,
        dead: rules::empty_bits(),
        black_captures: 0,
        white_captures: 0,
        winner: 0,
        finish_reason: 0,
        black_half: 0,
        white_half: 0,
        support_turn: 0,
        last_actor: 0,
    }
}

fn checked_history(state: ChannelState, history: Span<felt252>) -> Felt252Dict<felt252> {
    assert(!history.is_empty(), 'Missing position history');
    let mut seen: Felt252Dict<felt252> = Default::default();
    let mut root = 0;
    for position in history {
        assert(seen.get(*position) == 0, 'Repeated history position');
        seen.insert(*position, 1);
        root = append_history(root, *position);
    }
    assert(root == state.history_root, 'Wrong position history');
    seen
}

pub fn replay(
    terms: Terms, start: ChannelState, history: Span<felt252>, actions: Span<SignedAction>,
) -> ChannelState {
    let context = context_hash(terms);
    let mut seen = checked_history(start, history);
    let mut state = start;
    for step in actions {
        let step = *step;
        let key = if step.action.actor == rules::BLACK {
            terms.black_key
        } else {
            terms.white_key
        };
        verify(key, action_hash(context, state, step.action), step.signature);
        state = transition(terms, state, step.action, ref seen);
    }
    state
}

// Only the Dojo entrypoint authenticating the wallet caller may use this path.
pub fn force(
    terms: Terms, start: ChannelState, history: Span<felt252>, action: Action,
) -> ChannelState {
    let mut seen = checked_history(start, history);
    transition(terms, start, action, ref seen)
}

fn transition(
    terms: Terms, mut state: ChannelState, action: Action, ref seen: Felt252Dict<felt252>,
) -> ChannelState {
    assert(state.phase != FINISHED, 'Game already finished');
    assert(action.actor == rules::BLACK || action.actor == rules::WHITE, 'Invalid actor');
    assert(action.kind <= RESIGN, 'Unknown action');
    assert(action.kind == PLAY || action.point == rules::NO_POINT, 'Noncanonical point');
    assert(action.kind == PROPOSE || action.dead == rules::empty_bits(), 'Noncanonical dead mask');
    let message = action_hash(context_hash(terms), state, action);
    if action.kind == RESIGN {
        state.phase = FINISHED;
        state.winner = rules::other(action.actor);
        state.finish_reason = RESIGNATION;
    } else {
        assert(action.actor == state.next_player, 'Wrong action turn');
        if action.kind == PLAY {
            assert(state.phase == PLAYING, 'Not playing');
            let (board, captured) = rules::play(
                state.board, terms.size, action.actor, action.point,
            );
            let position = rules::position_hash(board, terms.size);
            assert(seen.get(position) == 0, 'Positional superko');
            seen.insert(position, 1);
            state.board = board;
            state.history_root = append_history(state.history_root, position);
            if action.actor == rules::BLACK {
                state.black_captures += captured.into();
            } else {
                state.white_captures += captured.into();
            }
            state.move_number += 1;
            state.consecutive_passes = 0;
            state.next_player = rules::other(action.actor);
        } else if action.kind == PASS {
            assert(state.phase == PLAYING, 'Not playing');
            state.move_number += 1;
            state.consecutive_passes += 1;
            state.next_player = rules::other(action.actor);
            if state.consecutive_passes == 2 {
                state.phase = SCORING;
                state.scoring_round += 1;
                state.resume_player = state.next_player;
                state.proposed = false;
                state.dead = rules::empty_bits();
            }
        } else if action.kind == PROPOSE {
            assert(state.phase == SCORING && !state.proposed, 'Cannot propose');
            // Reuse exact complete-group validation and scoring. The result is
            // recomputed on acceptance; no life/death inference is performed.
            rules::score(state.board, terms.size, action.dead, terms.komi_half);
            state.dead = action.dead;
            state.proposed = true;
            state.next_player = rules::other(action.actor);
        } else if action.kind == ACCEPT {
            assert(state.phase == SCORING && state.proposed, 'No scoring proposal');
            let score = rules::score(state.board, terms.size, state.dead, terms.komi_half);
            state.black_half = score.black_half;
            state.white_half = score.white_half;
            state
                .winner =
                    if score.black_half > score.white_half {
                        rules::BLACK
                    } else if score.white_half > score.black_half {
                        rules::WHITE
                    } else {
                        DRAW
                    };
            state.phase = FINISHED;
            state.finish_reason = AGREEMENT;
        } else {
            assert(action.kind == RESUME && state.phase == SCORING, 'Cannot resume play');
            state.phase = PLAYING;
            state.next_player = state.resume_player;
            state.proposed = false;
            state.dead = rules::empty_bits();
            state.consecutive_passes = 0;
        }
    }
    if state.last_actor != action.actor {
        state.support_turn += 1;
    }
    state.last_actor = action.actor;
    state.sequence += 1;
    state.transcript_hash = poseidon_hash_span(array![state.transcript_hash, message].span());
    state
}
