use core::testing::get_available_gas;
use starknet::testing::set_contract_address;
use crate::math::{self, ONE, Rating};
use crate::ratings::ISurroundRatingsDispatcherTrait;
use super::test_ratings::{black, channel, game, setup};

#[test]
fn gas_of_an_update() {
    let a = Rating { mu: ONE / 3, phi: ONE / 3, last: 1_700_000_000 };
    let b = Rating { mu: -ONE, phi: ONE / 2, last: 1_699_000_000 };
    let before = get_available_gas();
    let (x, _, _) = math::update(a, b, 2, 1_700_086_400);
    let used = before - get_available_gas();
    println!("math::update, two established players: {used}");
    assert!(x.mu > a.mu);
    let before = get_available_gas();
    let _ = math::update(math::start(3).unwrap(), math::start(2).unwrap(), 0, 1_700_086_400);
    println!("math::update, two new players: {}", before - get_available_gas());
}

#[test]
fn gas_of_rate_game() {
    let ratings = setup();
    let before = get_available_gas();
    ratings.rate_game(game(1, 1)).unwrap();
    println!("rate_game, first game for both: {}", before - get_available_gas());
    let before = get_available_gas();
    ratings.rate_game(game(2, 2)).unwrap();
    println!("rate_game, second game: {}", before - get_available_gas());
    let before = get_available_gas();
    let _ = ratings.rate_game(game(2, 2));
    println!("rate_game, already rated: {}", before - get_available_gas());
    set_contract_address('stranger'.try_into().unwrap());
    let before = get_available_gas();
    let _ = ratings.rate_game(game(3, 2));
    println!("rate_game, unknown channel: {}", before - get_available_gas());
    set_contract_address(channel());
    let before = get_available_gas();
    ratings.player(black());
    println!("player view: {}", before - get_available_gas());
}
