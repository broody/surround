use starknet::ContractAddress;

/// When a game settled: the block timestamp of the transaction that settled
/// it. The channel writes it once; it dates the game's kifu.
#[derive(Copy, Drop, Serde)]
#[dojo::model]
pub struct Settlement {
    #[key]
    pub game_id: felt252,
    pub timestamp: u64,
}

/// A minted kifu: a settled ranked game's packed steps and final position
/// (`kifu::record`). Its token ID is the game ID; the players, board, komi,
/// clock and result stay in the game's `ChannelGame`, its date in its
/// `Settlement`.
#[derive(Copy, Drop, Serde)]
#[dojo::model]
pub struct Kifu {
    #[key]
    pub game_id: felt252,
    pub record: Span<felt252>,
}

/// What a kifu records beyond its moves, emitted once when it is minted so
/// Torii can index and query it, and returned by the contract's `summary`.
#[derive(Copy, Drop, Serde, Debug, PartialEq)]
#[dojo::event]
pub struct KifuSummary {
    #[key]
    pub game_id: felt252,
    pub black: ContractAddress,
    pub white: ContractAddress,
    pub winner: ContractAddress,
    pub loser: ContractAddress,
    pub size: u8,
    pub komi_half: u16,
    /// Plays and passes.
    pub moves: u32,
    /// How the game ended, as referee's reasons: 1 by score, 128 by
    /// resignation, 129 on time.
    pub reason: u8,
    /// Scores in half points; zero unless the game ended by score.
    pub black_score_half: u16,
    pub white_score_half: u16,
    /// The stones each player captured.
    pub black_captures: u32,
    pub white_captures: u32,
    /// Unix seconds; zero for a game settled before settlements were recorded.
    pub settled_at: u64,
}
