use referee::{Batch, Envelope, Move, Signature, Terms, TimeControl};
use referee_dojo::models::ChannelGame;
use starknet::ContractAddress;
use surround_ratings::ticket::Ticket;
use surround_rules::go::{GoAction, GoConfig, GoState};
use crate::models::RatedGame;

/// Surround's channel: referee_dojo's entrypoints specialized to Go. Seat 0
/// (the creator) plays black. Go never asks for randomness, so each seat's
/// session key doubles as its committed randomness tip. Every entrypoint that
/// can settle a game records when it did (`Settlement`).
#[starknet::interface]
pub trait IChannel<T> {
    /// `clock` makes the game timed: its referee (a keeper's key) stamps every
    /// step, under Go's standard time rules with the serialized
    /// `referee::clocks::Standard` settings. Ranked games use 60 s per turn
    /// (`rankedClock` in the SDK) or byo-yomi (`byoyomiClock`); `None` is an
    /// untimed game.
    fn create_channel(
        ref self: T,
        size: u8,
        komi_half: u16,
        invited_white: ContractAddress,
        session_key: felt252,
        prover: ContractAddress,
        response_seconds: u32,
        clock: Option<TimeControl>,
    ) -> felt252;
    /// Create a rated game from a matchmaker-signed ticket, as its black. The
    /// world's `SurroundRatings` checks the ticket (once, before it expires,
    /// under the rated-game policy); the ticket fixes the opponent, board,
    /// komi, clock, prover and response window.
    fn create_rated_channel(
        ref self: T, ticket: Ticket, signature: Signature, session_key: felt252,
    ) -> felt252;
    /// Join as white. A rated game must be joined before its ticket expires,
    /// and the join is the game's time for rating.
    fn join_channel(ref self: T, game_id: felt252, session_key: felt252);
    fn cancel_channel(ref self: T, game_id: felt252);
    /// Report a settled rated game to `SurroundRatings` with its `ticket` (from
    /// the contract's `TicketUsed` event) and mirror both players' new ratings
    /// as `PlayerRank` events for Torii. Anyone may call it.
    /// It does nothing for a game that is unrated, not settled, or already
    /// reported, and panics for a ticket that isn't the game's.
    fn rate(ref self: T, game_id: felt252, ticket: Ticket);
    /// Mirror a player's current rating as a `PlayerRank` event, e.g. to seed a
    /// new world's index. Anyone may call it; it does nothing for a player
    /// never rated.
    fn sync(ref self: T, player: ContractAddress);
    /// A rated game's ticket digest and times; all zero for an unrated game.
    fn rated_game(self: @T, game_id: felt252) -> RatedGame;
    /// The `SurroundRatings` contract rated games go through.
    fn ratings(self: @T) -> ContractAddress;
    /// Namespace owners only, once: a world's ratings never change. A new
    /// `SurroundRatings` means a new world.
    fn set_ratings(ref self: T, ratings: ContractAddress);
    fn get_channel(self: @T, game_id: felt252) -> ChannelGame;
    fn terms(self: @T, game_id: felt252) -> Terms<GoConfig>;
    /// What the proof adapter proves from: terms, epoch, and the anchor's and
    /// the candidate's hash and block.
    fn snapshot(self: @T, game_id: felt252) -> (Terms<GoConfig>, u32, felt252, u64, felt252, u64);
    fn accept_verified(
        ref self: T,
        game_id: felt252,
        epoch: u32,
        start_hash: felt252,
        end: Envelope<GoState>,
        acks: Span<Signature>,
    );
    /// Replay steps from the anchor against each seat's final signature and,
    /// in a timed game, their stamps and the referee's final attestation.
    fn submit_history(
        ref self: T,
        game_id: felt252,
        epoch: u32,
        start: Envelope<GoState>,
        history: Span<felt252>,
        batch: Batch<GoAction>,
        acks: Span<Signature>,
    );
    fn open_dispute(ref self: T, game_id: felt252, epoch: u32);
    /// The referee of a timed game is live during this dispute: resolving it
    /// then returns the game to offchain play. Anyone may send the signature.
    fn acknowledge(ref self: T, game_id: felt252, epoch: u32, signature: Signature);
    fn resolve_dispute(ref self: T, game_id: felt252, epoch: u32);
    /// Unstamped: a timed game's clock pauses during forced play.
    fn force_steps(
        ref self: T,
        game_id: felt252,
        epoch: u32,
        start: Envelope<GoState>,
        history: Span<felt252>,
        steps: Span<Move<GoAction>>,
    );
    fn resume_channel(ref self: T, game_id: felt252, epoch: u32, acks: Span<Signature>);
    /// A timed game's referee returns it from forced play on its own.
    fn resume_by_referee(ref self: T, game_id: felt252, epoch: u32, signature: Signature);
    fn claim_timeout(ref self: T, game_id: felt252, epoch: u32);
    fn resign_channel(ref self: T, game_id: felt252);
    fn allow_prover(ref self: T, class_hash: felt252, allowed: bool);
}

#[dojo::contract]
pub mod channel {
    use core::num::traits::Zero;
    use dojo::event::{Event as DojoEvent, EventStorage};
    use dojo::model::{Model, ModelStorage};
    use dojo::world::{IWorldDispatcherTrait, WorldStorage};
    use referee::channel::SETTLED;
    use referee::{Batch, Envelope, Move, Signature, Terms, TimeControl};
    use referee_dojo::channel as binding;
    use referee_dojo::models::ChannelGame;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};
    use surround_ratings::ratings::{
        GameResult, ISurroundRatingsDispatcher, ISurroundRatingsDispatcherTrait, Player,
    };
    use surround_ratings::ticket::{Ticket, digest};
    use surround_rules::go::{GoAction, GoConfig, GoRules, GoState};
    use crate::models::{
        PlayerRank, RatedGame, RatedGameTimesTrait, Settlement, TWO_64, VIA_RESIGN,
        VIA_TIMEOUT_CLAIM, VIA_TRANSCRIPT,
    };

    #[storage]
    struct Storage {
        /// The `SurroundRatings` contract, set once.
        ratings: ContractAddress,
    }

    #[abi(embed_v0)]
    impl ChannelImpl of super::IChannel<ContractState> {
        fn create_channel(
            ref self: ContractState,
            size: u8,
            komi_half: u16,
            invited_white: ContractAddress,
            session_key: felt252,
            prover: ContractAddress,
            response_seconds: u32,
            clock: Option<TimeControl>,
        ) -> felt252 {
            let mut world = self.world_default();
            binding::create::<
                GoRules,
            >(
                ref world,
                GoConfig { size, komi_half },
                invited_white,
                session_key,
                session_key,
                prover,
                response_seconds,
                clock,
            )
        }

        fn create_rated_channel(
            ref self: ContractState, ticket: Ticket, signature: Signature, session_key: felt252,
        ) -> felt252 {
            let mut world = self.world_default();
            let ratings = self.ratings.read();
            assert(ratings.is_non_zero(), 'Ratings not set');
            let game_id = binding::create::<
                GoRules,
            >(
                ref world,
                GoConfig { size: ticket.size, komi_half: ticket.komi_half },
                ticket.white,
                session_key,
                session_key,
                ticket.prover,
                ticket.response_seconds,
                Option::Some(ticket.clock),
            );
            let digest = ISurroundRatingsDispatcher { contract_address: ratings }
                .check_ticket(ticket, signature, get_caller_address(), game_id);
            world
                .write_model(
                    @RatedGame { game_id, ticket: digest, times: ticket.expires_at.into() },
                );
            game_id
        }

        fn join_channel(ref self: ContractState, game_id: felt252, session_key: felt252) {
            let mut world = self.world_default();
            binding::join::<GoRules>(ref world, game_id, session_key, session_key);
            // Only a rated game has a deadline; read that one field, not the
            // whole record, so unrated joins stay cheap.
            let rated = Model::<RatedGame>::ptr_from_keys(game_id);
            let times: u128 = world.read_member(rated, selector!("times"));
            if times != 0 {
                let now = get_block_timestamp();
                assert(now.into() <= times % TWO_64, 'Ticket expired');
                world.write_member(rated, selector!("times"), times + now.into() * TWO_64);
            }
        }

        fn rate(ref self: ContractState, game_id: felt252, ticket: Ticket) {
            let mut world = self.world_default();
            let rated: RatedGame = world.read_model(game_id);
            if rated.ticket == 0 {
                return;
            }
            assert(digest(@ticket) == rated.ticket, 'Not the game ticket');
            // The channel's packed state holds everything rating needs.
            let channel = binding::read_state(@world, game_id);
            let ratings = self.ratings.read();
            if channel.status != SETTLED || ratings.is_zero() {
                return;
            }
            let (result, anchor, candidate) = (channel.result, channel.anchor, channel.candidate);
            let settlement: Settlement = world.read_model(game_id);
            let played_at = rated.played_at();
            let reported = ISurroundRatingsDispatcher { contract_address: ratings }
                .rate_game(
                    ticket,
                    GameResult {
                        game_id,
                        winner: result.winner,
                        reason: result.reason,
                        played_at,
                        settled_at: settlement.timestamp,
                        steps: if anchor.seq > candidate.seq {
                            anchor.seq
                        } else {
                            candidate.seq
                        },
                        onchain_forfeit: settlement.via == VIA_RESIGN
                            || settlement.via == VIA_TIMEOUT_CLAIM,
                    },
                );
            if let Option::Some((black, white)) = reported {
                // Black's score in half points, as SurroundRatings counts it.
                let score = match result.winner {
                    0 => 1,
                    1 => 2,
                    _ => 0,
                };
                // Mirror each side that is rated, both in one call: a player the
                // game didn't count for, and who was never rated, has nothing to
                // show.
                let mut keys = array![];
                let mut values = array![];
                for (player, opponent, points, rating) in array![
                    (ticket.black, ticket.white, score, black),
                    (ticket.white, ticket.black, 2 - score, white),
                ] {
                    if rating.games > 0 {
                        let rank = rank_event(player, rating, game_id, opponent, points, played_at);
                        keys.append(DojoEvent::<PlayerRank>::serialized_keys(@rank));
                        values.append(DojoEvent::<PlayerRank>::serialized_values(@rank));
                    }
                }
                if !keys.is_empty() {
                    world
                        .dispatcher
                        .emit_events(
                            DojoEvent::<PlayerRank>::selector(world.namespace_hash),
                            keys.span(),
                            values.span(),
                        );
                }
            }
        }

        fn sync(ref self: ContractState, player: ContractAddress) {
            let mut world = self.world_default();
            let ratings = self.ratings.read();
            if ratings.is_zero() {
                return;
            }
            let current = ISurroundRatingsDispatcher { contract_address: ratings }.player(player);
            if current.games > 0 {
                world.emit_event(@rank_event(player, current, 0, Zero::zero(), 0, 0));
            }
        }

        fn rated_game(self: @ContractState, game_id: felt252) -> RatedGame {
            self.world_default().read_model(game_id)
        }

        fn ratings(self: @ContractState) -> ContractAddress {
            self.ratings.read()
        }

        fn set_ratings(ref self: ContractState, ratings: ContractAddress) {
            let world = self.world_default();
            assert(
                world.dispatcher.is_owner(world.namespace_hash, get_caller_address()),
                'Only namespace owner',
            );
            assert(self.ratings.read().is_zero(), 'Ratings already set');
            assert(ratings.is_non_zero(), 'Zero ratings');
            self.ratings.write(ratings);
        }

        fn cancel_channel(ref self: ContractState, game_id: felt252) {
            let mut world = self.world_default();
            binding::cancel(ref world, game_id);
        }

        fn get_channel(self: @ContractState, game_id: felt252) -> ChannelGame {
            binding::read(@self.world_default(), game_id)
        }

        fn terms(self: @ContractState, game_id: felt252) -> Terms<GoConfig> {
            binding::terms::<GoRules>(@binding::read(@self.world_default(), game_id))
        }

        fn snapshot(
            self: @ContractState, game_id: felt252,
        ) -> (Terms<GoConfig>, u32, felt252, u64, felt252, u64) {
            binding::snapshot::<GoRules>(@self.world_default(), game_id)
        }

        fn accept_verified(
            ref self: ContractState,
            game_id: felt252,
            epoch: u32,
            start_hash: felt252,
            end: Envelope<GoState>,
            acks: Span<Signature>,
        ) {
            let mut world = self.world_default();
            binding::accept_verified::<GoRules>(ref world, game_id, epoch, start_hash, end, acks);
            note_settlement(ref world, game_id, VIA_TRANSCRIPT);
        }

        fn submit_history(
            ref self: ContractState,
            game_id: felt252,
            epoch: u32,
            start: Envelope<GoState>,
            history: Span<felt252>,
            batch: Batch<GoAction>,
            acks: Span<Signature>,
        ) {
            let mut world = self.world_default();
            binding::submit_history::<
                GoRules,
            >(ref world, game_id, epoch, start, history, batch, acks);
            note_settlement(ref world, game_id, VIA_TRANSCRIPT);
        }

        fn open_dispute(ref self: ContractState, game_id: felt252, epoch: u32) {
            let mut world = self.world_default();
            binding::open_dispute(ref world, game_id, epoch);
        }

        fn acknowledge(
            ref self: ContractState, game_id: felt252, epoch: u32, signature: Signature,
        ) {
            let mut world = self.world_default();
            binding::acknowledge::<GoRules>(ref world, game_id, epoch, signature);
        }

        fn resolve_dispute(ref self: ContractState, game_id: felt252, epoch: u32) {
            let mut world = self.world_default();
            binding::resolve(ref world, game_id, epoch);
            note_settlement(ref world, game_id, VIA_TRANSCRIPT);
        }

        fn force_steps(
            ref self: ContractState,
            game_id: felt252,
            epoch: u32,
            start: Envelope<GoState>,
            history: Span<felt252>,
            steps: Span<Move<GoAction>>,
        ) {
            let mut world = self.world_default();
            binding::force::<GoRules>(ref world, game_id, epoch, start, history, steps);
            note_settlement(ref world, game_id, VIA_TRANSCRIPT);
        }

        fn resume_channel(
            ref self: ContractState, game_id: felt252, epoch: u32, acks: Span<Signature>,
        ) {
            let mut world = self.world_default();
            binding::resume::<GoRules>(ref world, game_id, epoch, acks);
        }

        fn resume_by_referee(
            ref self: ContractState, game_id: felt252, epoch: u32, signature: Signature,
        ) {
            let mut world = self.world_default();
            binding::resume_by_referee::<GoRules>(ref world, game_id, epoch, signature);
        }

        fn claim_timeout(ref self: ContractState, game_id: felt252, epoch: u32) {
            let mut world = self.world_default();
            binding::claim_timeout(ref world, game_id, epoch);
            note_settlement(ref world, game_id, VIA_TIMEOUT_CLAIM);
        }

        fn resign_channel(ref self: ContractState, game_id: felt252) {
            let mut world = self.world_default();
            binding::resign(ref world, game_id);
            note_settlement(ref world, game_id, VIA_RESIGN);
        }

        fn allow_prover(ref self: ContractState, class_hash: felt252, allowed: bool) {
            let mut world = self.world_default();
            binding::allow_prover(ref world, class_hash, allowed);
        }
    }

    /// A player's rating as a `PlayerRank` event, from the game that set it.
    fn rank_event(
        player: ContractAddress,
        rating: Player,
        game_id: felt252,
        opponent: ContractAddress,
        score: u8,
        played_at: u64,
    ) -> PlayerRank {
        PlayerRank {
            player,
            mu: rating.mu,
            phi: rating.phi,
            rank_tenths: rating.rank_tenths,
            provisional: rating.provisional,
            established: rating.established,
            games: rating.games,
            wins: rating.wins,
            losses: rating.losses,
            draws: rating.draws,
            game_id,
            opponent,
            score,
            played_at,
        }
    }

    /// Record when and how `game_id` settled, the first time a call leaves it
    /// settled: later calls on a settled game revert.
    fn note_settlement(ref world: WorldStorage, game_id: felt252, via: u8) {
        if binding::status(@world, game_id) == SETTLED {
            world.write_model(@Settlement { game_id, timestamp: get_block_timestamp(), via });
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn world_default(self: @ContractState) -> WorldStorage {
            self.world(@"surround")
        }
    }
}
