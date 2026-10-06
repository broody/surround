use arbiter::{Approval, Batch, Envelope, Move, Signature, Terms};
use arbiter_dojo::models::ChannelGame;
use starknet::ContractAddress;
use surround_ratings::ticket::Ticket;
use surround_rules::go::{GoAction, GoConfig, GoState};
use crate::models::RatedGame;

/// The longest a delegation `open_rated_game_delegable` takes may still have
/// to run: the week a sign-in lasts, and an hour for the browser's clock. The
/// SDK's `DELEGATION_SECONDS` (offchain/sdk/src/client.mjs) must equal it.
pub const DELEGATION_SECONDS: u64 = 7 * 24 * 3600 + 3600;

/// Surround's channel: arbiter_dojo's entrypoints specialized to Go. Seat 0
/// plays black. Go never asks for randomness, so each seat's session key
/// doubles as its committed randomness tip. A game reaches the chain only when
/// it first needs it, opened on both seats' signed terms in the same
/// transaction. Every entrypoint that can settle a game records when it did
/// (`Settlement`).
#[starknet::interface]
pub trait IChannel<T> {
    /// Open an unrated game on its terms and both seats' wallet signatures
    /// over them (`termsTypedData` in the SDK), in one transaction with the
    /// game's first call that needs the chain. Anyone may send it. The game id
    /// must be the seats' (`arbiter::game_id_of(players, keys)`, `gameIdOf` in
    /// the SDK), so every game takes fresh session keys. A timed
    /// game's clock is Go's standard time rules with the serialized
    /// `arbiter::clocks::Standard` settings: ranked games use 60 s per turn
    /// (`rankedClock` in the SDK) or byo-yomi (`byoyomiClock`). Go takes no
    /// randomness, so `referee_signature` is zero.
    fn open_game(
        ref self: T,
        terms: Terms<GoConfig>,
        signatures: Span<Span<felt252>>,
        referee_signature: Signature,
    );
    /// Open a rated game, as `open_game`, with the matchmaker's signed ticket.
    /// The wallets signed the ticket's digest in the config, and the terms must
    /// be the ticket's: its players (black, white), board, komi, clock, prover
    /// and response window. The world's `SurroundRatings` checks the ticket
    /// under the rated-game policy and accepts it once.
    fn open_rated_game(
        ref self: T,
        terms: Terms<GoConfig>,
        signatures: Span<Span<felt252>>,
        ticket: Ticket,
        signature: Signature,
    );
    /// Open a rated game as `open_rated_game` does, each seat agreeing with
    /// its wallet's signature or with a key its wallet delegated on this
    /// channel (`delegationTypedData` in the SDK) for at most
    /// `DELEGATION_SECONDS` more: a player signed in for a week signs no game.
    /// Only rated games take delegations: the matchmaker's ticket is how a
    /// revoked key is refused before its delegation expires.
    fn open_rated_game_delegable(
        ref self: T,
        terms: Terms<GoConfig>,
        approvals: Span<Approval>,
        ticket: Ticket,
        signature: Signature,
    );
    /// Report a settled rated game to `SurroundRatings` with its `ticket` (from
    /// the contract's `TicketUsed` event) and mirror both players' new ratings
    /// as `PlayerRank` events for Torii. Anyone may call it. The game's time is
    /// when it started, as its referee's first stamp attests (the channel's
    /// `started`).
    /// It does nothing for a game that is unrated, not settled, or already
    /// reported, and panics for a ticket that isn't the game's.
    fn rate(ref self: T, game_id: felt252, ticket: Ticket);
    /// Mirror a player's current rating as a `PlayerRank` event, e.g. to seed a
    /// new world's index. Anyone may call it; it does nothing for a player
    /// never rated.
    fn sync(ref self: T, player: ContractAddress);
    /// A rated game's ticket digest; zero for an unrated game.
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
    use arbiter::channel::SETTLED;
    use arbiter::{Approval, Batch, Envelope, Move, Signature, Terms, TimeControl};
    use arbiter_dojo::channel as binding;
    use arbiter_dojo::models::ChannelGame;
    use core::num::traits::Zero;
    use dojo::event::{Event as DojoEvent, EventStorage};
    use dojo::model::ModelStorage;
    use dojo::world::{IWorldDispatcherTrait, WorldStorage};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};
    use surround_ratings::ratings::{
        GameResult, ISurroundRatingsDispatcher, ISurroundRatingsDispatcherTrait, Player,
    };
    use surround_ratings::ticket::{Ticket, digest};
    use surround_rules::go::{GoAction, GoConfig, GoRules, GoState};
    use crate::models::{
        PlayerRank, RatedGame, Settlement, VIA_RESIGN, VIA_TIMEOUT_CLAIM, VIA_TRANSCRIPT,
    };
    use super::DELEGATION_SECONDS;

    #[storage]
    struct Storage {
        /// The `SurroundRatings` contract, set once.
        ratings: ContractAddress,
    }

    #[abi(embed_v0)]
    impl ChannelImpl of super::IChannel<ContractState> {
        fn open_game(
            ref self: ContractState,
            terms: Terms<GoConfig>,
            signatures: Span<Span<felt252>>,
            referee_signature: Signature,
        ) {
            let mut world = self.world_default();
            // A game signed as rated opens only as rated, with its ticket.
            assert(terms.config.ticket == 0, 'Rated game needs its ticket');
            if let Option::Some(time) = terms.clock {
                no_rolls(time);
            }
            binding::open_game::<GoRules>(ref world, terms, signatures, referee_signature);
        }

        fn open_rated_game(
            ref self: ContractState,
            terms: Terms<GoConfig>,
            signatures: Span<Span<felt252>>,
            ticket: Ticket,
            signature: Signature,
        ) {
            let mut world = self.world_default();
            let ratings = self.ticket_ratings(@terms, @ticket);
            let game_id = terms.game_id;
            binding::open_game::<GoRules>(ref world, terms, signatures, Signature { r: 0, s: 0 });
            rated(ref world, ratings, ticket, signature, game_id);
        }

        fn open_rated_game_delegable(
            ref self: ContractState,
            terms: Terms<GoConfig>,
            approvals: Span<Approval>,
            ticket: Ticket,
            signature: Signature,
        ) {
            let mut world = self.world_default();
            let ratings = self.ticket_ratings(@terms, @ticket);
            let game_id = terms.game_id;
            binding::open_game_delegable::<
                GoRules,
            >(ref world, terms, approvals, Signature { r: 0, s: 0 }, DELEGATION_SECONDS);
            rated(ref world, ratings, ticket, signature, game_id);
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
            let onchain_forfeit = settlement.via == VIA_RESIGN
                || settlement.via == VIA_TIMEOUT_CLAIM;
            // When the game started, as its referee's first stamp attests. A
            // forfeit can settle before any stamped state reaches the chain: it
            // is dated by its ticket, so a losing seat can't void its loss by
            // opening the game and resigning first.
            let played_at = if channel.started == 0 && onchain_forfeit {
                ticket.issued_at
            } else {
                channel.started
            };
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
                        onchain_forfeit,
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

        /// The `SurroundRatings` a rated game opens under, once its terms are
        /// its ticket's: everything but the keys and tips (Go's tips are the
        /// keys), which with the players fix the game id.
        fn ticket_ratings(
            self: @ContractState, terms: @Terms<GoConfig>, ticket: @Ticket,
        ) -> ContractAddress {
            let ratings = self.ratings.read();
            assert(ratings.is_non_zero(), 'Ratings not set');
            assert(*terms.config.ticket == digest(ticket), 'Not the ticket game');
            assert(
                *terms.players == array![(*ticket.black).into(), (*ticket.white).into()].span(),
                'Not the ticket players',
            );
            assert(
                *terms.config.size == *ticket.size && *terms.config.komi_half == *ticket.komi_half,
                'Not the ticket board',
            );
            assert(*terms.clock == Option::Some(*ticket.clock), 'Not the ticket clock');
            assert(*terms.prover == (*ticket.prover).into(), 'Not the ticket prover');
            assert(*terms.response_seconds == *ticket.response_seconds, 'Not the ticket window');
            no_rolls(*ticket.clock);
            ratings
        }
    }

    /// `SurroundRatings` accepts a rated game's ticket, once, and the game
    /// is rated under it.
    fn rated(
        ref world: WorldStorage,
        ratings: ContractAddress,
        ticket: Ticket,
        signature: Signature,
        game_id: felt252,
    ) {
        let digest = ISurroundRatingsDispatcher { contract_address: ratings }
            .check_ticket(ticket, signature, game_id);
        world.write_model(@RatedGame { game_id, ticket: digest });
    }

    /// Go never asks for a roll, so a game's clock carries no referee tip.
    fn no_rolls(clock: TimeControl) {
        assert(clock.rng_tip == 0, 'Go takes no randomness');
    }
}
