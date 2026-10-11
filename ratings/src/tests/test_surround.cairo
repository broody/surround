//! `SurroundRatings` is arbiter's ratings component with Go's rules: games rate
//! exactly as `math` (and the SDK) does, ranks show as kyu/dan tenths, and the
//! policy is per the 'go' pool. The component itself is tested in arbiter.
use arbiter::REASON_RESIGN;
use arbiter::clocks::{Standard, encode};
use arbiter_ratings::ratings::{ACCEPTED, CHANNEL_ACTIVE, QUEUE, RATED};
use arbiter_ratings::{GameResult, IRatingsDispatcher, IRatingsDispatcherTrait, Ticket, digest};
use arbiter_testing::{public_key, sign};
use core::poseidon::poseidon_hash_span;
use starknet::syscalls::deploy_syscall;
use starknet::testing::{pop_log_raw, set_block_timestamp, set_contract_address};
use starknet::{ContractAddress, SyscallResultTrait, get_tx_info};
use crate::math::{self, Rating};
use crate::ratings::SurroundRatings;
use crate::rules::{GO, GoRatingRules, go_pool, rank_tenths};

pub const PK_MATCHMAKER: felt252 = 0x3a7c4;
pub const PK_REFEREE: felt252 = 0x7e7e7e;
pub const T0: u64 = 1_700_000_000;
/// 19×19 at 6.5 komi, as the channel hashes `GoConfig` (`arbiter::config_hash`).
pub const CONFIG_19: felt252 = 'go 19x19 6.5';

pub fn owner() -> ContractAddress {
    'owner'.try_into().unwrap()
}

pub fn channel() -> ContractAddress {
    'channel'.try_into().unwrap()
}

fn prover() -> ContractAddress {
    'prover'.try_into().unwrap()
}

pub fn black() -> ContractAddress {
    'black'.try_into().unwrap()
}

pub fn white() -> ContractAddress {
    'white'.try_into().unwrap()
}

fn settings() -> Span<felt252> {
    encode(@Standard { turn_ms: 60000, bank_ms: 0, increment_ms: 0, byoyomi: Option::None })
}

pub fn deploy() -> IRatingsDispatcher {
    let (address, _) = deploy_syscall(
        SurroundRatings::TEST_CLASS_HASH, 0, array![owner().into()].span(), false,
    )
        .unwrap_syscall();
    IRatingsDispatcher { contract_address: address }
}

/// A contract in its setup phase whose policy accepts `ticket_for`'s tickets
/// from `channel()`, with Go's four starting bands allowed.
pub fn setup() -> IRatingsDispatcher {
    let ratings = deploy();
    set_block_timestamp(T0);
    set_contract_address(owner());
    ratings.set_channel(channel(), CHANNEL_ACTIVE);
    ratings.set_matchmaker(public_key(PK_MATCHMAKER));
    ratings.set_referee(public_key(PK_REFEREE));
    ratings.set_clock_preset(GO, settings(), true);
    ratings.set_prover(prover(), true);
    ratings.set_config(GO, CONFIG_19, true);
    ratings.set_response_window(300, 900);
    ratings.set_start_bands(GO, 0b11110);
    set_contract_address(channel());
    ratings
}

/// A ticket for game `id` issued at `t`, black the first seat.
pub fn ticket_for(
    id: felt252, t: u64, black: ContractAddress, white: ContractAddress, source: u8,
) -> Ticket {
    Ticket {
        chain_id: get_tx_info().unbox().chain_id,
        channel: channel(),
        player_0: black,
        player_1: white,
        pool: GO,
        config: CONFIG_19,
        referee: public_key(PK_REFEREE),
        clock: poseidon_hash_span(settings()),
        prover: prover(),
        response_seconds: 600,
        source,
        band_0: 3,
        band_1: 2,
        matchmaker: public_key(PK_MATCHMAKER),
        issued_at: t - 30,
        expires_at: t + 270,
        nonce: id,
    }
}

pub fn ticket_digest(ratings: IRatingsDispatcher, ticket: @Ticket) -> felt252 {
    digest::<GoRatingRules>(ticket, ratings.contract_address)
}

/// Accept `ticket` for game `id` as `channel()`, at its issue time.
pub fn accept(ratings: IRatingsDispatcher, ticket: Ticket, id: felt252) -> Ticket {
    set_block_timestamp(ticket.issued_at + 30);
    set_contract_address(channel());
    ratings.check_ticket(ticket, sign(ticket_digest(ratings, @ticket), PK_MATCHMAKER), id);
    ticket
}

/// The result of game `id` played at `t` and settled 10 minutes later, which
/// is when the channel reports it.
pub fn result(id: felt252, t: u64, winner: u8) -> GameResult {
    set_block_timestamp(t + 600);
    GameResult {
        game_id: id,
        winner,
        reason: 1,
        played_at: t,
        settled_at: t + 600,
        steps: 60,
        onchain_forfeit: false,
    }
}

/// Game `id` between black and white, an hour after the last: accepted, then
/// reported with `winner`.
pub fn play(ratings: IRatingsDispatcher, id: felt252, winner: u8) -> (Ticket, GameResult) {
    let t = T0 + id.try_into().unwrap() * 3600;
    let ticket = accept(ratings, ticket_for(id, t, black(), white(), QUEUE), id);
    (ticket, result(id, t, winner))
}

fn rating(ratings: IRatingsDispatcher, player: ContractAddress) -> Rating {
    let p = ratings.player(GO, player);
    Rating { mu: p.mu.into(), phi: p.phi.into(), last: p.last_played }
}

#[test]
fn rates_a_game_like_the_math() {
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    let digest = ticket_digest(ratings, @ticket);
    assert_eq!(ratings.ticket_status(digest), (ACCEPTED, 1));
    let (b, w) = ratings.rate_game(ticket, game).unwrap();
    let (eb, ew) = math::update_states(
        math::start(3).unwrap(), math::start(2).unwrap(), 2, game.played_at,
    );
    assert_eq!(rating(ratings, black()), eb);
    assert_eq!(rating(ratings, white()), ew);
    assert_eq!((b.games, b.wins, b.losses, b.band, b.params), (1, 1, 0, 3, 2));
    assert_eq!((w.games, w.wins, w.losses, w.band), (1, 0, 1, 2));
    assert!(b.provisional && w.provisional);
    assert_eq!(ratings.ticket_status(digest), (RATED, 1));

    // A second game starts from the stored ratings, not the bands.
    let (mut ticket, game) = play(ratings, 2, 2);
    ticket.band_0 = 1;
    let ticket = accept(ratings, ticket, 2);
    set_block_timestamp(game.settled_at);
    ratings.rate_game(ticket, game).unwrap();
    let (eb2, ew2) = math::update_states(eb, ew, 0, game.played_at);
    assert_eq!(rating(ratings, black()), eb2);
    assert_eq!(rating(ratings, white()), ew2);
    assert_eq!(ratings.player(GO, black()).band, 3);
}

#[test]
fn ranks_show_as_kyu_dan_tenths() {
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    let (b, _) = ratings.rate_game(ticket, game).unwrap();
    assert_eq!(b.shown, rank_tenths(b.mu.into()));
    set_contract_address(owner());
    ratings.set_rank_offset(GO, 15);
    assert_eq!(ratings.player(GO, black()).shown, math::shown_tenths(b.mu.into(), 15));
    let ranks = ratings.ranks(GO, array![black(), 'nobody'.try_into().unwrap()].span());
    assert_eq!(ranks, array![(math::shown_tenths(b.mu.into(), 15), true, true), (0, true, false)]);
}

#[test]
fn surround_has_one_pool_under_its_own_tag() {
    let ratings = deploy();
    assert_eq!(ratings.rules(), ('SURROUND', 2, false));
    assert_eq!(ratings.pool(GO), Option::Some(go_pool()));
    assert!(ratings.pool('blitz').is_none());
    assert!(arbiter_ratings::valid_pool(@go_pool()));
}

#[test]
fn the_offset_spans_the_rank_scale() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.set_rank_offset(GO, -390);
    ratings.set_rank_offset(GO, 390);
    assert_eq!(ratings.rank_offset(GO), 390);
}

#[test]
#[should_panic(expected: ('Invalid offset', 'ENTRYPOINT_FAILED'))]
fn the_offset_stays_within_the_rank_scale() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.set_rank_offset(GO, 391);
}

#[test]
#[should_panic(expected: ('Invalid bands', 'ENTRYPOINT_FAILED'))]
fn go_has_four_bands() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.set_start_bands(GO, 0b100000);
}

#[test]
#[should_panic(expected: ('Band not allowed', 'ENTRYPOINT_FAILED'))]
fn no_band_is_allowed_until_the_owner_sets_them() {
    let ratings = deploy();
    set_block_timestamp(T0);
    set_contract_address(owner());
    ratings.set_channel(channel(), CHANNEL_ACTIVE);
    ratings.set_matchmaker(public_key(PK_MATCHMAKER));
    ratings.set_referee(public_key(PK_REFEREE));
    ratings.set_clock_preset(GO, settings(), true);
    ratings.set_prover(prover(), true);
    ratings.set_config(GO, CONFIG_19, true);
    ratings.set_response_window(300, 900);
    accept(ratings, ticket_for(1, T0, black(), white(), QUEUE), 1);
}

/// `n` games at a queue between two fresh players, alternating results, so
/// both end settled. Returns the next game id.
fn settle_both(
    ratings: IRatingsDispatcher, a: ContractAddress, b: ContractAddress, n: u32,
) -> felt252 {
    let mut id: felt252 = 1;
    for i in 0..n {
        let t = T0 + i.into() * 3600;
        let ticket = accept(ratings, ticket_for(id, t, a, b, QUEUE), id);
        let _ = ratings.rate_game(ticket, result(id, t, if i % 2 == 0 {
            1
        } else {
            2
        }));
        id += 1;
    }
    id
}

/// A mixed season whose raw events `offchain/ratings/audit/replay-check.mjs`
/// replays with the SDK's `replay.mjs`: settled players, a newcomer, a short
/// onchain forfeit, a void, a draw, a long idle spell and an anchor on either
/// side.
#[test]
fn events_for_replay() {
    let ratings = setup();
    let next = settle_both(ratings, black(), white(), 14);
    let newcomer: ContractAddress = 'newcomer'.try_into().unwrap();
    let ai: ContractAddress = 'ai'.try_into().unwrap();
    set_contract_address(owner());
    ratings.set_anchor(GO, ai, 1132924713);
    let mut t = T0 + 20 * 3600;
    let mut id = next;
    for (a, b, winner, steps, forfeit) in array![
        (black(), newcomer, 1_u8, 60_u32, false), (newcomer, white(), 2, 3, true),
        (white(), black(), 0, 80, false), (black(), white(), 1, 5, false),
        (newcomer, black(), 1, 40, false), (ai, black(), 2, 60, false),
        (newcomer, ai, 2, 50, false),
    ] {
        let mut ticket = ticket_for(id, t, a, b, QUEUE);
        if a == ai {
            ticket.band_0 = 0;
        }
        if b == ai {
            ticket.band_1 = 0;
        }
        let ticket = accept(ratings, ticket, id);
        let _ = ratings
            .rate_game(
                ticket,
                GameResult {
                    reason: if forfeit {
                        REASON_RESIGN
                    } else {
                        1
                    },
                    steps,
                    onchain_forfeit: forfeit,
                    ..result(id, t, winner),
                },
            );
        id += 1;
        t += 400 * 86400;
    }
    loop {
        match pop_log_raw(ratings.contract_address) {
            Option::Some((
                keys, data,
            )) => {
                print!("EVENT");
                for k in keys {
                    print!(" {}", *k);
                }
                print!(" |");
                for d in data {
                    print!(" {}", *d);
                }
                println!("");
            },
            Option::None => { break; },
        }
    }
}

/// The digest of a fixed ticket for a fixed ratings contract, which
/// `offchain/sdk/test/client.test.mjs` checks the SDK's `ticketDigest` against.
pub const SDK_DIGEST: felt252 = 0x3d97a6e778b53eebc522a2bfbd0b2a1d767e9c75a24a12befc1c18279120a14;

#[test]
fn digest_matches_the_sdk() {
    let ticket = Ticket {
        chain_id: 'SN_SEPOLIA',
        channel: 0x111.try_into().unwrap(),
        player_0: 0x222.try_into().unwrap(),
        player_1: 0x333.try_into().unwrap(),
        pool: GO,
        config: 0xc0f1925,
        referee: 0x444,
        // The ranked clock: 60 s a turn, nothing carried over.
        clock: poseidon_hash_span(settings()),
        prover: 0x555.try_into().unwrap(),
        response_seconds: 600,
        source: QUEUE,
        band_0: 3,
        band_1: 2,
        matchmaker: 0x666,
        issued_at: T0 - 30,
        expires_at: T0 + 270,
        nonce: 7,
    };
    assert_eq!(digest::<GoRatingRules>(@ticket, 0x7a71e5.try_into().unwrap()), SDK_DIGEST);
}
