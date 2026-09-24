use starknet::ContractAddress;
use crate::channel_protocol::ChannelState;

pub const WAITING: u8 = 0;
pub const ACTIVE: u8 = 1;
pub const DISPUTE: u8 = 2;
pub const FORCED: u8 = 3;
pub const SETTLED: u8 = 4;
pub const CANCELLED: u8 = 5;

#[derive(Copy, Drop, Serde)]
#[dojo::model]
pub struct ChannelGame {
    #[key]
    pub id: felt252,
    pub black: ContractAddress,
    pub white: ContractAddress,
    pub black_key: felt252,
    pub white_key: felt252,
    pub prover: ContractAddress,
    pub size: u8,
    pub komi_half: u16,
    pub response_seconds: u32,
    pub status: u8,
    pub epoch: u32,
    pub context: felt252,
    pub anchor_block: u64,
    pub deadline: u64,
    pub anchor: ChannelState,
    pub candidate: ChannelState,
}

#[derive(Copy, Drop, Serde)]
#[dojo::event]
pub struct ChannelUpdated {
    #[key]
    pub game_id: felt252,
    pub kind: u8,
    pub epoch: u32,
    pub sequence: u32,
    pub status: u8,
    pub deadline: u64,
    pub state_hash: felt252,
    pub winner: u8,
}
