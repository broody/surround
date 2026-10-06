//! Rated games: anyone opens one on both wallets' signatures over its terms and
//! a matchmaker-signed ticket. The terms must be the ticket's, and the world's
//! `SurroundRatings` accepts each ticket once. The referee's first stamp dates
//! the game, and it rates only if that falls within the ticket's window.
use arbiter::channel::{ACTIVE, DISPUTE, SETTLED};
use arbiter::{
    Approval, Move, Signature, Terms, TimeControl, checkpoint_hash, context_hash, state_hash,
};
use arbiter_testing::{public_key, sign};
use core::cmp::max;
use dojo::world::WorldStorage;
use starknet::syscalls::deploy_syscall;
use starknet::testing::{pop_log_raw, set_block_timestamp};
use starknet::{
    ContractAddress, SyscallResultTrait, get_block_timestamp, get_contract_address, get_tx_info,
};
use surround_ratings::math;
use surround_ratings::ratings::{
    ACCEPTED, CHANNEL_ACTIVE, ISurroundRatingsDispatcher, ISurroundRatingsDispatcherTrait,
    MAX_CLOCK_SKEW, QUEUE, RATED, SurroundRatings, VOID,
};
use surround_ratings::ticket::{Ticket, digest};
use surround_rules::go::{GoConfig, GoRules};
use surround_rules::replay::{opening_history, stone};
use crate::models::RatedGame;
use crate::systems::channel::{
    DELEGATION_SECONDS, IChannelDispatcher, IChannelDispatcherTrait, channel,
};
use super::test_channel::{
    DELEGATE_WHITE, WALLET_BLACK, WALLET_WHITE, WINDOW, approvals, black, black_delegated,
    black_signed_in, caller, channel_in, delegated, deploy, keeper, no_approvals, no_tip,
    open_terms, opening, own_id, ranked, rekeyed, session_keys, signed_by_both, stamp_game,
    terms_for, ticket_terms, wallet_signature, white,
};

const PK_MATCHMAKER: felt252 = 0x3a7c4;
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

/// The keeper opens `terms` with ticket `t`, both wallets signing the terms:
/// anyone may send it.
fn open_with(api: IChannelDispatcher, terms: Terms<GoConfig>, t: Ticket) {
    caller(keeper());
    api.open_rated_game(terms, signed_by_both(@terms), t, signed(t));
}

/// Open `t`'s game on the ticket's own terms, under its seats' id.
fn open(api: IChannelDispatcher, t: Ticket) -> felt252 {
    let terms = ticket_terms(@t);
    open_with(api, terms, t);
    terms.game_id
}

#[test]
fn opens_a_rated_game() {
    let (api, ratings) = setup();
    let t = ticket(api);
    let id = open(api, t);
    // Play starts at once: there is no join.
    let game = api.get_channel(id);
    assert_eq!((game.player_0, game.player_1, game.status), (black(), white(), ACTIVE));
    assert_eq!(game.referee, t.clock.referee);
    assert_eq!(game.clock_settings, t.clock.settings);
    assert_eq!(game.prover, api.contract_address);
    // Nothing stamped yet: the game hasn't started.
    assert_eq!(game.started, 0);
    let terms = api.terms(id);
    assert_eq!(terms, ticket_terms(@t));
    assert_eq!((terms.config.size, terms.config.komi_half), (19, 15));
    assert_eq!(terms.config.ticket, digest(@t));
    assert_eq!(terms.response_seconds, WINDOW);
    // SurroundRatings keeps the ticket under its digest, for this game.
    assert_eq!(ratings.ticket_status(digest(@t)), (ACCEPTED, id));
    assert_eq!(api.rated_game(id), RatedGame { game_id: id, ticket: digest(@t) });
}

/// The keeper opens `t`'s game with black signed in: its key, which its wallet
/// delegated until `expires_at`, agrees in its place.
fn open_signed_in(api: IChannelDispatcher, t: Ticket, expires_at: u64) -> felt252 {
    let terms = ticket_terms(@t);
    caller(keeper());
    api.open_rated_game_delegable(terms, black_signed_in(@terms, expires_at), t, signed(t));
    terms.game_id
}

#[test]
fn a_signed_in_player_agrees_with_the_key_its_wallet_delegated() {
    let (api, ratings) = setup();
    let t = ticket(api);
    // Signed in a week ago less a minute: the week and the hour's slack are the most.
    let id = open_signed_in(api, t, NOW + DELEGATION_SECONDS);
    assert_eq!((api.get_channel(id).status, api.terms(id)), (ACTIVE, ticket_terms(@t)));
    assert_eq!(ratings.ticket_status(digest(@t)), (ACCEPTED, id));
    assert_eq!(api.rated_game(id), RatedGame { game_id: id, ticket: digest(@t) });
}

#[test]
fn two_signed_in_players_open_a_rated_game_without_their_wallets() {
    let (api, ratings) = setup();
    let t = ticket(api);
    let terms = ticket_terms(@t);
    let both = array![
        black_delegated(@terms, NOW + 3600),
        delegated(@terms, 1, WALLET_WHITE, DELEGATE_WHITE, NOW + 7200),
    ];
    caller(keeper());
    api.open_rated_game_delegable(terms, both.span(), t, signed(t));
    assert_eq!(api.get_channel(terms.game_id).status, ACTIVE);
    assert_eq!(ratings.ticket_status(digest(@t)), (ACCEPTED, terms.game_id));
}

#[test]
fn wallets_open_through_the_delegable_entrypoint_too() {
    let (api, _) = setup();
    let t = ticket(api);
    let terms = ticket_terms(@t);
    let both = array![
        Approval::Wallet(wallet_signature(@terms, 0, WALLET_BLACK)),
        Approval::Wallet(wallet_signature(@terms, 1, WALLET_WHITE)),
    ];
    caller(keeper());
    api.open_rated_game_delegable(terms, both.span(), t, signed(t));
    assert_eq!(api.get_channel(terms.game_id).status, ACTIVE);
}

#[test]
#[should_panic(expected: ('Delegation too long', 'ENTRYPOINT_FAILED'))]
fn a_delegation_runs_a_week_and_an_hour_at_most() {
    let (api, _) = setup();
    open_signed_in(api, ticket(api), NOW + DELEGATION_SECONDS + 1);
}

#[test]
#[should_panic(expected: ('Delegation expired', 'ENTRYPOINT_FAILED'))]
fn an_expired_sign_in_agrees_to_nothing() {
    let (api, _) = setup();
    open_signed_in(api, ticket(api), NOW);
}

#[test]
#[should_panic(expected: ('Not the ticket game', 'ENTRYPOINT_FAILED'))]
fn a_delegated_open_still_takes_the_tickets_terms() {
    let (api, _) = setup();
    let t = ticket(api);
    let terms = ticket_terms(@t);
    // Agreed terms, on another ticket: the colors swapped.
    let other = Ticket { black: t.white, white: t.black, ..t };
    caller(keeper());
    api.open_rated_game_delegable(terms, black_signed_in(@terms, NOW + 60), other, signed(other));
}

#[test]
#[should_panic(expected: ('Ticket used', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'))]
fn rejects_a_replayed_ticket() {
    let (api, _) = setup();
    let t = ticket(api);
    open(api, t);
    // The same pairing again, as another game: on fresh session keys, so
    // under another id.
    open_with(api, rekeyed(ticket_terms(@t), session_keys(1)), t);
}

#[test]
#[should_panic(expected: ('Invalid wallet signature', 'ENTRYPOINT_FAILED'))]
fn opening_needs_both_wallets() {
    let (api, _) = setup();
    let t = ticket(api);
    let terms = ticket_terms(@t);
    // White never signed.
    let signatures = array![wallet_signature(@terms, 0, WALLET_BLACK), array![].span()];
    caller(keeper());
    api.open_rated_game(terms, signatures.span(), t, signed(t));
}

#[test]
#[should_panic(expected: ('Invalid wallet signature', 'ENTRYPOINT_FAILED'))]
fn one_wallet_cannot_sign_for_both() {
    let (api, _) = setup();
    let t = ticket(api);
    let terms = ticket_terms(@t);
    // Black signs white's seat too.
    let signatures = array![
        wallet_signature(@terms, 0, WALLET_BLACK), wallet_signature(@terms, 1, WALLET_BLACK),
    ];
    caller(keeper());
    api.open_rated_game(terms, signatures.span(), t, signed(t));
}

#[test]
#[should_panic(expected: ('Not the ticket players', 'ENTRYPOINT_FAILED'))]
fn the_ticket_fixes_the_colors() {
    let (api, _) = setup();
    let t = ticket(api);
    let terms = ticket_terms(@t);
    // White takes black, under the id that goes with the swapped seats.
    let players = array![white().into(), black().into()].span();
    open_with(api, own_id(Terms { players, ..terms }), t);
}

#[test]
#[should_panic(expected: ('Not the ticket board', 'ENTRYPOINT_FAILED'))]
fn the_ticket_fixes_the_board() {
    let (api, _) = setup();
    let t = ticket(api);
    let terms = ticket_terms(@t);
    let config = GoConfig { komi_half: 13, ..terms.config };
    open_with(api, Terms { config, ..terms }, t);
}

#[test]
#[should_panic(expected: ('Not the ticket clock', 'ENTRYPOINT_FAILED'))]
fn the_ticket_fixes_the_clock() {
    let (api, _) = setup();
    let t = ticket(api);
    let terms = ticket_terms(@t);
    // Another referee.
    let clock = TimeControl { referee: public_key(0x7e7e7f), ..t.clock };
    open_with(api, Terms { clock: Option::Some(clock), ..terms }, t);
}

#[test]
#[should_panic(expected: ('Not the ticket prover', 'ENTRYPOINT_FAILED'))]
fn the_ticket_fixes_the_prover() {
    let (api, _) = setup();
    let t = ticket(api);
    let terms = ticket_terms(@t);
    open_with(api, Terms { prover: 'PROVER', ..terms }, t);
}

#[test]
#[should_panic(expected: ('Not the ticket window', 'ENTRYPOINT_FAILED'))]
fn the_ticket_fixes_the_response_window() {
    let (api, _) = setup();
    let t = ticket(api);
    let terms = ticket_terms(@t);
    open_with(api, Terms { response_seconds: WINDOW - 1, ..terms }, t);
}

#[test]
#[should_panic(expected: ('Not the ticket game', 'ENTRYPOINT_FAILED'))]
fn the_wallets_sign_the_tickets_digest() {
    let (api, _) = setup();
    let t = ticket(api);
    let terms = ticket_terms(@t);
    // The wallets signed another pairing's game.
    let config = GoConfig { ticket: digest(@Ticket { nonce: 2, ..t }), ..terms.config };
    open_with(api, Terms { config, ..terms }, t);
}

#[test]
#[should_panic(expected: ('Rated game needs its ticket', 'ENTRYPOINT_FAILED'))]
fn a_game_signed_as_rated_opens_only_as_rated() {
    let (api, _) = setup();
    let terms = ticket_terms(@ticket(api));
    caller(keeper());
    api.open_game(terms, signed_by_both(@terms), no_tip());
}

#[test]
#[should_panic(expected: ('Ratings not set', 'ENTRYPOINT_FAILED'))]
fn rated_games_need_ratings() {
    let api = channel_in(deploy());
    set_block_timestamp(NOW);
    open(api, ticket(api));
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
    let terms = terms_for(api, GoConfig { size: 19, komi_half: 13, ticket: 0 }, ranked());
    open_terms(api, terms);
    let id = terms.game_id;
    assert_eq!(api.get_channel(id).status, ACTIVE);
    assert_eq!(api.rated_game(id), RatedGame { game_id: id, ticket: 0 });
}

/// `ticket(api)`'s game, opened.
fn opened(api: IChannelDispatcher) -> (felt252, Ticket) {
    let t = ticket(api);
    (open(api, t), t)
}

/// Twenty stones, one a second from the referee's first stamp at `start` (Unix
/// seconds), then white resigns: a game long enough to rate, settled from its
/// transcript after the dispute window.
fn played_out(api: IChannelDispatcher, id: felt252, start: u64) {
    let terms = api.terms(id);
    let mut steps = array![];
    let mut stamps = array![];
    for i in 0..20_u16 {
        steps.append(stone(i));
        stamps.append((start + i.into()) * 1000);
    }
    steps.append(Move::Resign(1));
    stamps.append((start + 30) * 1000);
    let (batch, _) = stamp_game(
        @terms, opening(@terms), opening_history(@terms.config), steps.span(), stamps.span(),
    );
    // Submitted when play ended, or now if the game reached the chain later.
    let now = max(get_block_timestamp(), start + 30);
    set_block_timestamp(now);
    caller(black());
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
    assert_eq!(api.get_channel(id).status, DISPUTE);
    set_block_timestamp(now + WINDOW.into());
    api.resolve_dispute(id, 0);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    // The first stamp, in seconds.
    assert_eq!(channel.started, start);
}

/// Black's first stone, stamped at `start` (Unix seconds) and checkpointed
/// onchain with both seats' approval: the chain sees the game start.
pub fn first_stone(api: IChannelDispatcher, id: felt252, start: u64) {
    let terms = api.terms(id);
    let (batch, end) = stamp_game(
        @terms,
        opening(@terms),
        opening_history(@terms.config),
        array![stone(40)].span(),
        array![start * 1000].span(),
    );
    let context = context_hash::<GoRules>(@terms);
    let acks = approvals(checkpoint_hash::<GoRules>(context, 0, state_hash::<GoRules>(@end)));
    set_block_timestamp(start);
    caller(keeper());
    api.submit_history(id, 0, opening(@terms), opening_history(@terms.config), batch, acks);
    let channel = api.get_channel(id);
    assert_eq!((channel.status, channel.started), (ACTIVE, start));
}

/// How many Dojo events of this tag the world emitted since the last check.
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

/// When each `PlayerRank` the world emitted since the last check says its
/// game was played: the event's last field.
fn rank_dates(world: WorldStorage) -> Array<u64> {
    let mut dates = array![];
    loop {
        match pop_log_raw(world.dispatcher.contract_address) {
            Option::Some((
                keys, data,
            )) => {
                if keys.len() > 1 && *keys[1] == selector_from_tag!("surround-PlayerRank") {
                    dates.append((*data[data.len() - 1]).try_into().unwrap());
                }
            },
            Option::None => { break; },
        }
    }
    dates
}

#[test]
fn rates_a_settled_game_once() {
    let (world, api, ratings) = rated_world();
    let (id, t) = opened(api);
    // Its id is its seats' hash, a full felt: the ratings keep all of it.
    let wide: u256 = id.into();
    assert!(wide.high != 0);
    // Rating waits for settlement.
    api.rate(id, t);
    assert_eq!(ratings.player(black()).games, 0);
    // The referee's first stamp comes a minute after the pairing.
    played_out(api, id, NOW + 60);
    emitted(world, 0);
    api.rate(id, t);
    assert_eq!(ratings.ticket_status(digest(@t)), (RATED, id));
    // Both players mirrored, dated by the first stamp.
    assert_eq!(rank_dates(world), array![NOW + 60, NOW + 60]);
    // Black won: the same update the math gives, from each band, when the
    // game started.
    let (b, w, _) = math::update(math::start(3).unwrap(), math::start(2).unwrap(), 2, NOW + 60);
    let black_rating = ratings.player(black());
    let white_rating = ratings.player(white());
    assert_eq!((black_rating.mu.into(), black_rating.phi.into()), (b.mu, b.phi));
    assert_eq!((white_rating.mu.into(), white_rating.phi.into()), (w.mu, w.phi));
    assert_eq!((black_rating.wins, white_rating.losses), (1, 1));
    assert_eq!((black_rating.last_played, white_rating.last_played), (NOW + 60, NOW + 60));
    // A second report changes nothing.
    api.rate(id, t);
    assert_eq!(ratings.player(black()), black_rating);
}

#[test]
fn a_game_against_an_anchor_rates_and_mirrors_only_the_human() {
    let (world, api, ratings) = rated_world();
    // White is an AI pinned at 5k (OGS rank 25): its ticket carries no band.
    let pin: i64 = 1132924713;
    let admin = get_contract_address();
    caller(ratings_owner());
    ratings.set_anchor(white(), pin);
    caller(admin);
    let t = Ticket { white_band: 0, ..ticket(api) };
    let id = open(api, t);
    played_out(api, id, NOW + 60);
    emitted(world, 0);
    api.rate(id, t);
    assert_eq!(ratings.ticket_status(digest(@t)), (RATED, id));
    // Only black is mirrored.
    assert_eq!(rank_dates(world), array![NOW + 60]);
    let anchor = math::Rating { mu: pin.into(), phi: math::ANCHOR_PHI, last: NOW + 60 };
    let (b, _, _) = math::update(math::start(3).unwrap(), anchor, 2, NOW + 60);
    let black_rating = ratings.player(black());
    assert_eq!((black_rating.mu.into(), black_rating.phi.into()), (b.mu, b.phi));
    let white_rating = ratings.player(white());
    assert!(white_rating.anchor && white_rating.games == 0);
    assert_eq!(white_rating.mu, pin);
}

#[test]
fn a_short_onchain_resignation_still_counts_for_the_loser() {
    let (world, api, ratings) = rated_world();
    let (id, t) = opened(api);
    // One stamped stone reaches the chain, then black resigns onchain: the
    // anchor shows too few moves to rate, but a forfeit can't be voided as an
    // abort.
    first_stone(api, id, NOW + 60);
    caller(black());
    api.resign_channel(id);
    emitted(world, 0);
    api.rate(id, t);
    let black_rating = ratings.player(black());
    assert_eq!((black_rating.games, black_rating.losses), (1, 1));
    assert!(black_rating.mu.into() < math::start(3).unwrap().mu);
    assert_eq!(black_rating.last_played, NOW + 60);
    // White, who gains nothing, stays unrated and unmirrored.
    assert_eq!(ratings.player(white()).games, 0);
    assert_eq!(rank_dates(world), array![NOW + 60]);
}

#[test]
fn resigning_before_any_stamp_reached_the_chain_still_loses() {
    let (world, api, ratings) = rated_world();
    let t = ticket(api);
    // Long after the ticket expired, black opens the game and resigns onchain
    // before the keeper submits anything stamped: no stamp dates the game, so
    // its ticket does, and the forfeit counts for the loser.
    set_block_timestamp(t.expires_at + 3600);
    let id = open(api, t);
    caller(black());
    api.resign_channel(id);
    assert_eq!(api.get_channel(id).started, 0);
    emitted(world, 0);
    api.rate(id, t);
    assert_eq!(ratings.ticket_status(digest(@t)), (RATED, id));
    let black_rating = ratings.player(black());
    assert_eq!((black_rating.games, black_rating.losses), (1, 1));
    assert_eq!(black_rating.last_played, t.issued_at);
    assert_eq!(ratings.player(white()).games, 0);
    assert_eq!(rank_dates(world), array![t.issued_at]);
}

#[test]
fn a_game_opened_after_its_ticket_expired_still_rates() {
    let (world, api, ratings) = rated_world();
    let t = ticket(api);
    // The game first needs the chain an hour after its ticket expired, when it
    // settles: the ticket is still accepted.
    set_block_timestamp(t.expires_at + 3600);
    let id = open(api, t);
    assert_eq!(ratings.ticket_status(digest(@t)), (ACCEPTED, id));
    // Its first stamp came at the last second the deadline and the clock skew
    // allow.
    let start = t.expires_at + MAX_CLOCK_SKEW;
    played_out(api, id, start);
    emitted(world, 0);
    api.rate(id, t);
    assert_eq!(ratings.ticket_status(digest(@t)), (RATED, id));
    assert_eq!(rank_dates(world), array![start, start]);
    assert_eq!(ratings.player(black()).last_played, start);
}

#[test]
fn a_game_started_after_its_window_is_void() {
    let (world, api, ratings) = rated_world();
    let (id, t) = opened(api);
    // The referee's first stamp comes a second past the deadline and skew.
    played_out(api, id, t.expires_at + MAX_CLOCK_SKEW + 1);
    emitted(world, 0);
    api.rate(id, t);
    assert_eq!(ratings.ticket_status(digest(@t)), (VOID, id));
    assert_eq!(ratings.player(black()).games, 0);
    assert_eq!(emitted(world, selector_from_tag!("surround-PlayerRank")), 0);
}

#[test]
#[should_panic(expected: ('Not the game ticket', 'ENTRYPOINT_FAILED'))]
fn rating_takes_only_the_games_own_ticket() {
    let (_, api, _) = rated_world();
    let (id, t) = opened(api);
    played_out(api, id, NOW + 60);
    api.rate(id, Ticket { black_band: 1, ..t });
}

#[test]
fn rating_ignores_unrated_games() {
    let (api, ratings) = setup();
    let terms = terms_for(api, GoConfig { size: 19, komi_half: 15, ticket: 0 }, ranked());
    open_terms(api, terms);
    caller(black());
    api.resign_channel(terms.game_id);
    api.rate(terms.game_id, ticket(api));
    assert_eq!(ratings.player(black()).games, 0);
}

#[test]
fn sync_mirrors_a_rated_player() {
    let (world, api, _) = rated_world();
    let (id, t) = opened(api);
    played_out(api, id, NOW + 60);
    api.rate(id, t);
    emitted(world, 0);
    api.sync(black());
    api.sync('NOBODY'.try_into().unwrap());
    assert_eq!(emitted(world, selector_from_tag!("surround-PlayerRank")), 1);
}
