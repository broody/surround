use starknet::ContractAddress;

/// `Settlement.via` values: how a game settled. A transcript (a replay, a
/// proof, a dispute's resolution or forced play) holds every step; an onchain
/// resignation or abandonment may sit on a stale anchor.
pub const VIA_TRANSCRIPT: u8 = 1;
pub const VIA_RESIGN: u8 = 2;
pub const VIA_TIMEOUT_CLAIM: u8 = 3;

/// When and how a game settled: the block timestamp of the transaction that
/// settled it, and which kind of transaction it was. The channel writes it
/// once; it dates the game's kifu, and rating reads `via`.
#[derive(Copy, Drop, Serde)]
#[dojo::model]
pub struct Settlement {
    #[key]
    pub game_id: felt252,
    pub timestamp: u64,
    pub via: u8,
}

/// A rated game, created from a matchmaker's signed ticket
/// (`create_rated_channel`), which fixed its players, board, komi, clock and
/// prover before play. `SurroundRatings` holds the ticket's facts under its
/// digest (its `TicketUsed` event carries the ticket), and rates the game once
/// it settles.
#[derive(Copy, Drop, Serde, Debug, PartialEq)]
#[dojo::model]
pub struct RatedGame {
    #[key]
    pub game_id: felt252,
    /// The ticket's digest.
    pub ticket: felt252,
    /// The join deadline (low 64 bits) and when white joined (high 64 bits,
    /// zero until then): the game's time for rating.
    pub times: u128,
}

pub const TWO_64: u128 = 0x10000000000000000;

#[generate_trait]
pub impl RatedGameTimes of RatedGameTimesTrait {
    /// White must join by then.
    fn expires_at(self: @RatedGame) -> u64 {
        (*self.times % TWO_64).try_into().unwrap()
    }

    /// When white joined; zero until then.
    fn played_at(self: @RatedGame) -> u64 {
        (*self.times / TWO_64).try_into().unwrap()
    }
}

/// A player's rating as `SurroundRatings` last reported it through this world,
/// keyed by player, with the game that set it. Torii keeps the latest per
/// player, and, configured to keep this event historical, one per game: the
/// player's rank history. Emitted by `rate` and `sync` (with game 0); the
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
    /// The rated game that set it, its opponent, the player's score in half
    /// points (2 won, 1 drew, 0 lost) and when it was played; zeros for `sync`.
    pub game_id: felt252,
    pub opponent: ContractAddress,
    pub score: u8,
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
