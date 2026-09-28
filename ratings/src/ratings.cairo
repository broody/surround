use starknet::{ClassHash, ContractAddress};

/// Game sources recorded by the matchmaker's ticket.
pub const QUEUE: u8 = 1;
pub const TABLE: u8 = 2;
/// `game_status` values.
pub const NONE: u8 = 0;
pub const RATED: u8 = 1;
pub const VOID: u8 = 2;
/// `GameVoided.reason` values.
pub const VOID_INVALID: u8 = 1;
pub const VOID_MATCHMAKER: u8 = 2;
pub const VOID_REFEREE: u8 = 3;
/// referee's timeout reason.
pub const REASON_TIMEOUT: u8 = 129;
/// Version of the rating constants that last updated a player.
pub const PARAMS: u8 = 1;

/// A settled rated game, as the channel that hosted it reports it.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct GameResult {
    pub game_id: felt252,
    pub black: ContractAddress,
    pub white: ContractAddress,
    /// referee's winner: 1 black (seat 0), 2 white (seat 1), 0 a draw.
    pub winner: u8,
    /// referee's reason: 1 by score, 128 resignation, 129 timeout.
    pub reason: u8,
    pub size: u8,
    /// `QUEUE` or `TABLE`.
    pub source: u8,
    /// When the game started (the join), in seconds; used for aging.
    pub played_at: u64,
    /// Starting bands, used only for a player's first rated game.
    pub black_band: u8,
    pub white_band: u8,
    /// The key that signed the pairing and the key that refereed the clock.
    pub matchmaker: felt252,
    pub referee: felt252,
}

/// A player's rating and record. `games == 0`: never rated.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct Player {
    /// μ and φ in Q32.32 logits.
    pub mu: i64,
    pub phi: u64,
    pub last_played: u64,
    pub games: u32,
    pub wins: u32,
    pub losses: u32,
    pub draws: u32,
    /// Rank on OGS's scale in tenths: 0 is 30k, 300 is 1d.
    pub rank_tenths: u16,
    /// "?": φ above 1.0, or no win or no loss yet.
    pub provisional: bool,
    /// Set once the rank first stops being provisional; never cleared.
    pub established: bool,
    /// Highest μ − 2φ in queue games while established, Q; valid if `has_peak`.
    pub peak: i64,
    pub has_peak: bool,
    pub band: u8,
    pub params: u8,
}

#[starknet::interface]
pub trait ISurroundRatings<T> {
    /// Rate a settled game once. Only allowlisted channels may report games;
    /// for anything else, or a game already rated or voided, it does nothing
    /// and returns `None`. A game signed by a revoked matchmaker, a timeout
    /// flagged by a revoked referee, or invalid data is voided instead.
    fn rate_game(ref self: T, game: GameResult) -> Option<(Player, Player)>;
    fn player(self: @T, player: ContractAddress) -> Player;
    /// (rank in tenths, provisional, rated) for each player.
    fn ranks(self: @T, players: Span<ContractAddress>) -> Array<(u16, bool, bool)>;
    fn game_status(self: @T, channel: ContractAddress, game_id: felt252) -> u8;
    fn is_channel(self: @T, channel: ContractAddress) -> bool;
    fn is_matchmaker(self: @T, key: felt252) -> bool;
    fn is_referee(self: @T, key: felt252) -> bool;
    fn owner(self: @T) -> ContractAddress;
    fn set_channel(ref self: T, channel: ContractAddress, allowed: bool);
    fn set_matchmaker(ref self: T, key: felt252, allowed: bool);
    fn set_referee(ref self: T, key: felt252, allowed: bool);
    fn transfer_ownership(ref self: T, owner: ContractAddress);
    fn upgrade(ref self: T, class_hash: ClassHash);
}

#[starknet::contract]
pub mod SurroundRatings {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::syscalls::replace_class_syscall;
    use starknet::{ClassHash, ContractAddress, SyscallResultTrait, get_caller_address};
    use crate::math::{self, Rating};
    use super::{
        GameResult, NONE, PARAMS, Player, QUEUE, RATED, REASON_TIMEOUT, TABLE, VOID, VOID_INVALID,
        VOID_MATCHMAKER, VOID_REFEREE,
    };

    const TWO_32: u256 = 0x100000000;
    const TWO_64: u256 = 0x10000000000000000;
    const TWO_128: u256 = 0x100000000000000000000000000000000;
    const I64_BIAS: i128 = 0x8000000000000000;

    #[storage]
    struct Storage {
        owner: ContractAddress,
        channels: Map<ContractAddress, bool>,
        matchmakers: Map<felt252, bool>,
        referees: Map<felt252, bool>,
        /// μ, φ and last-played time, packed in one felt.
        ratings: Map<ContractAddress, felt252>,
        /// Counters, peak, band, flags and params version, packed in one felt.
        records: Map<ContractAddress, felt252>,
        games: Map<(ContractAddress, felt252), u8>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        RatingUpdated: RatingUpdated,
        GameVoided: GameVoided,
        ChannelSet: ChannelSet,
        MatchmakerSet: MatchmakerSet,
        RefereeSet: RefereeSet,
        OwnershipTransferred: OwnershipTransferred,
        Upgraded: Upgraded,
    }

    /// One player's side of a rated game: enough to replay every rating with
    /// offchain/sdk/src/rating.mjs.
    #[derive(Drop, starknet::Event)]
    pub struct RatingUpdated {
        #[key]
        pub player: ContractAddress,
        #[key]
        pub channel: ContractAddress,
        #[key]
        pub game_id: felt252,
        pub opponent: ContractAddress,
        /// The player's score in half points: 2 won, 1 drew, 0 lost.
        pub score: u8,
        pub played_at: u64,
        /// The band a first game started from; 0 otherwise.
        pub band: u8,
        pub mu: i64,
        pub phi: u64,
        pub last_played: u64,
        pub rank_tenths: u16,
    }

    #[derive(Drop, starknet::Event)]
    pub struct GameVoided {
        #[key]
        pub channel: ContractAddress,
        #[key]
        pub game_id: felt252,
        pub reason: u8,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ChannelSet {
        #[key]
        pub channel: ContractAddress,
        pub allowed: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MatchmakerSet {
        #[key]
        pub key: felt252,
        pub allowed: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RefereeSet {
        #[key]
        pub key: felt252,
        pub allowed: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OwnershipTransferred {
        pub previous: ContractAddress,
        pub owner: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Upgraded {
        pub class_hash: ClassHash,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        assert(owner.is_non_zero(), 'Zero owner');
        self.owner.write(owner);
    }

    #[abi(embed_v0)]
    impl SurroundRatingsImpl of super::ISurroundRatings<ContractState> {
        fn rate_game(ref self: ContractState, game: GameResult) -> Option<(Player, Player)> {
            let channel = get_caller_address();
            if !self.channels.read(channel) {
                return Option::None;
            }
            let key = (channel, game.game_id);
            if self.games.read(key) != NONE {
                return Option::None;
            }
            let void = if !valid(@game) {
                VOID_INVALID
            } else if !self.matchmakers.read(game.matchmaker) {
                VOID_MATCHMAKER
            } else if game.reason == REASON_TIMEOUT && !self.referees.read(game.referee) {
                VOID_REFEREE
            } else {
                0
            };
            if void != 0 {
                self.games.write(key, VOID);
                self.emit(GameVoided { channel, game_id: game.game_id, reason: void });
                return Option::None;
            }

            let (black, mut black_record) = self.load(game.black);
            let (white, mut white_record) = self.load(game.white);
            let black_new = black_record.games == 0;
            let white_new = white_record.games == 0;
            let black_start = if black_new {
                math::start(game.black_band).unwrap()
            } else {
                black
            };
            let white_start = if white_new {
                math::start(game.white_band).unwrap()
            } else {
                white
            };
            // Black's score in half points.
            let result = match game.winner {
                0 => 1,
                1 => 2,
                _ => 0,
            };
            let (black_after, white_after, _) = math::update(
                black_start, white_start, result, game.played_at,
            );
            if black_new {
                black_record.band = game.black_band;
            }
            if white_new {
                white_record.band = game.white_band;
            }
            count_game(ref black_record, black_after, result, game.source);
            count_game(ref white_record, white_after, 2 - result, game.source);
            self.store(game.black, black_after, black_record);
            self.store(game.white, white_after, white_record);
            self.games.write(key, RATED);

            let black_view = view(black_after, black_record);
            let white_view = view(white_after, white_record);
            self
                .emit(
                    RatingUpdated {
                        player: game.black,
                        channel,
                        game_id: game.game_id,
                        opponent: game.white,
                        score: result,
                        played_at: game.played_at,
                        band: if black_new {
                            game.black_band
                        } else {
                            0
                        },
                        mu: black_view.mu,
                        phi: black_view.phi,
                        last_played: black_view.last_played,
                        rank_tenths: black_view.rank_tenths,
                    },
                );
            self
                .emit(
                    RatingUpdated {
                        player: game.white,
                        channel,
                        game_id: game.game_id,
                        opponent: game.black,
                        score: 2 - result,
                        played_at: game.played_at,
                        band: if white_new {
                            game.white_band
                        } else {
                            0
                        },
                        mu: white_view.mu,
                        phi: white_view.phi,
                        last_played: white_view.last_played,
                        rank_tenths: white_view.rank_tenths,
                    },
                );
            Option::Some((black_view, white_view))
        }

        fn player(self: @ContractState, player: ContractAddress) -> Player {
            let (rating, record) = self.load(player);
            view(rating, record)
        }

        fn ranks(self: @ContractState, players: Span<ContractAddress>) -> Array<(u16, bool, bool)> {
            let mut out = array![];
            for player in players {
                let p = self.player(*player);
                out.append((p.rank_tenths, p.provisional, p.games > 0));
            }
            out
        }

        fn game_status(self: @ContractState, channel: ContractAddress, game_id: felt252) -> u8 {
            self.games.read((channel, game_id))
        }

        fn is_channel(self: @ContractState, channel: ContractAddress) -> bool {
            self.channels.read(channel)
        }

        fn is_matchmaker(self: @ContractState, key: felt252) -> bool {
            self.matchmakers.read(key)
        }

        fn is_referee(self: @ContractState, key: felt252) -> bool {
            self.referees.read(key)
        }

        fn owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }

        fn set_channel(ref self: ContractState, channel: ContractAddress, allowed: bool) {
            self.only_owner();
            self.channels.write(channel, allowed);
            self.emit(ChannelSet { channel, allowed });
        }

        fn set_matchmaker(ref self: ContractState, key: felt252, allowed: bool) {
            self.only_owner();
            self.matchmakers.write(key, allowed);
            self.emit(MatchmakerSet { key, allowed });
        }

        fn set_referee(ref self: ContractState, key: felt252, allowed: bool) {
            self.only_owner();
            self.referees.write(key, allowed);
            self.emit(RefereeSet { key, allowed });
        }

        fn transfer_ownership(ref self: ContractState, owner: ContractAddress) {
            self.only_owner();
            assert(owner.is_non_zero(), 'Zero owner');
            let previous = self.owner.read();
            self.owner.write(owner);
            self.emit(OwnershipTransferred { previous, owner });
        }

        fn upgrade(ref self: ContractState, class_hash: ClassHash) {
            self.only_owner();
            replace_class_syscall(class_hash).unwrap_syscall();
            self.emit(Upgraded { class_hash });
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn only_owner(self: @ContractState) {
            assert(get_caller_address() == self.owner.read(), 'Only owner');
        }

        fn load(self: @ContractState, player: ContractAddress) -> (Rating, Record) {
            (unpack_rating(self.ratings.read(player)), unpack_record(self.records.read(player)))
        }

        fn store(ref self: ContractState, player: ContractAddress, rating: Rating, record: Record) {
            self.ratings.write(player, pack_rating(rating));
            self.records.write(player, pack_record(record));
        }
    }

    /// The stored part of a `Player` besides its rating.
    #[derive(Copy, Drop, PartialEq, Debug)]
    struct Record {
        games: u32,
        wins: u32,
        losses: u32,
        draws: u32,
        peak: i128,
        band: u8,
        established: bool,
        has_peak: bool,
        params: u8,
    }

    fn valid(game: @GameResult) -> bool {
        let black = *game.black;
        let white = *game.white;
        black.is_non_zero()
            && white.is_non_zero()
            && black != white
            && *game.winner <= 2
            && (*game.source == QUEUE || *game.source == TABLE)
            && (*game.size == 9 || *game.size == 13 || *game.size == 19)
            && math::start(*game.black_band).is_some()
            && math::start(*game.white_band).is_some()
    }

    /// Count one game with the player's score in half points, and update the
    /// established flag and peak.
    fn count_game(ref record: Record, rating: Rating, score: u8, source: u8) {
        record.games += 1;
        match score {
            0 => record.losses += 1,
            1 => record.draws += 1,
            _ => record.wins += 1,
        }
        if !record.established && !math::provisional(rating.phi, record.wins, record.losses) {
            record.established = true;
        }
        if record.established && source == QUEUE {
            let low = rating.mu - 2 * rating.phi;
            if !record.has_peak || low > record.peak {
                record.peak = low;
                record.has_peak = true;
            }
        }
        record.params = PARAMS;
    }

    fn view(rating: Rating, record: Record) -> Player {
        let rated = record.games > 0;
        Player {
            mu: rating.mu.try_into().unwrap(),
            phi: rating.phi.try_into().unwrap(),
            last_played: rating.last,
            games: record.games,
            wins: record.wins,
            losses: record.losses,
            draws: record.draws,
            rank_tenths: if rated {
                math::rank_tenths(rating.mu)
            } else {
                0
            },
            provisional: !rated || math::provisional(rating.phi, record.wins, record.losses),
            established: record.established,
            peak: record.peak.try_into().unwrap(),
            has_peak: record.has_peak,
            band: record.band,
            params: record.params,
        }
    }

    // Packing: signed values carry a 2^63 bias into 64 bits. A zero felt
    // unpacks to μ = −2^63 and φ = 0, so `unpack_rating` maps it to zeros.

    fn unsigned(x: i128) -> u256 {
        let x: u128 = x.try_into().unwrap();
        x.into()
    }

    fn signed(x: u256) -> i128 {
        let x: u128 = x.try_into().unwrap();
        x.try_into().unwrap()
    }

    fn biased(x: i128) -> u256 {
        unsigned(x + I64_BIAS)
    }

    fn unbiased(x: u256) -> i128 {
        signed(x) - I64_BIAS
    }

    fn pack_rating(rating: Rating) -> felt252 {
        let mu = biased(rating.mu);
        let phi = unsigned(rating.phi);
        let last: u256 = rating.last.into();
        (mu + phi * TWO_64 + last * TWO_128).try_into().unwrap()
    }

    fn unpack_rating(packed: felt252) -> Rating {
        if packed == 0 {
            return Rating { mu: 0, phi: 0, last: 0 };
        }
        let packed: u256 = packed.into();
        let mu = unbiased(packed % TWO_64);
        let phi = signed(packed / TWO_64 % TWO_64);
        let last: u64 = (packed / TWO_128).try_into().unwrap();
        Rating { mu, phi, last }
    }

    fn pack_record(record: Record) -> felt252 {
        let peak = biased(record.peak);
        let flags: u256 = if record.established {
            1
        } else {
            0
        }
            + if record.has_peak {
                2
            } else {
                0
            };
        let band: u256 = record.band.into();
        let params: u256 = record.params.into();
        let games: u256 = record.games.into();
        let wins: u256 = record.wins.into();
        let losses: u256 = record.losses.into();
        let draws: u256 = record.draws.into();
        let low = games + wins * TWO_32 + losses * TWO_64 + draws * TWO_64 * TWO_32;
        let high = peak + band * TWO_64 + flags * TWO_64 * 0x100 + params * TWO_64 * 0x10000;
        (low + high * TWO_128).try_into().unwrap()
    }

    fn unpack_record(packed: felt252) -> Record {
        if packed == 0 {
            return Record {
                games: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                peak: 0,
                band: 0,
                established: false,
                has_peak: false,
                params: 0,
            };
        }
        let packed: u256 = packed.into();
        let low = packed % TWO_128;
        let high = packed / TWO_128;
        let flags: u8 = (high / TWO_64 / 0x100 % 0x100).try_into().unwrap();
        Record {
            games: (low % TWO_32).try_into().unwrap(),
            wins: (low / TWO_32 % TWO_32).try_into().unwrap(),
            losses: (low / TWO_64 % TWO_32).try_into().unwrap(),
            draws: (low / TWO_64 / TWO_32).try_into().unwrap(),
            peak: unbiased(high % TWO_64),
            band: (high / TWO_64 % 0x100).try_into().unwrap(),
            established: flags % 2 == 1,
            has_peak: flags / 2 % 2 == 1,
            params: (high / TWO_64 / 0x10000).try_into().unwrap(),
        }
    }
}
