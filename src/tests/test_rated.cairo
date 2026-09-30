//! Rated games: black creates one from a matchmaker-signed ticket, which the
//! world's `SurroundRatings` checks once; white must join before it expires,
//! and the join time is recorded for rating.
use dojo::world::WorldStorage;
use referee::channel::{ACTIVE, DISPUTE, SETTLED, WAITING};
use referee::{Move, Signature};
use referee_testing::{public_key, sign};
use starknet::syscalls::deploy_syscall;
use starknet::testing::{pop_log_raw, set_block_timestamp};
use starknet::{ContractAddress, SyscallResultTrait, get_contract_address, get_tx_info};
use surround_ratings::math;
use surround_ratings::ratings::{
    ACCEPTED, CHANNEL_ACTIVE, ISurroundRatingsDispatcher, ISurroundRatingsDispatcherTrait, QUEUE,
    RATED, SurroundRatings,
};
use surround_ratings::ticket::{Ticket, digest};
use surround_rules::replay::{opening_history, stone};
use crate::models::RatedGameTimesTrait;
use crate::systems::channel::{IChannelDispatcher, IChannelDispatcherTrait, channel};
use super::test_channel::{
    WINDOW, black, caller, channel_in, deploy, no_approvals, opening, ranked, stamp_game, white,
};

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
    let (_, api, ratings) = rated_world();
    (api, ratings)
}

fn rated_world() -> (WorldStorage, IChannelDispatcher, ISurroundRatingsDispatcher) {
    let admin = get_contract_address();
    let world = deploy();
    let api = channel_in(world);
    // The channel stands in for the prover, as in the channel tests.
    api.allow_prover(channel::TEST_CLASS_HASH.try_into().unwrap(), true);
    let (address, _) = deploy_syscall(
        SurroundRatings::TEST_CLASS_HASH, 0, array![ratings_owner().into()].span(), false,
    )
        .unwrap_syscall();
    let ratings = ISurroundRatingsDispatcher { contract_address: address };
    let clock = ranked().unwrap();
    caller(ratings_owner());
    ratings.set_channel(api.contract_address, CHANNEL_ACTIVE);
    ratings.set_matchmaker(public_key(PK_MATCHMAKER));
    ratings.set_referee(clock.referee);
    ratings.set_start_bands(0b11110);
    ratings.set_clock_preset(clock.settings, true);
    ratings.set_prover(api.contract_address, true);
    ratings.set_board(19, 15, true);
    ratings.set_response_window(300, WINDOW);
    caller(admin);
    api.set_ratings(address);
    set_block_timestamp(NOW);
    (world, api, ratings)
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
    // SurroundRatings keeps the ticket under its digest, for this game.
    assert_eq!(ratings.ticket_status(digest(@t)), (ACCEPTED, id));
    let rated = api.rated_game(id);
    assert_eq!(rated.ticket, digest(@t));
    assert_eq!((rated.expires_at(), rated.played_at()), (t.expires_at, 0));

    set_block_timestamp(NOW + 100);
    caller(white());
    api.join_channel(id, public_key(PK_WHITE));
    assert_eq!(api.get_channel(id).status, ACTIVE);
    assert_eq!(api.rated_game(id).played_at(), NOW + 100);
    assert_eq!(api.rated_game(id).expires_at(), t.expires_at);
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
    caller('STRANGER'.try_into().unwrap());
    api.create_rated_channel(t, signed(t), public_key(PK_WHITE));
}

#[test]
#[should_panic(expected: ('Invalid players', 'ENTRYPOINT_FAILED'))]
fn white_cannot_create_its_own_game() {
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
#[should_panic(expected: ('Ratings already set', 'ENTRYPOINT_FAILED'))]
fn a_worlds_ratings_never_change() {
    let (api, _) = setup();
    api.set_ratings('ANOTHER'.try_into().unwrap());
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
    assert_eq!((rated.ticket, rated.times), (0, 0));
}

/// A rated game black and white started, at `NOW + 60`, and its ticket.
fn joined(api: IChannelDispatcher) -> (felt252, Ticket) {
    let t = ticket(api);
    let id = create(api, t);
    set_block_timestamp(NOW + 60);
    caller(white());
    api.join_channel(id, public_key(PK_WHITE));
    (id, t)
}

/// Twenty stones, then white resigns: a game long enough to rate, settled
/// from its transcript after the dispute window.
fn played_out(api: IChannelDispatcher, id: felt252) {
    let terms = api.terms(id);
    let mut steps = array![];
    let mut stamps = array![];
    for i in 0..20_u16 {
        steps.append(stone(i));
        stamps.append(1000 + i.into() * 1000);
    }
    steps.append(Move::Resign(1));
    stamps.append(30000);
    let (batch, _) = stamp_game(
        @terms, opening(@terms), opening_history(@terms.config), steps.span(), stamps.span(),
    );
    caller(black());
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
    assert_eq!(api.get_channel(id).status, DISPUTE);
    set_block_timestamp(NOW + 60 + WINDOW.into());
    api.resolve_dispute(id, 0);
    assert_eq!(api.get_channel(id).status, SETTLED);
}

/// Whether the world emitted a Dojo event of this tag since the last check.
fn emitted(world: WorldStorage, tag: felt252) -> u32 {
    let mut count = 0;
    loop {
        match pop_log_raw(world.dispatcher.contract_address) {
            Option::Some((keys, _)) => { if keys.len() > 1 && *keys[1] == tag {
                count += 1;
            } },
            Option::None => { break; },
        }
    }
    count
}

#[test]
fn rates_a_settled_game_once() {
    let (world, api, ratings) = rated_world();
    let (id, t) = joined(api);
    // Rating waits for settlement.
    api.rate(id, t);
    assert_eq!(ratings.player(black()).games, 0);
    played_out(api, id);
    emitted(world, 0);
    api.rate(id, t);
    assert_eq!(ratings.ticket_status(digest(@t)), (RATED, id));
    assert_eq!(emitted(world, selector_from_tag!("surround-PlayerRank")), 2);
    // Black won: the same update the math gives, from each band, at the join.
    let (b, w, _) = math::update(math::start(3).unwrap(), math::start(2).unwrap(), 2, NOW + 60);
    let black_rating = ratings.player(black());
    let white_rating = ratings.player(white());
    assert_eq!((black_rating.mu.into(), black_rating.phi.into()), (b.mu, b.phi));
    assert_eq!((white_rating.mu.into(), white_rating.phi.into()), (w.mu, w.phi));
    assert_eq!((black_rating.wins, white_rating.losses), (1, 1));
    // A second report changes nothing.
    api.rate(id, t);
    assert_eq!(ratings.player(black()), black_rating);
}

#[test]
fn an_early_onchain_resignation_still_counts_for_the_loser() {
    let (world, api, ratings) = rated_world();
    let (id, t) = joined(api);
    // Black resigns onchain before any step reached the chain: the anchor
    // shows no moves, so the game can't be voided as an abort.
    caller(black());
    api.resign_channel(id);
    emitted(world, 0);
    api.rate(id, t);
    let black_rating = ratings.player(black());
    assert_eq!((black_rating.games, black_rating.losses), (1, 1));
    assert!(black_rating.mu.into() < math::start(3).unwrap().mu);
    // White, who gains nothing, stays unrated and unmirrored.
    assert_eq!(ratings.player(white()).games, 0);
    assert_eq!(emitted(world, selector_from_tag!("surround-PlayerRank")), 1);
}

#[test]
#[should_panic(expected: ('Not the game ticket', 'ENTRYPOINT_FAILED'))]
fn rating_takes_only_the_games_own_ticket() {
    let (_, api, _) = rated_world();
    let (id, t) = joined(api);
    played_out(api, id);
    api.rate(id, Ticket { black_band: 1, ..t });
}

#[test]
fn rating_ignores_unrated_games() {
    let (api, ratings) = setup();
    caller(black());
    let id = api
        .create_channel(
            19, 15, white(), public_key(PK_BLACK), api.contract_address, WINDOW, ranked(),
        );
    caller(white());
    api.join_channel(id, public_key(PK_WHITE));
    caller(black());
    api.resign_channel(id);
    api.rate(id, ticket(api));
    assert_eq!(ratings.player(black()).games, 0);
}

#[test]
fn sync_mirrors_a_rated_player() {
    let (world, api, _) = rated_world();
    let (id, t) = joined(api);
    played_out(api, id);
    api.rate(id, t);
    emitted(world, 0);
    api.sync(black());
    api.sync('NOBODY'.try_into().unwrap());
    assert_eq!(emitted(world, selector_from_tag!("surround-PlayerRank")), 1);
}
