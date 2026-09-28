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

/// A rated game, created from a matchmaker's signed ticket
/// (`create_rated_channel`), which fixed its players, board, komi, clock and
/// prover before play. `SurroundRatings` rates it once it settles.
#[derive(Copy, Drop, Serde, Debug, PartialEq)]
#[dojo::model]
pub struct RatedGame {
    #[key]
    pub game_id: felt252,
    pub black: ContractAddress,
    pub white: ContractAddress,
    pub size: u8,
    /// `QUEUE` (1) or `TABLE` (2).
    pub source: u8,
    /// Starting bands, used for a player's first rated game.
    pub black_band: u8,
    pub white_band: u8,
    /// The matchmaker key that signed the ticket, and the ticket's digest.
    pub matchmaker: felt252,
    pub ticket: felt252,
    /// White must join by then.
    pub expires_at: u64,
    /// When white joined: the game's time for rating. Zero until then.
    pub played_at: u64,
}

/// The `SurroundRatings` contract this world's channel reports rated games to.
/// A single record, under key 0.
#[derive(Copy, Drop, Serde, Debug)]
#[dojo::model]
pub struct RatingsConfig {
    #[key]
    pub id: u8,
    pub ratings: ContractAddress,
}

/// A player's rating as `SurroundRatings` last reported it through this world,
/// keyed by player so Torii keeps the latest. Emitted by `rate` and `sync`; the
/// contract itself stays the source of truth.
#[derive(Copy, Drop, Serde, Debug, PartialEq)]
#[dojo::event]
pub struct PlayerRank {
    #[key]
    pub player: ContractAddress,
    /// μ and φ in Q32.32 logits.
    pub mu: i64,
    pub phi: u64,
    /// Rank on OGS's scale in tenths: 0 is 30k, 300 is 1d.
    pub rank_tenths: u16,
    pub provisional: bool,
    pub established: bool,
    pub games: u32,
    pub wins: u32,
    pub losses: u32,
    pub draws: u32,
}

/// One player's side of a rated game, keyed by (player, game) so Torii keeps
/// one record per game: a player's rank history.
#[derive(Copy, Drop, Serde, Debug, PartialEq)]
#[dojo::event]
pub struct RatingChanged {
    #[key]
    pub player: ContractAddress,
    #[key]
    pub game_id: felt252,
    pub opponent: ContractAddress,
    /// The player's score in half points: 2 won, 1 drew, 0 lost.
    pub score: u8,
    pub mu: i64,
    pub rank_tenths: u16,
    pub provisional: bool,
    pub played_at: u64,
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
