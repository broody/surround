//! Rated games: black creates one from a matchmaker-signed ticket, which the
//! world's `SurroundRatings` checks once; white must join before it expires,
//! and the join time is recorded for rating.
use referee::Signature;
use referee::channel::{ACTIVE, WAITING};
use referee_testing::{public_key, sign};
use starknet::syscalls::deploy_syscall;
use starknet::testing::set_block_timestamp;
use starknet::{ContractAddress, SyscallResultTrait, get_contract_address, get_tx_info};
use surround_ratings::ratings::{
    ISurroundRatingsDispatcher, ISurroundRatingsDispatcherTrait, QUEUE, SurroundRatings,
};
use surround_ratings::ticket::{Ticket, digest};
use crate::systems::channel::{IChannelDispatcher, IChannelDispatcherTrait, channel};
use super::test_channel::{WINDOW, black, caller, channel_in, deploy, ranked, white};

const PK_MATCHMAKER: felt252 = 0x3a7c4;
const PK_BLACK: felt252 = 0x1a2b3c;
const PK_WHITE: felt252 = 0x4d5e6f;
const NOW: u64 = 1_700_000_000;

fn ratings_owner() -> ContractAddress {
    'RATINGS_OWNER'.try_into().unwrap()
}

/// A world whose channel reports to a `SurroundRatings` that accepts
/// `ticket(api)`, at `NOW`, with the caller left as the namespace owner.
fn setup() -> (IChannelDispatcher, ISurroundRatingsDispatcher) {
    let admin = get_contract_address();
    let api = channel_in(deploy());
    // The channel stands in for the prover, as in the channel tests.
    api.allow_prover(channel::TEST_CLASS_HASH.try_into().unwrap(), true);
    let (address, _) = deploy_syscall(
        SurroundRatings::TEST_CLASS_HASH, 0, array![ratings_owner().into()].span(), false,
    )
        .unwrap_syscall();
    let ratings = ISurroundRatingsDispatcher { contract_address: address };
    let clock = ranked().unwrap();
    caller(ratings_owner());
    ratings.set_channel(api.contract_address, true);
    ratings.set_matchmaker(public_key(PK_MATCHMAKER), true);
    ratings.set_referee(clock.referee, true);
    ratings.set_clock_preset(clock.settings, true);
    ratings.set_prover(api.contract_address, true);
    ratings.set_board(19, 15, true);
    ratings.set_response_window(300, WINDOW);
    caller(admin);
    api.set_ratings(address);
    set_block_timestamp(NOW);
    (api, ratings)
}

fn ticket(api: IChannelDispatcher) -> Ticket {
    Ticket {
        chain_id: get_tx_info().unbox().chain_id,
        channel: api.contract_address,
        black: black(),
        white: white(),
        size: 19,
        komi_half: 15,
        clock: ranked().unwrap(),
        prover: api.contract_address,
        response_seconds: WINDOW,
        source: QUEUE,
        black_band: 3,
        white_band: 2,
        matchmaker: public_key(PK_MATCHMAKER),
        issued_at: NOW - 30,
        expires_at: NOW + 270,
        nonce: 1,
    }
}

fn signed(ticket: Ticket) -> Signature {
    sign(digest(@ticket), PK_MATCHMAKER)
}

/// Black creates the rated game.
fn create(api: IChannelDispatcher, ticket: Ticket) -> felt252 {
    caller(black());
    api.create_rated_channel(ticket, signed(ticket), public_key(PK_BLACK))
}

#[test]
fn creates_and_joins_a_rated_game() {
    let (api, ratings) = setup();
    let t = ticket(api);
    let id = create(api, t);
    let game = api.get_channel(id);
    assert_eq!((game.player_0, game.player_1, game.status), (black(), white(), WAITING));
    assert_eq!(game.referee, t.clock.referee);
    assert_eq!(game.clock_settings, t.clock.settings);
    assert_eq!(game.prover, api.contract_address);
    let terms = api.terms(id);
    assert_eq!((terms.config.size, terms.config.komi_half), (19, 15));
    assert_eq!(terms.response_seconds, WINDOW);
    assert!(ratings.ticket_used(digest(@t)));
    let rated = api.rated_game(id);
    assert_eq!((rated.black, rated.white, rated.size, rated.source), (black(), white(), 19, QUEUE));
    assert_eq!((rated.black_band, rated.white_band), (3, 2));
    assert_eq!((rated.matchmaker, rated.ticket), (t.matchmaker, digest(@t)));
    assert_eq!((rated.expires_at, rated.played_at), (t.expires_at, 0));

    set_block_timestamp(NOW + 100);
    caller(white());
    api.join_channel(id, public_key(PK_WHITE));
    assert_eq!(api.get_channel(id).status, ACTIVE);
    assert_eq!(api.rated_game(id).played_at, NOW + 100);
}

#[test]
#[should_panic(expected: ('Ticket used', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'))]
fn rejects_a_replayed_ticket() {
    let (api, _) = setup();
    let t = ticket(api);
    create(api, t);
    create(api, t);
}

#[test]
#[should_panic(expected: ('Not black', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'))]
fn only_black_creates() {
    let (api, _) = setup();
    let t = ticket(api);
    caller(white());
    api.create_rated_channel(t, signed(t), public_key(PK_WHITE));
}

#[test]
#[should_panic(expected: ('Ticket expired', 'ENTRYPOINT_FAILED'))]
fn white_joins_before_the_ticket_expires() {
    let (api, _) = setup();
    let t = ticket(api);
    let id = create(api, t);
    set_block_timestamp(t.expires_at + 1);
    caller(white());
    api.join_channel(id, public_key(PK_WHITE));
}

#[test]
#[should_panic(expected: ('Not invited', 'ENTRYPOINT_FAILED'))]
fn only_white_joins() {
    let (api, _) = setup();
    let id = create(api, ticket(api));
    caller('STRANGER'.try_into().unwrap());
    api.join_channel(id, public_key(PK_WHITE));
}

#[test]
#[should_panic(expected: ('Ratings not set', 'ENTRYPOINT_FAILED'))]
fn rated_games_need_ratings() {
    let api = channel_in(deploy());
    set_block_timestamp(NOW);
    let t = ticket(api);
    caller(black());
    api.create_rated_channel(t, signed(t), public_key(PK_BLACK));
}

#[test]
#[should_panic(expected: ('Only namespace owner', 'ENTRYPOINT_FAILED'))]
fn only_the_namespace_owner_sets_ratings() {
    let (api, ratings) = setup();
    caller(black());
    api.set_ratings(ratings.contract_address);
}

#[test]
fn unrated_games_have_no_ticket() {
    let (api, ratings) = setup();
    assert_eq!(api.ratings(), ratings.contract_address);
    caller(black());
    let id = api
        .create_channel(
            19, 13, white(), public_key(PK_BLACK), api.contract_address, WINDOW, ranked(),
        );
    set_block_timestamp(NOW + 100_000);
    caller(white());
    api.join_channel(id, public_key(PK_WHITE));
    let rated = api.rated_game(id);
    assert_eq!((rated.black, rated.played_at), (0.try_into().unwrap(), 0));
}
