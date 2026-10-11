/// Surround's ratings: `arbiter_ratings`' component with Go's rules. A plain
/// Starknet contract that outlives Dojo worlds; each world's channel is an
/// allowlisted client (RANKING_PLAN.md).
#[starknet::contract]
pub mod SurroundRatings {
    use arbiter_ratings::RatingsComponent;
    use starknet::ContractAddress;
    use crate::rules::GoRatingRules;

    component!(path: RatingsComponent, storage: ratings, event: RatingsEvent);

    #[abi(embed_v0)]
    impl RatingsImpl = RatingsComponent::Ratings<ContractState>;
    impl RatingsInternal = RatingsComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ratings: RatingsComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        RatingsEvent: RatingsComponent::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ratings.initializer(owner);
    }
}
