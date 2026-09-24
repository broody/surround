use starknet::ContractAddress;
use crate::channel_models::ChannelGame;
use crate::channel_protocol::{Action, ChannelState, Signature, SignedAction, Terms};

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
    fn get_snapshot(self: @T, game_id: felt252) -> (Terms, u32, ChannelState, u64);
    fn accept_verified(
        ref self: T,
        game_id: felt252,
        epoch: u32,
        start_hash: felt252,
        end: ChannelState,
        black_ack: Signature,
        white_ack: Signature,
    );
    fn submit_history(
        ref self: T,
        game_id: felt252,
        epoch: u32,
        history: Span<felt252>,
        actions: Span<SignedAction>,
        black_ack: Signature,
        white_ack: Signature,
    );
    fn open_dispute(ref self: T, game_id: felt252, epoch: u32);
    fn resolve_dispute(ref self: T, game_id: felt252, epoch: u32);
    fn force_action(
        ref self: T, game_id: felt252, epoch: u32, history: Span<felt252>, action: Action,
    );
    fn resume_channel(
        ref self: T, game_id: felt252, epoch: u32, black_ack: Signature, white_ack: Signature,
    );
    fn claim_timeout(ref self: T, game_id: felt252, epoch: u32);
    fn resign_channel(ref self: T, game_id: felt252);
}

#[dojo::contract]
pub mod channel {
    use core::ec::EcPointTrait;
    use core::num::traits::Zero;
    use dojo::event::EventStorage;
    use dojo::model::ModelStorage;
    use dojo::world::{IWorldDispatcherTrait, WorldStorage};
    use starknet::syscalls::get_class_hash_at_syscall;
    use starknet::{
        ContractAddress, SyscallResultTrait, get_block_number, get_block_timestamp,
        get_caller_address, get_contract_address, get_tx_info,
    };
    use crate::channel_models::{
        ACTIVE, CANCELLED, ChannelGame, ChannelUpdated, DISPUTE, FORCED, SETTLED, WAITING,
    };
    use crate::channel_protocol::{
        self as protocol, Action, ChannelState, Signature, SignedAction, Terms,
    };
    use crate::channel_prover_pin::prover_class;
    use crate::rules;

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
            rules::validate_size(size);
            assert(komi_half <= rules::point_count(size) * 2, 'Komi out of bounds');
            assert(
                response_seconds >= 300 && response_seconds <= 604800, 'Invalid response window',
            );
            valid_key(session_key);
            valid_prover(prover);
            let black = get_caller_address();
            assert(black.is_non_zero() && invited_white != black, 'Invalid players');
            let mut world = self.world(@"surround");
            let id: felt252 = world.dispatcher.uuid().into();
            let anchor = protocol::initial_state(size);
            let game = ChannelGame {
                id,
                black,
                white: invited_white,
                black_key: session_key,
                white_key: 0,
                prover,
                size,
                komi_half,
                response_seconds,
                status: WAITING,
                epoch: 0,
                context: 0,
                anchor_block: 0,
                deadline: 0,
                anchor,
                candidate: anchor,
            };
            save(ref world, game, 0);
            id
        }

        fn join_channel(ref self: ContractState, game_id: felt252, session_key: felt252) {
            let mut world = self.world(@"surround");
            let mut game = read(@world, game_id);
            assert(game.status == WAITING, 'Not waiting');
            let white = get_caller_address();
            assert(white.is_non_zero() && white != game.black, 'Invalid players');
            assert(game.white.is_zero() || game.white == white, 'Not invited');
            valid_key(session_key);
            assert(session_key != game.black_key, 'Shared session key');
            valid_prover(game.prover);
            game.white = white;
            game.white_key = session_key;
            game.context = protocol::context_hash(terms(game));
            game.anchor_block = get_block_number();
            game.status = ACTIVE;
            save(ref world, game, 1);
        }

        fn cancel_channel(ref self: ContractState, game_id: felt252) {
            let mut world = self.world(@"surround");
            let mut game = read(@world, game_id);
            assert(game.status == WAITING, 'Not waiting');
            assert(get_caller_address() == game.black, 'Only creator');
            game.status = CANCELLED;
            save(ref world, game, 2);
        }

        fn get_channel(self: @ContractState, game_id: felt252) -> ChannelGame {
            read(@self.world(@"surround"), game_id)
        }

        fn get_snapshot(self: @ContractState, game_id: felt252) -> (Terms, u32, ChannelState, u64) {
            let game = read(@self.world(@"surround"), game_id);
            assert(
                game.status == ACTIVE || game.status == DISPUTE || game.status == FORCED,
                'Channel not live',
            );
            (terms(game), game.epoch, game.anchor, game.anchor_block)
        }

        fn accept_verified(
            ref self: ContractState,
            game_id: felt252,
            epoch: u32,
            start_hash: felt252,
            end: ChannelState,
            black_ack: Signature,
            white_ack: Signature,
        ) {
            let mut world = self.world(@"surround");
            let game = read(@world, game_id);
            assert(get_caller_address() == game.prover, 'Only pinned prover');
            valid_prover(game.prover);
            assert(start_hash == protocol::state_hash(game.anchor), 'Wrong proof anchor');
            receive(ref world, game, epoch, end, black_ack, white_ack);
        }

        fn submit_history(
            ref self: ContractState,
            game_id: felt252,
            epoch: u32,
            history: Span<felt252>,
            actions: Span<SignedAction>,
            black_ack: Signature,
            white_ack: Signature,
        ) {
            let mut world = self.world(@"surround");
            let game = read(@world, game_id);
            open_epoch(game, epoch);
            let end = protocol::replay(terms(game), game.anchor, history, actions);
            receive(ref world, game, epoch, end, black_ack, white_ack);
        }

        fn open_dispute(ref self: ContractState, game_id: felt252, epoch: u32) {
            let mut world = self.world(@"surround");
            let mut game = read(@world, game_id);
            assert(game.status == ACTIVE, 'Not active');
            assert(game.epoch == epoch, 'Stale channel epoch');
            player(game, get_caller_address());
            game.status = DISPUTE;
            game.deadline = get_block_timestamp() + game.response_seconds.into();
            game.candidate = game.anchor;
            save(ref world, game, 3);
        }

        fn resolve_dispute(ref self: ContractState, game_id: felt252, epoch: u32) {
            let mut world = self.world(@"surround");
            let mut game = read(@world, game_id);
            assert(game.status == DISPUTE, 'No dispute');
            assert(game.epoch == epoch, 'Stale channel epoch');
            assert(get_block_timestamp() >= game.deadline, 'Dispute window open');
            game.anchor = game.candidate;
            game.epoch += 1;
            game.anchor_block = get_block_number();
            if game.anchor.phase == protocol::FINISHED {
                game.status = SETTLED;
                game.deadline = 0;
            } else {
                game.status = FORCED;
                game.deadline = get_block_timestamp() + game.response_seconds.into();
            }
            save(ref world, game, 5);
        }

        fn force_action(
            ref self: ContractState,
            game_id: felt252,
            epoch: u32,
            history: Span<felt252>,
            action: Action,
        ) {
            let mut world = self.world(@"surround");
            let mut game = read(@world, game_id);
            forced_epoch(game, epoch);
            assert(action.actor == player(game, get_caller_address()), 'Wrong action actor');
            game.anchor = protocol::force(terms(game), game.anchor, history, action);
            game.candidate = game.anchor;
            game.epoch += 1;
            game.anchor_block = get_block_number();
            if game.anchor.phase == protocol::FINISHED {
                game.status = SETTLED;
                game.deadline = 0;
            } else {
                game.deadline = get_block_timestamp() + game.response_seconds.into();
            }
            save(ref world, game, 6);
        }

        fn resume_channel(
            ref self: ContractState,
            game_id: felt252,
            epoch: u32,
            black_ack: Signature,
            white_ack: Signature,
        ) {
            let mut world = self.world(@"surround");
            let mut game = read(@world, game_id);
            forced_epoch(game, epoch);
            assert(
                protocol::both_approve(
                    terms(game),
                    protocol::reopen_hash(game.context, epoch, game.anchor),
                    black_ack,
                    white_ack,
                ),
                'Need both approvals',
            );
            game.status = ACTIVE;
            game.deadline = 0;
            game.epoch += 1;
            game.anchor_block = get_block_number();
            save(ref world, game, 7);
        }

        fn claim_timeout(ref self: ContractState, game_id: felt252, epoch: u32) {
            let mut world = self.world(@"surround");
            let mut game = read(@world, game_id);
            assert(game.status == FORCED, 'Not in forced play');
            assert(game.epoch == epoch, 'Stale channel epoch');
            assert(get_block_timestamp() >= game.deadline, 'Turn window open');
            let winner = player(game, get_caller_address());
            assert(winner == rules::other(game.anchor.next_player), 'Only waiting player');
            game.anchor.phase = protocol::FINISHED;
            game.anchor.winner = winner;
            game.anchor.finish_reason = protocol::TIMEOUT;
            game.candidate = game.anchor;
            game.status = SETTLED;
            game.epoch += 1;
            game.deadline = 0;
            save(ref world, game, 8);
        }

        fn resign_channel(ref self: ContractState, game_id: felt252) {
            let mut world = self.world(@"surround");
            let mut game = read(@world, game_id);
            assert(
                game.status == ACTIVE || game.status == DISPUTE || game.status == FORCED,
                'Channel not live',
            );
            let actor = player(game, get_caller_address());
            // A wallet may unconditionally concede the match without a prover.
            game.anchor.phase = protocol::FINISHED;
            game.anchor.winner = rules::other(actor);
            game.anchor.finish_reason = protocol::RESIGNATION;
            game.candidate = game.anchor;
            game.status = SETTLED;
            game.epoch += 1;
            game.deadline = 0;
            save(ref world, game, 9);
        }
    }

    fn valid_key(key: felt252) {
        assert(key != 0 && EcPointTrait::new_nz_from_x(key).is_some(), 'Invalid session key');
    }

    fn valid_prover(address: ContractAddress) {
        assert(address.is_non_zero(), 'Zero prover');
        let class_hash = get_class_hash_at_syscall(address).unwrap_syscall();
        assert(class_hash == prover_class(), 'Untrusted prover class');
    }

    fn player(game: ChannelGame, address: ContractAddress) -> u8 {
        if address == game.black {
            rules::BLACK
        } else {
            assert(address == game.white, 'Not a player');
            rules::WHITE
        }
    }

    fn terms(game: ChannelGame) -> Terms {
        Terms {
            chain_id: get_tx_info().chain_id,
            channel: get_contract_address().into(),
            game_id: game.id,
            black: game.black.into(),
            white: game.white.into(),
            black_key: game.black_key,
            white_key: game.white_key,
            prover: game.prover.into(),
            size: game.size,
            komi_half: game.komi_half,
            response_seconds: game.response_seconds,
        }
    }

    fn read(world: @WorldStorage, game_id: felt252) -> ChannelGame {
        let game: ChannelGame = world.read_model(game_id);
        assert(game.black.is_non_zero(), 'Unknown channel');
        game
    }

    fn open_epoch(game: ChannelGame, epoch: u32) {
        assert(game.status == ACTIVE || game.status == DISPUTE, 'Channel not offchain');
        assert(game.epoch == epoch, 'Stale channel epoch');
        if game.status == DISPUTE {
            assert(get_block_timestamp() < game.deadline, 'Dispute window closed');
        }
    }

    fn forced_epoch(game: ChannelGame, epoch: u32) {
        assert(game.status == FORCED, 'Not in forced play');
        assert(game.epoch == epoch, 'Stale channel epoch');
        assert(get_block_timestamp() < game.deadline, 'Turn deadline passed');
    }

    fn receive(
        ref world: WorldStorage,
        mut game: ChannelGame,
        epoch: u32,
        end: ChannelState,
        black_ack: Signature,
        white_ack: Signature,
    ) {
        open_epoch(game, epoch);
        assert(end.sequence > game.anchor.sequence, 'No channel progress');
        let approved = protocol::both_approve(
            terms(game), protocol::checkpoint_hash(game.context, epoch, end), black_ack, white_ack,
        );
        if approved {
            assert(end.support_turn >= game.candidate.support_turn, 'Older than candidate');
            game.anchor = end;
            game.candidate = end;
            game.epoch += 1;
            game.anchor_block = get_block_number();
            game.status = if end.phase == protocol::FINISHED {
                SETTLED
            } else {
                ACTIVE
            };
            game.deadline = 0;
        } else {
            assert(
                end.support_turn > game.candidate.support_turn
                    || (end.support_turn == game.candidate.support_turn
                        && end.sequence > game.candidate.sequence),
                'Not a newer candidate',
            );
            if game.status == ACTIVE {
                game.status = DISPUTE;
                game.deadline = get_block_timestamp() + game.response_seconds.into();
            }
            game.candidate = end;
            // Preserve the anchor, epoch and original challenge deadline.
        }
        save(ref world, game, 4);
    }

    fn save(ref world: WorldStorage, game: ChannelGame, kind: u8) {
        world.write_model(@game);
        let state = if game.status == DISPUTE {
            game.candidate
        } else {
            game.anchor
        };
        world
            .emit_event(
                @ChannelUpdated {
                    game_id: game.id,
                    kind,
                    epoch: game.epoch,
                    sequence: state.sequence,
                    status: game.status,
                    deadline: game.deadline,
                    state_hash: protocol::state_hash(state),
                    winner: state.winner,
                },
            );
    }
}
