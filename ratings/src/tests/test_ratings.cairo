use starknet::syscalls::deploy_syscall;
use starknet::testing::set_contract_address;
use starknet::{ContractAddress, SyscallResultTrait};
use crate::math::{self, Rating};
use crate::ratings::{
    GameResult, ISurroundRatingsDispatcher, ISurroundRatingsDispatcherTrait, NONE, QUEUE, RATED,
    SurroundRatings, TABLE, VOID,
};

const MATCHMAKER: felt252 = 0x3a7c4;
const REFEREE: felt252 = 0x7e7e7e;
const T0: u64 = 1_700_000_000;

pub fn owner() -> ContractAddress {
    'owner'.try_into().unwrap()
}

pub fn channel() -> ContractAddress {
    'channel'.try_into().unwrap()
}

pub fn black() -> ContractAddress {
    'black'.try_into().unwrap()
}

pub fn white() -> ContractAddress {
    'white'.try_into().unwrap()
}

/// A deployed contract that accepts `channel()`, `MATCHMAKER` and `REFEREE`.
pub fn setup() -> ISurroundRatingsDispatcher {
    let (address, _) = deploy_syscall(
        SurroundRatings::TEST_CLASS_HASH, 0, array![owner().into()].span(), false,
    )
        .unwrap_syscall();
    let ratings = ISurroundRatingsDispatcher { contract_address: address };
    set_contract_address(owner());
    ratings.set_channel(channel(), true);
    ratings.set_matchmaker(MATCHMAKER, true);
    ratings.set_referee(REFEREE, true);
    set_contract_address(channel());
    ratings
}

pub fn game(game_id: felt252, winner: u8) -> GameResult {
    GameResult {
        game_id,
        black: black(),
        white: white(),
        winner,
        reason: 1,
        size: 19,
        source: QUEUE,
        played_at: T0 + game_id.try_into().unwrap() * 3600,
        black_band: 3,
        white_band: 2,
        matchmaker: MATCHMAKER,
        referee: REFEREE,
    }
}

fn rating(ratings: ISurroundRatingsDispatcher, player: ContractAddress) -> Rating {
    let p = ratings.player(player);
    Rating { mu: p.mu.into(), phi: p.phi.into(), last: p.last_played }
}

#[test]
fn rates_a_game_like_the_math() {
    let ratings = setup();
    let (b, w) = ratings.rate_game(game(1, 1)).unwrap();
    let (eb, ew, _) = math::update(math::start(3).unwrap(), math::start(2).unwrap(), 2, T0 + 3600);
    assert_eq!(rating(ratings, black()), eb);
    assert_eq!(rating(ratings, white()), ew);
    assert_eq!((b.games, b.wins, b.losses, b.band), (1, 1, 0, 3));
    assert_eq!((w.games, w.wins, w.losses, w.band), (1, 0, 1, 2));
    assert!(b.provisional && w.provisional);
    assert_eq!(ratings.game_status(channel(), 1), RATED);

    // A second game starts from the stored ratings, not the bands.
    let mut second = game(2, 2);
    second.black_band = 1;
    ratings.rate_game(second).unwrap();
    let (eb2, ew2, _) = math::update(eb, ew, 0, T0 + 7200);
    assert_eq!(rating(ratings, black()), eb2);
    assert_eq!(rating(ratings, white()), ew2);
    assert_eq!(ratings.player(black()).band, 3);
}

#[test]
fn rates_each_game_once() {
    let ratings = setup();
    assert!(ratings.rate_game(game(1, 1)).is_some());
    let before = ratings.player(black());
    assert!(ratings.rate_game(game(1, 2)).is_none());
    assert_eq!(ratings.player(black()), before);
}

#[test]
fn ignores_unknown_channels() {
    let ratings = setup();
    set_contract_address('stranger'.try_into().unwrap());
    assert!(ratings.rate_game(game(1, 1)).is_none());
    assert_eq!(ratings.game_status('stranger'.try_into().unwrap(), 1), NONE);
    assert_eq!(ratings.player(black()).games, 0);
}

#[test]
fn voids_revoked_keys_and_invalid_games() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.set_matchmaker(MATCHMAKER, false);
    ratings.set_referee(REFEREE, false);
    set_contract_address(channel());
    assert!(ratings.rate_game(game(1, 1)).is_none());
    assert_eq!(ratings.game_status(channel(), 1), VOID);

    set_contract_address(owner());
    ratings.set_matchmaker(MATCHMAKER, true);
    set_contract_address(channel());
    // A revoked referee voids only timeouts: the players signed every other result.
    let mut timeout = game(2, 1);
    timeout.reason = 129;
    assert!(ratings.rate_game(timeout).is_none());
    assert_eq!(ratings.game_status(channel(), 2), VOID);
    assert!(ratings.rate_game(game(3, 1)).is_some());

    let mut invalid = game(4, 1);
    invalid.black_band = 0;
    assert!(ratings.rate_game(invalid).is_none());
    let mut same = game(5, 1);
    same.white = black();
    assert!(ratings.rate_game(same).is_none());
    let mut size = game(6, 1);
    size.size = 11;
    assert!(ratings.rate_game(size).is_none());
    assert_eq!(ratings.game_status(channel(), 6), VOID);
    assert_eq!(ratings.player(black()).games, 1);
}

#[test]
fn draws_count_as_draws() {
    let ratings = setup();
    let (b, w) = ratings.rate_game(game(1, 0)).unwrap();
    assert_eq!((b.draws, w.draws, b.wins, w.losses), (1, 1, 0, 0));
    // The weaker player (17k band) gains from a draw with the stronger one.
    assert!(w.mu.into() > math::start(2).unwrap().mu);
}

#[test]
fn rank_settles_and_peak_counts_queue_games_only() {
    let ratings = setup();
    // Alternating results; the last three games are at a table.
    let mut b = math::start(3).unwrap();
    let mut w = math::start(2).unwrap();
    let (mut wins, mut losses) = (0_u32, 0_u32);
    let mut established = false;
    let mut peak: Option<i128> = Option::None;
    for i in 1..16_u32 {
        let mut g = game(i.into(), if i % 2 == 1 {
            1
        } else {
            2
        });
        g.source = if i > 12 {
            TABLE
        } else {
            QUEUE
        };
        ratings.rate_game(g).unwrap();
        let (nb, nw, _) = math::update(b, w, if i % 2 == 1 {
            2
        } else {
            0
        }, g.played_at);
        b = nb;
        w = nw;
        if i % 2 == 1 {
            wins += 1;
        } else {
            losses += 1;
        }
        established = established || !math::provisional(b.phi, wins, losses);
        if established && g.source == QUEUE {
            let low = b.mu - 2 * b.phi;
            peak = match peak {
                Option::Some(p) => Option::Some(if low > p {
                    low
                } else {
                    p
                }),
                Option::None => Option::Some(low),
            };
        }
    }
    let player = ratings.player(black());
    assert!(!player.provisional && player.established);
    assert_eq!((player.games, player.wins, player.losses), (15, 8, 7));
    assert_eq!(rating(ratings, black()), b);
    assert!(player.has_peak);
    assert_eq!(player.peak.into(), peak.unwrap());
    let ranks = ratings.ranks(array![black(), white(), 'nobody'.try_into().unwrap()].span());
    assert_eq!(*ranks[0], (player.rank_tenths, false, true));
    assert_eq!(*ranks[2], (0, true, false));
}

#[test]
fn a_late_game_never_moves_the_clock_back() {
    let ratings = setup();
    ratings.rate_game(game(5, 1)).unwrap();
    ratings.rate_game(game(2, 2)).unwrap();
    assert_eq!(ratings.player(black()).last_played, T0 + 5 * 3600);
}

#[test]
#[should_panic]
fn only_the_owner_administers() {
    let ratings = setup();
    ratings.set_channel(channel(), false);
}

#[test]
fn ownership_transfers() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.transfer_ownership(channel());
    assert_eq!(ratings.owner(), channel());
    set_contract_address(channel());
    ratings.set_referee(REFEREE, false);
    assert!(!ratings.is_referee(REFEREE));
}
