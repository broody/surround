//! Go's rating update: `arbiter_ratings`' engine with `GoRatingRules`, under
//! the names `offchain/sdk/src/rating.mjs` and the vectors use.
use arbiter_ratings::math as engine;
pub use arbiter_ratings::math::{ONE, Rating, div, exp_neg, sigmoid, sqrt};
pub use crate::rules::{
    ANCHOR_PHI, MIN_PHI, MU_MAX, MU_MIN, PHI0, PROVISIONAL_PHI, SETTLED_GAMES, rank_of, rank_tenths,
    shown_tenths,
};
use crate::rules::{GO, GoRatingRules, go_pool};

/// A new player's state for a starting band: 1 (23k), 2 (17k), 3 (1500, about
/// 6k) or 4 (1k). φ = 0 marks it as never rated.
pub fn start(band: u8) -> Option<Rating> {
    engine::start::<GoRatingRules>(GO, band)
}

/// One rated game. `result` is black's (seat 0's) score in half points: 2
/// black won, 1 draw, 0 white won. `t` is the game's time. Returns both new
/// states and P(black wins) before the game (Q).
pub fn update(black: Rating, white: Rating, result: u8, t: u64) -> (Rating, Rating, i128) {
    engine::update::<GoRatingRules>(GO, @go_pool(), black, white, result, t)
}

/// `update` without P(black wins).
pub fn update_states(black: Rating, white: Rating, result: u8, t: u64) -> (Rating, Rating) {
    engine::update_states::<GoRatingRules>(GO, @go_pool(), black, white, result, t)
}

pub fn age(player: Rating, t: u64) -> Rating {
    engine::age::<GoRatingRules>(GO, @go_pool(), player, t)
}

pub fn aged_phi(player: Rating, t: u64) -> i128 {
    engine::aged_phi::<GoRatingRules>(GO, @go_pool(), player, t)
}

pub fn settled(player: Rating, games: u32, t: u64) -> bool {
    engine::settled::<GoRatingRules>(GO, @go_pool(), player, games, t)
}

pub fn provisional(phi: i128, wins: u32, losses: u32) -> bool {
    engine::provisional(@go_pool(), phi, wins, losses)
}
