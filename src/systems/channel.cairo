use referee::{Envelope, Move, Signature, Terms};
use referee_dojo::models::ChannelGame;
use starknet::ContractAddress;
use surround_rules::go::{GoAction, GoConfig, GoState};

/// Surround's channel: referee_dojo's entrypoints specialized to Go. Seat 0
/// (the creator) plays black. Go never asks for randomness, so each seat's
/// session key doubles as its committed randomness tip.
#[starknet::interface]
pub trait IChannel<T> {
    fn create_channel(
        ref self: T,
        size: u8,
        komi_half: u16,
        invited_white: ContractAddress,
        session_key: felt252,
        prover: ContractAddress,
        response_seconds: u32,
    ) -> felt252;
    fn join_channel(ref self: T, game_id: felt252, session_key: felt252);
    fn cancel_channel(ref self: T, game_id: felt252);
    fn get_channel(self: @T, game_id: felt252) -> ChannelGame;
    fn terms(self: @T, game_id: felt252) -> Terms<GoConfig>;
    /// What the proof adapter proves from: terms, epoch, anchor hash and block.
    fn snapshot(self: @T, game_id: felt252) -> (Terms<GoConfig>, u32, felt252, u64);
    fn accept_verified(
        ref self: T,
        game_id: felt252,
        epoch: u32,
        start_hash: felt252,
        end: Envelope<GoState>,
        acks: Span<Signature>,
    );
    fn submit_history(
        ref self: T,
        game_id: felt252,
        epoch: u32,
        start: Envelope<GoState>,
        history: Span<felt252>,
        steps: Span<Move<GoAction>>,
        signatures: Span<Signature>,
        acks: Span<Signature>,
    );
    fn open_dispute(ref self: T, game_id: felt252, epoch: u32);
    fn resolve_dispute(ref self: T, game_id: felt252, epoch: u32);
    fn force_steps(
        ref self: T,
        game_id: felt252,
        epoch: u32,
        start: Envelope<GoState>,
        history: Span<felt252>,
        steps: Span<Move<GoAction>>,
    );
    fn resume_channel(ref self: T, game_id: felt252, epoch: u32, acks: Span<Signature>);
    fn claim_timeout(ref self: T, game_id: felt252, epoch: u32);
    fn resign_channel(ref self: T, game_id: felt252);
    fn allow_prover(ref self: T, class_hash: felt252, allowed: bool);
}

#[dojo::contract]
pub mod channel {
    use dojo::world::WorldStorage;
    use referee::{Envelope, Move, Signature, Terms};
    use referee_dojo::channel as binding;
    use referee_dojo::models::ChannelGame;
    use starknet::ContractAddress;
    use surround_rules::go::{GoAction, GoConfig, GoRules, GoState};

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
            )
        }

        fn join_channel(ref self: ContractState, game_id: felt252, session_key: felt252) {
            let mut world = self.world_default();
            binding::join::<GoRules>(ref world, game_id, session_key, session_key);
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
        ) -> (Terms<GoConfig>, u32, felt252, u64) {
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
        }

        fn submit_history(
            ref self: ContractState,
            game_id: felt252,
            epoch: u32,
            start: Envelope<GoState>,
            history: Span<felt252>,
            steps: Span<Move<GoAction>>,
            signatures: Span<Signature>,
            acks: Span<Signature>,
        ) {
            let mut world = self.world_default();
            binding::submit_history::<
                GoRules,
            >(ref world, game_id, epoch, start, history, steps, signatures, acks);
        }

        fn open_dispute(ref self: ContractState, game_id: felt252, epoch: u32) {
            let mut world = self.world_default();
            binding::open_dispute(ref world, game_id, epoch);
        }

        fn resolve_dispute(ref self: ContractState, game_id: felt252, epoch: u32) {
            let mut world = self.world_default();
            binding::resolve(ref world, game_id, epoch);
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
        }

        fn resume_channel(
            ref self: ContractState, game_id: felt252, epoch: u32, acks: Span<Signature>,
        ) {
            let mut world = self.world_default();
            binding::resume::<GoRules>(ref world, game_id, epoch, acks);
        }

        fn claim_timeout(ref self: ContractState, game_id: felt252, epoch: u32) {
            let mut world = self.world_default();
            binding::claim_timeout(ref world, game_id, epoch);
        }

        fn resign_channel(ref self: ContractState, game_id: felt252) {
            let mut world = self.world_default();
            binding::resign(ref world, game_id);
        }

        fn allow_prover(ref self: ContractState, class_hash: felt252, allowed: bool) {
            let mut world = self.world_default();
            binding::allow_prover(ref world, class_hash, allowed);
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn world_default(self: @ContractState) -> WorldStorage {
            self.world(@"surround")
        }
    }
}
