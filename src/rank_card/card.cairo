use starknet::ContractAddress;

/// Rank cards: a soulbound ERC-721, one per rated player, whose image shows
/// their rank, games, wins and losses. The token ID is the player's address.
/// Nothing is stored but the owner: the card reads the player's rating from
/// `SurroundRatings` each time it is drawn, so it is current as soon as a
/// rated game settles, with no transaction per game.
///
/// A plain Starknet contract, like `SurroundRatings`: it outlives Dojo worlds,
/// and so does the rating it shows.
#[starknet::interface]
pub trait IRankCard<T> {
    /// Mint `player` their card. Anyone may send it, for any player with a
    /// rated game who isn't an AI anchor, once.
    fn mint(ref self: T, player: ContractAddress);
    fn svg(self: @T, token_id: u256) -> ByteArray;
    /// The `SurroundRatings` the cards read.
    fn ratings(self: @T) -> ContractAddress;
    /// Every card is locked to its player (as ERC-5192 says it).
    fn locked(self: @T, token_id: u256) -> bool;
}

#[starknet::contract]
pub mod RankCard {
    use arbiter_ratings::{IRatingsDispatcher, IRatingsDispatcherTrait};
    use core::num::traits::Zero;
    use openzeppelin_interfaces::erc721::{IERC721Metadata, IERC721MetadataCamelOnly};
    use openzeppelin_introspection::src5::SRC5Component;
    use openzeppelin_token::erc721::ERC721Component;
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use surround_ratings::rules::GO;
    use crate::rank_card::render::{self, Card};

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
        ratings: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        ERC721Event: ERC721Component::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    /// Soulbound: a card is only ever minted. Every transfer, by its owner or
    /// anyone they approved, reverts; there is no burn.
    impl SoulboundHooks of ERC721Component::ERC721HooksTrait<ContractState> {
        fn before_update(
            ref self: ERC721Component::ComponentState<ContractState>,
            to: ContractAddress,
            token_id: u256,
            auth: ContractAddress,
        ) {
            assert(self._owner_of(token_id).is_zero(), 'Rank cards are soulbound');
        }
    }

    #[constructor]
    fn constructor(ref self: ContractState, ratings: ContractAddress) {
        assert(ratings.is_non_zero(), 'Zero ratings');
        self.ratings.write(ratings);
        self.erc721.initializer("Surround Rank Card", "RANK", "");
    }

    #[abi(embed_v0)]
    impl RankCardImpl of super::IRankCard<ContractState> {
        fn mint(ref self: ContractState, player: ContractAddress) {
            let rating = self.rating(player);
            assert(!rating.anchor, 'No card for an AI');
            assert(rating.games > 0, 'No rated game yet');
            let token_id: u256 = Into::<felt252, u256>::into(player.into());
            assert(!self.erc721.exists(token_id), 'Card already minted');
            self.erc721.mint(player, token_id);
        }

        fn svg(self: @ContractState, token_id: u256) -> ByteArray {
            render::svg(@self.card(token_id))
        }

        fn ratings(self: @ContractState) -> ContractAddress {
            self.ratings.read()
        }

        fn locked(self: @ContractState, token_id: u256) -> bool {
            assert(self.erc721.exists(token_id), 'Unknown card');
            true
        }
    }

    #[abi(embed_v0)]
    impl MetadataImpl of IERC721Metadata<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            "Surround Rank Card"
        }

        fn symbol(self: @ContractState) -> ByteArray {
            "RANK"
        }

        fn token_uri(self: @ContractState, token_id: u256) -> ByteArray {
            render::token_uri(@self.card(token_id))
        }
    }

    #[abi(embed_v0)]
    impl MetadataCamelImpl of IERC721MetadataCamelOnly<ContractState> {
        fn tokenURI(self: @ContractState, tokenId: u256) -> ByteArray {
            MetadataImpl::token_uri(self, tokenId)
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn rating(self: @ContractState, player: ContractAddress) -> arbiter_ratings::Player {
            IRatingsDispatcher { contract_address: self.ratings.read() }.player(GO, player)
        }

        /// A minted card as the player's rating stands now.
        fn card(self: @ContractState, token_id: u256) -> Card {
            assert(self.erc721.exists(token_id), 'Unknown card');
            let id: felt252 = token_id.try_into().unwrap();
            let player: ContractAddress = id.try_into().unwrap();
            let rating = self.rating(player);
            Card {
                player: id,
                shown: rating.shown,
                provisional: rating.provisional,
                games: rating.games,
                wins: rating.wins,
                losses: rating.losses,
                draws: rating.draws,
            }
        }
    }
}
