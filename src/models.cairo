use starknet::ContractAddress;
use crate::rules::{Bits, Position};

#[derive(Copy, Drop, Serde, Introspect, DojoStore, PartialEq, Debug, Default)]
pub enum Phase {
    #[default]
    Waiting,
    Playing,
    Scoring,
    Finished,
    Cancelled,
}

#[derive(Copy, Drop, Serde, Introspect, DojoStore, PartialEq, Debug, Default)]
pub enum Winner {
    #[default]
    None,
    Black,
    White,
    Draw,
}

#[derive(Copy, Drop, Serde, Introspect, DojoStore, PartialEq, Debug, Default)]
pub enum FinishReason {
    #[default]
    None,
    Agreement,
    Resignation,
    Timeout,
}

#[derive(Copy, Drop, Serde)]
#[dojo::model]
pub struct Game {
    #[key]
    pub id: felt252,
    pub black: ContractAddress,
    // While Waiting: the invited white player, or zero for an open game.
    pub white: ContractAddress,
    pub size: u8,
    pub komi_half: u16,
    pub rules_version: u16,
    pub phase: Phase,
    pub next_player: u8,
    pub move_number: u32,
    pub consecutive_passes: u8,
    pub scoring_round: u32,
    pub turn_seconds: u32,
    pub scoring_seconds: u32,
    pub deadline: u64,
    pub board_hash: felt252,
    pub black_captures: u32,
    pub white_captures: u32,
    pub winner: Winner,
    pub finish_reason: FinishReason,
    pub black_score_half: u16,
    pub white_score_half: u16,
}

#[derive(Copy, Drop, Serde)]
#[dojo::model]
pub struct Board {
    #[key]
    pub game_id: felt252,
    pub position: Position,
}

#[derive(Copy, Drop, Serde)]
#[dojo::model]
pub struct PositionHistory {
    #[key]
    pub game_id: felt252,
    #[key]
    pub board_hash: felt252,
    pub seen: bool,
}

#[derive(Copy, Drop, Serde)]
#[dojo::model]
pub struct ScoreProposal {
    #[key]
    pub game_id: felt252,
    pub round: u32,
    pub revision: u32,
    pub board_hash: felt252,
    pub dead: Bits,
    pub black_approved: bool,
    pub white_approved: bool,
}

#[derive(Copy, Drop, Serde, Introspect)]
pub enum Action {
    Created,
    Joined,
    Played,
    Passed,
    Marked,
    Approved,
    Resumed,
    Finished,
    Cancelled,
}

#[derive(Copy, Drop, Serde)]
#[dojo::event]
pub struct GameUpdated {
    #[key]
    pub game_id: felt252,
    pub actor: ContractAddress,
    pub action: Action,
    pub move_number: u32,
    pub scoring_round: u32,
    pub proposal_revision: u32,
    pub point: u16,
    pub board_hash: felt252,
}
