use referee::{Envelope, Move};
use surround_rules::go::{GoAction, GoState};
use crate::models::KifuSummary;

/// Kifu: an ERC-721 of settled ranked games (created from a matchmaker's
/// ticket), one per game, owned by its winner. Each token stores only its game's packed record; the
/// summary, image, SGF and metadata are computed from it, the game's `ChannelGame` and
/// its `Settlement` on read. Minting also emits the `KifuSummary` event for
/// Torii to index.
#[starknet::interface]
pub trait IKifu<T> {
    /// Mint a settled ranked game's kifu to its winner; a drawn game has none.
    /// Anyone may call it. `anchor` is the game's settled state and `record`
    /// its steps from the opening and its final position, packed by
    /// `kifu::record::encode` (the SDK's `encodeKifu`). The token ID is the
    /// game ID.
    fn mint(ref self: T, game_id: felt252, anchor: Envelope<GoState>, record: Span<felt252>);
    /// The players, result, board, komi, moves, scores, captures and date.
    fn summary(self: @T, token_id: u256) -> KifuSummary;
    /// Every step of the game, unpacked.
    fn steps(self: @T, token_id: u256) -> Span<Move<GoAction>>;
    fn svg(self: @T, token_id: u256) -> ByteArray;
    fn sgf(self: @T, token_id: u256) -> ByteArray;
}

#[dojo::contract]
pub mod kifu {
    use dojo::event::EventStorage;
    use dojo::model::{Model, ModelStorage};
    use dojo::world::WorldStorage;
    use openzeppelin_interfaces::erc721::{IERC721Metadata, IERC721MetadataCamelOnly};
    use openzeppelin_introspection::src5::SRC5Component;
    use openzeppelin_token::erc721::{ERC721Component, ERC721HooksEmptyImpl};
    use referee::channel::SETTLED;
    use referee::{Envelope, Move, state_hash};
    use referee_dojo::channel as binding;
    use referee_dojo::models::ChannelGame;
    use surround_rules::go::{GoAction, GoConfig, GoRules, GoState};
    use crate::kifu::record::{self, Record};
    use crate::kifu::render::{self, Game};
    use crate::models::{Kifu, KifuSummary, RatedGame, Settlement};

    component!(path: ERC721Component, storage: erc721, event: ERC721Event);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    #[abi(embed_v0)]
    impl ERC721Impl = ERC721Component::ERC721Impl<ContractState>;
    #[abi(embed_v0)]
    impl ERC721CamelOnlyImpl = ERC721Component::ERC721CamelOnlyImpl<ContractState>;
    #[abi(embed_v0)]
    impl SRC5Impl = SRC5Component::SRC5Impl<ContractState>;
    impl ERC721InternalImpl = ERC721Component::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        erc721: ERC721Component::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        ERC721Event: ERC721Component::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    fn dojo_init(ref self: ContractState) {
        self.erc721.initializer("Surround Kifu", "KIFU", "");
    }

    #[abi(embed_v0)]
    impl KifuImpl of super::IKifu<ContractState> {
        fn mint(
            ref self: ContractState,
            game_id: felt252,
            anchor: Envelope<GoState>,
            record: Span<felt252>,
        ) {
            let mut world = self.world_default();
            let game = binding::read(@world, game_id);
            assert(game.status == SETTLED, 'Game not settled');
            // Ranked means created from a matchmaker's ticket, not merely timed.
            let ticket: felt252 = world
                .read_member(Model::<RatedGame>::ptr_from_keys(game_id), selector!("ticket"));
            assert(ticket != 0, 'Not a ranked game');
            let winner = if game.result.winner == 1 {
                game.player_0
            } else {
                assert(game.result.winner == 2, 'No winner');
                game.player_1
            };
            assert(!self.erc721.exists(game_id.into()), 'Kifu already minted');
            // The settled state fixes the step count, the final position and
            // the transcript that commits to every step.
            assert(state_hash::<GoRules>(@anchor) == game.anchor.hash, 'Wrong anchor state');
            let unpacked = record::decode(config(@game).size, anchor.seq, record);
            assert(unpacked.board == anchor.game.board, 'Wrong final position');
            assert(
                record::transcript(game.context, unpacked.steps.span()) == anchor.transcript,
                'Wrong move record',
            );
            world.write_model(@Kifu { game_id, record });
            let settlement: Settlement = world.read_model(game_id);
            world.emit_event(@render::summary(@assemble(@game, settlement.timestamp, unpacked)));
            self.erc721.mint(winner, game_id.into());
        }

        fn summary(self: @ContractState, token_id: u256) -> KifuSummary {
            render::summary(@self.game(token_id))
        }

        fn steps(self: @ContractState, token_id: u256) -> Span<Move<GoAction>> {
            self.game(token_id).record.steps.span()
        }

        fn svg(self: @ContractState, token_id: u256) -> ByteArray {
            let mut game = self.game(token_id);
            render::svg(ref game)
        }

        fn sgf(self: @ContractState, token_id: u256) -> ByteArray {
            let mut game = self.game(token_id);
            render::sgf(ref game)
        }
    }

    #[abi(embed_v0)]
    impl MetadataImpl of IERC721Metadata<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            "Surround Kifu"
        }

        fn symbol(self: @ContractState) -> ByteArray {
            "KIFU"
        }

        fn token_uri(self: @ContractState, token_id: u256) -> ByteArray {
            let mut game = self.game(token_id);
            render::token_uri(ref game)
        }
    }

    #[abi(embed_v0)]
    impl MetadataCamelImpl of IERC721MetadataCamelOnly<ContractState> {
        fn tokenURI(self: @ContractState, tokenId: u256) -> ByteArray {
            MetadataImpl::token_uri(self, tokenId)
        }
    }

    fn config(game: @ChannelGame) -> GoConfig {
        let mut data = *game.config;
        Serde::deserialize(ref data).expect('Invalid stored config')
    }

    fn assemble(game: @ChannelGame, settled_at: u64, record: Record) -> Game {
        let config = config(game);
        Game {
            id: *game.id,
            size: config.size,
            komi_half: config.komi_half,
            black: (*game.player_0).into(),
            white: (*game.player_1).into(),
            winner: *game.result.winner,
            reason: *game.result.reason,
            clock: *game.clock_settings,
            settled_at,
            record,
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn world_default(self: @ContractState) -> WorldStorage {
            self.world(@"surround")
        }

        fn game(self: @ContractState, token_id: u256) -> Game {
            assert(self.erc721.exists(token_id), 'Unknown kifu');
            let id: felt252 = token_id.try_into().unwrap();
            let world = self.world_default();
            let kifu: Kifu = world.read_model(id);
            let game = binding::read(@world, id);
            let settlement: Settlement = world.read_model(id);
            let unpacked = record::decode(config(@game).size, game.anchor.seq, kifu.record);
            assemble(@game, settlement.timestamp, unpacked)
        }
    }
}
