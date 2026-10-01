use arbiter::TimeControl;
use arbiter::clocks::{Standard, encode};
use arbiter_testing::{public_key, sign};
use starknet::syscalls::deploy_syscall;
use starknet::testing::{pop_log, set_block_timestamp, set_contract_address};
use starknet::{ContractAddress, SyscallResultTrait, get_tx_info};
use crate::math::{self, ONE, Rating};
use crate::ratings::SurroundRatings::{Event, RatingUpdated};
use crate::ratings::{
    ACCEPTED, CHANNEL_ACTIVE, CHANNEL_RETIRING, GameResult, ISurroundRatingsDispatcher,
    ISurroundRatingsDispatcherTrait, MAX_CLOCK_SKEW, NONE, QUEUE, QUEUE_LIFE, RATED, REASON_RESIGN,
    REASON_TIMEOUT, SurroundRatings, TABLE, TIMELOCK_SECONDS, VOID, admin_op,
};
use crate::ticket::{Ticket, digest};

pub const PK_MATCHMAKER: felt252 = 0x3a7c4;
pub const PK_REFEREE: felt252 = 0x7e7e7e;
pub const T0: u64 = 1_700_000_000;
/// Every band a new player could choose.
const ALL_BANDS: u8 = 0b11110;

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

fn deploy(salt: felt252) -> ISurroundRatingsDispatcher {
    let (address, _) = deploy_syscall(
        SurroundRatings::TEST_CLASS_HASH, salt, array![owner().into()].span(), false,
    )
        .unwrap_syscall();
    ISurroundRatingsDispatcher { contract_address: address }
}

/// A contract in its setup phase whose policy accepts `ticket_for`'s tickets
/// from `channel()`, with every starting band allowed.
pub fn setup() -> ISurroundRatingsDispatcher {
    setup_salted(0)
}

fn setup_salted(salt: felt252) -> ISurroundRatingsDispatcher {
    let ratings = deploy(salt);
    set_block_timestamp(T0);
    set_contract_address(owner());
    ratings.set_channel(channel(), CHANNEL_ACTIVE);
    ratings.set_matchmaker(public_key(PK_MATCHMAKER));
    ratings.set_referee(public_key(PK_REFEREE));
    ratings.set_clock_preset(settings(), true);
    ratings.set_prover(prover(), true);
    ratings.set_board(19, 15, true);
    ratings.set_response_window(300, 900);
    ratings.set_start_bands(ALL_BANDS);
    set_contract_address(channel());
    ratings
}

/// A ticket for game `id` issued at `t`.
pub fn ticket_for(
    id: felt252, t: u64, black: ContractAddress, white: ContractAddress, source: u8,
) -> Ticket {
    Ticket {
        chain_id: get_tx_info().unbox().chain_id,
        channel: channel(),
        black,
        white,
        size: 19,
        komi_half: 15,
        clock: TimeControl { referee: public_key(PK_REFEREE), settings: settings(), rng_tip: 0 },
        prover: prover(),
        response_seconds: 600,
        source,
        black_band: 3,
        white_band: 2,
        matchmaker: public_key(PK_MATCHMAKER),
        issued_at: t - 30,
        expires_at: t + 270,
        nonce: id,
    }
}

/// Accept `ticket` for game `id` as `channel()`, at its issue time.
pub fn accept(ratings: ISurroundRatingsDispatcher, ticket: Ticket, id: felt252) -> Ticket {
    set_block_timestamp(ticket.issued_at + 30);
    set_contract_address(channel());
    ratings.check_ticket(ticket, sign(digest(@ticket), PK_MATCHMAKER), id);
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
pub fn play(ratings: ISurroundRatingsDispatcher, id: felt252, winner: u8) -> (Ticket, GameResult) {
    let t = T0 + id.try_into().unwrap() * 3600;
    let ticket = accept(ratings, ticket_for(id, t, black(), white(), QUEUE), id);
    (ticket, result(id, t, winner))
}

fn rating(ratings: ISurroundRatingsDispatcher, player: ContractAddress) -> Rating {
    let p = ratings.player(player);
    Rating { mu: p.mu.into(), phi: p.phi.into(), last: p.last_played }
}

fn status(ratings: ISurroundRatingsDispatcher, ticket: @Ticket) -> u8 {
    let (status, _) = ratings.ticket_status(digest(ticket));
    status
}

#[test]
fn rates_a_game_like_the_math() {
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    assert_eq!(status(ratings, @ticket), ACCEPTED);
    let (b, w) = ratings.rate_game(ticket, game).unwrap();
    let (eb, ew) = math::update_states(
        math::start(3).unwrap(), math::start(2).unwrap(), 2, game.played_at,
    );
    assert_eq!(rating(ratings, black()), eb);
    assert_eq!(rating(ratings, white()), ew);
    assert_eq!((b.games, b.wins, b.losses, b.band, b.params), (1, 1, 0, 3, 2));
    assert_eq!((w.games, w.wins, w.losses, w.band), (1, 0, 1, 2));
    assert!(b.provisional && w.provisional);
    assert_eq!(ratings.ticket_status(digest(@ticket)), (RATED, 1));

    // A second game starts from the stored ratings, not the bands.
    let (mut ticket, game) = play(ratings, 2, 2);
    ticket.black_band = 1;
    let ticket = accept(ratings, ticket, 2);
    set_block_timestamp(game.settled_at);
    ratings.rate_game(ticket, game).unwrap();
    let (eb2, ew2) = math::update_states(eb, ew, 0, game.played_at);
    assert_eq!(rating(ratings, black()), eb2);
    assert_eq!(rating(ratings, white()), ew2);
    assert_eq!(ratings.player(black()).band, 3);
}

#[test]
fn rates_each_ticket_once() {
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    assert!(ratings.rate_game(ticket, game).is_some());
    let before = ratings.player(black());
    assert!(ratings.rate_game(ticket, GameResult { winner: 2, ..game }).is_none());
    assert_eq!(ratings.player(black()), before);
}

#[test]
fn only_the_tickets_channel_rates_its_game() {
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    // Another active channel can't report this ticket's game...
    set_contract_address(owner());
    let other: ContractAddress = 'other'.try_into().unwrap();
    ratings.set_channel(other, CHANNEL_ACTIVE);
    set_contract_address(other);
    assert!(ratings.rate_game(ticket, game).is_none());
    // ...nor can a stranger.
    set_contract_address('stranger'.try_into().unwrap());
    assert!(ratings.rate_game(ticket, game).is_none());
    assert_eq!(status(ratings, @ticket), ACCEPTED);
}

#[test]
fn a_result_must_name_its_tickets_game() {
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    assert!(ratings.rate_game(ticket, GameResult { game_id: 2, ..game }).is_none());
    // A ticket that was never accepted rates nothing either.
    let changed = Ticket { nonce: 99, ..ticket };
    assert!(ratings.rate_game(changed, game).is_none());
    assert_eq!(ratings.player(black()).games, 0);
}

#[test]
fn a_fresh_contract_cannot_rate_an_old_worlds_games() {
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    // A world pointed at another SurroundRatings: it has no accepted tickets.
    let fresh = setup_salted(1);
    set_contract_address(channel());
    assert!(fresh.rate_game(ticket, game).is_none());
    assert_eq!(fresh.player(black()).games, 0);
}

#[test]
fn impossible_times_void_the_game() {
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    // Played after the join deadline, e.g. at u64::MAX.
    assert!(
        ratings.rate_game(ticket, GameResult { played_at: 0xffffffffffffffff, ..game }).is_none(),
    );
    assert_eq!(status(ratings, @ticket), VOID);
    let (ticket, game) = play(ratings, 2, 1);
    // Settled in the future.
    assert!(
        ratings.rate_game(ticket, GameResult { settled_at: game.settled_at + 1, ..game }).is_none(),
    );
    assert_eq!(status(ratings, @ticket), VOID);
    let (ticket, game) = play(ratings, 3, 1);
    assert!(ratings.rate_game(ticket, GameResult { winner: 3, ..game }).is_none());
    let (ticket, game) = play(ratings, 4, 1);
    assert!(ratings.rate_game(ticket, GameResult { reason: 131, ..game }).is_none());
    assert_eq!(ratings.player(black()).games, 0);
}

#[test]
fn a_revoked_matchmaker_voids_games_played_from_then_on() {
    let ratings = setup();
    let (early, early_game) = play(ratings, 1, 1);
    let (late, late_game) = play(ratings, 2, 1);
    // Revoked from between the two games' join times.
    set_contract_address(owner());
    ratings.revoke_matchmaker(public_key(PK_MATCHMAKER), late_game.played_at);
    assert_eq!(ratings.matchmaker(public_key(PK_MATCHMAKER)), (2, late_game.played_at));
    set_contract_address(channel());
    assert!(ratings.rate_game(early, early_game).is_some());
    assert!(ratings.rate_game(late, late_game).is_none());
    assert_eq!(status(ratings, @late), VOID);
}

#[test]
#[should_panic(expected: ('Matchmaker not allowed', 'ENTRYPOINT_FAILED'))]
fn a_retired_matchmaker_signs_no_new_tickets() {
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    set_contract_address(owner());
    ratings.retire_matchmaker(public_key(PK_MATCHMAKER));
    // Its accepted game still rates: routine rotation voids nothing.
    set_contract_address(channel());
    assert!(ratings.rate_game(ticket, game).is_some());
    accept(ratings, ticket_for(2, T0 + 7200, black(), white(), QUEUE), 2);
}

#[test]
fn a_revoked_referee_voids_the_games_it_started_after_and_its_late_flags() {
    let ratings = setup();
    // Started an hour, two hours and three hours after T0, each settled 10
    // minutes after it started; the referee is revoked 2 h 5 min after T0.
    let (early, early_game) = play(ratings, 1, 1);
    let (flag, flag_game) = play(ratings, 2, 1);
    let (late, late_game) = play(ratings, 3, 1);
    set_contract_address(owner());
    ratings.revoke_referee(public_key(PK_REFEREE), T0 + 7500);
    set_contract_address(channel());
    // Its flag decided this timeout, settled after the revocation.
    assert!(ratings.rate_game(flag, GameResult { reason: REASON_TIMEOUT, ..flag_game }).is_none());
    assert_eq!(status(ratings, @flag), VOID);
    // Its first stamp dated this game, after the revocation: void however it ended.
    assert!(ratings.rate_game(late, GameResult { reason: REASON_RESIGN, ..late_game }).is_none());
    assert_eq!(status(ratings, @late), VOID);
    // Started and settled before it: the players' resignation stands.
    assert!(ratings.rate_game(early, GameResult { reason: REASON_RESIGN, ..early_game }).is_some());
}

#[test]
fn a_game_that_never_started_is_void() {
    // No referee stamp: nothing dates it within the ticket's window.
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    assert!(ratings.rate_game(ticket, GameResult { played_at: 0, ..game }).is_none());
    assert_eq!(status(ratings, @ticket), VOID);
}

#[test]
fn a_start_is_checked_against_the_tickets_window_up_to_the_clock_skew() {
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    // The referee's clock a minute behind the matchmaker's is still in the window.
    let skewed = GameResult { played_at: ticket.issued_at - MAX_CLOCK_SKEW, ..game };
    assert!(ratings.rate_game(ticket, skewed).is_some());
    let (ticket, game) = play(ratings, 2, 1);
    let early = GameResult { played_at: ticket.issued_at - MAX_CLOCK_SKEW - 1, ..game };
    assert!(ratings.rate_game(ticket, early).is_none());
    let (ticket, game) = play(ratings, 3, 1);
    let late = GameResult { played_at: ticket.expires_at + MAX_CLOCK_SKEW + 1, ..game };
    assert!(ratings.rate_game(ticket, late).is_none());
}

#[test]
fn a_short_game_is_void_unless_forfeited_onchain() {
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    assert!(ratings.rate_game(ticket, GameResult { steps: 19, ..game }).is_none());
    assert_eq!(status(ratings, @ticket), VOID);
    // Resigned onchain before the keeper submitted: the anchor may be stale,
    // so the loser still loses, and the winner gains nothing.
    let (ticket, game) = play(ratings, 2, 2);
    let forfeit = GameResult { steps: 0, reason: REASON_RESIGN, onchain_forfeit: true, ..game };
    let (b, w) = ratings.rate_game(ticket, forfeit).unwrap();
    assert_eq!((b.games, b.losses), (1, 1));
    assert!(b.mu.into() < math::start(3).unwrap().mu);
    assert_eq!(w.games, 0);
    assert_eq!(ratings.player(white()), ratings.player('nobody'.try_into().unwrap()));
    // A short onchain draw can't happen, but would be void too.
    let (ticket, game) = play(ratings, 3, 0);
    let draw = GameResult { steps: 0, onchain_forfeit: true, ..game };
    assert!(ratings.rate_game(ticket, draw).is_none());
}

/// `n` games at a queue between two fresh players, alternating results, so
/// both end settled. Returns the next game id.
pub fn settle_both(
    ratings: ISurroundRatingsDispatcher, a: ContractAddress, b: ContractAddress, n: u32,
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

#[test]
fn a_game_against_a_newcomer_counts_but_moves_no_peak() {
    let ratings = setup();
    let next = settle_both(ratings, black(), white(), 14);
    let settled = ratings.player(black());
    assert!(settled.settled);
    let before = rating(ratings, black());
    // A newcomer loses to black at the queue: both ratings move, the peak doesn't.
    let newcomer: ContractAddress = 'newcomer'.try_into().unwrap();
    let t = T0 + 20 * 3600;
    let ticket = accept(ratings, ticket_for(next, t, black(), newcomer, QUEUE), next);
    let (b, n) = ratings.rate_game(ticket, result(next, t, 1)).unwrap();
    let (expected, _) = math::update_states(before, math::start(2).unwrap(), 2, t);
    assert_eq!(rating(ratings, black()), expected);
    assert_eq!((b.games, b.wins), (settled.games + 1, settled.wins + 1));
    assert_eq!((b.peak, b.has_peak), (settled.peak, settled.has_peak));
    assert_eq!((n.games, n.losses), (1, 1));
}

#[test]
fn peak_moves_only_between_settled_players_at_the_queue() {
    let ratings = setup();
    let next = settle_both(ratings, black(), white(), 14);
    let before = ratings.player(black());
    // Two settled players at a table: ratings move, the peak doesn't.
    let t = T0 + 20 * 3600;
    let ticket = accept(ratings, ticket_for(next, t, black(), white(), TABLE), next);
    let (b, _) = ratings.rate_game(ticket, result(next, t, 1)).unwrap();
    assert!(b.mu > before.mu);
    assert_eq!((b.peak, b.has_peak), (before.peak, before.has_peak));
    // At the queue it does.
    let t = t + 3600;
    let ticket = accept(ratings, ticket_for(next + 1, t, black(), white(), QUEUE), next + 1);
    let (b, _) = ratings.rate_game(ticket, result(next + 1, t, 1)).unwrap();
    assert!(b.has_peak && b.peak == b.mu - 2 * b.phi.try_into().unwrap());
}

#[test]
fn views_age_the_deviation() {
    let ratings = setup();
    settle_both(ratings, black(), white(), 14);
    let now = ratings.player(black());
    assert!(!now.provisional && now.settled && now.established);
    // Three years idle: the rank shows "?" again, as the next game would see it.
    set_block_timestamp(T0 + 3 * 365 * 86400);
    let idle = ratings.player(black());
    assert!(idle.provisional && !idle.settled && idle.established);
    assert_eq!(idle.phi, now.phi);
    let ranks = ratings.ranks(array![black(), 'nobody'.try_into().unwrap()].span());
    assert_eq!(*ranks[0], (idle.rank_tenths, true, true));
    assert_eq!(*ranks[1], (0, true, false));
}

#[test]
fn a_late_game_never_moves_the_clock_back() {
    let ratings = setup();
    let (late, late_game) = play(ratings, 5, 1);
    let (early, early_game) = play(ratings, 2, 2);
    set_block_timestamp(late_game.settled_at);
    ratings.rate_game(late, late_game).unwrap();
    ratings.rate_game(early, early_game).unwrap();
    assert_eq!(ratings.player(black()).last_played, late_game.played_at);
}

#[test]
fn events_carry_each_sides_state_before_and_after() {
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    // Drop the setup and ticket events.
    loop {
        match pop_log::<Event>(ratings.contract_address) {
            Option::Some(_) => {},
            Option::None => { break; },
        }
    }
    ratings.rate_game(ticket, game).unwrap();
    let black_event = pop_log::<Event>(ratings.contract_address).unwrap();
    let after = rating(ratings, black());
    match black_event {
        Event::RatingUpdated(e) => {
            let e: RatingUpdated = e;
            assert_eq!((e.player, e.digest, e.game_id), (black(), digest(@ticket), 1));
            assert_eq!(
                (e.score, e.source, e.steps, e.params, e.band, e.applied),
                (2, QUEUE, 60, 2, 3, true),
            );
            assert_eq!((e.pre_mu.into(), e.pre_phi), (math::start(3).unwrap().mu, 0));
            assert_eq!(
                (e.mu.into(), e.phi.into(), e.last_played), (after.mu, after.phi, after.last),
            );
        },
        _ => panic!("Expected a rating update"),
    }
}

#[test]
fn a_retiring_channel_rates_but_takes_no_tickets() {
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    set_contract_address(owner());
    ratings.set_channel(channel(), CHANNEL_RETIRING);
    set_contract_address(channel());
    assert!(ratings.rate_game(ticket, game).is_some());
    assert_eq!(ratings.channel_state(channel()), CHANNEL_RETIRING);
    // Removed, it rates nothing more.
    let (ticket2, game2) = (ticket_for(2, T0, black(), white(), QUEUE), result(2, T0, 1));
    set_contract_address(owner());
    ratings.set_channel(channel(), NONE);
    set_contract_address(channel());
    assert!(ratings.rate_game(ticket2, game2).is_none());
}

#[test]
fn the_rank_offset_shifts_every_rank_shown() {
    let ratings = setup();
    let (ticket, game) = play(ratings, 1, 1);
    let (b, _) = ratings.rate_game(ticket, game).unwrap();
    set_contract_address(owner());
    ratings.set_rank_offset(-12);
    assert_eq!(ratings.rank_offset(), -12);
    assert_eq!(ratings.player(black()).rank_tenths, b.rank_tenths - 12);
    assert_eq!(rating(ratings, black()).mu, b.mu.into());
}

// ---- Administration ----

#[test]
#[should_panic(expected: ('Only owner', 'ENTRYPOINT_FAILED'))]
fn only_the_owner_administers() {
    let ratings = setup();
    ratings.set_channel(channel(), NONE);
}

#[test]
fn after_sealing_loosening_waits_for_the_timelock() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.seal();
    assert!(ratings.sealed());
    let key = public_key(0x5eed);
    let op = admin_op('set_matchmaker', array![key].span());
    ratings.queue(op);
    assert_eq!(ratings.queued(op), T0);
    set_block_timestamp(T0 + TIMELOCK_SECONDS);
    ratings.set_matchmaker(key);
    assert_eq!(ratings.matchmaker(key), (1, 0));
    // Consumed: a second use needs a new queue.
    assert_eq!(ratings.queued(op), 0);
}

#[test]
#[should_panic(expected: ('Timelocked', 'ENTRYPOINT_FAILED'))]
fn a_queued_change_waits() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.seal();
    ratings.queue(admin_op('set_prover', array!['new prover'].span()));
    set_block_timestamp(T0 + TIMELOCK_SECONDS - 1);
    ratings.set_prover('new prover'.try_into().unwrap(), true);
}

#[test]
#[should_panic(expected: ('Queued change expired', 'ENTRYPOINT_FAILED'))]
fn a_queued_change_expires() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.seal();
    ratings.queue(admin_op('set_prover', array!['new prover'].span()));
    set_block_timestamp(T0 + QUEUE_LIFE + 1);
    ratings.set_prover('new prover'.try_into().unwrap(), true);
}

#[test]
#[should_panic(expected: ('Not queued', 'ENTRYPOINT_FAILED'))]
fn a_cancelled_change_never_applies() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.seal();
    let op = admin_op('set_rank_offset', array![0x80000000 + 5].span());
    ratings.queue(op);
    ratings.cancel(op);
    set_block_timestamp(T0 + TIMELOCK_SECONDS);
    ratings.set_rank_offset(5);
}

#[test]
#[should_panic(expected: ('Not queued', 'ENTRYPOINT_FAILED'))]
fn upgrades_are_timelocked() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.seal();
    ratings.upgrade(SurroundRatings::TEST_CLASS_HASH.try_into().unwrap());
}

#[test]
fn tightening_applies_at_once_after_sealing() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.seal();
    ratings.retire_matchmaker(public_key(PK_MATCHMAKER));
    ratings.revoke_referee(public_key(PK_REFEREE), T0);
    ratings.set_prover(prover(), false);
    ratings.set_clock_preset(settings(), false);
    ratings.set_board(19, 15, false);
    ratings.set_start_bands(0b10);
    ratings.set_response_window(400, 800);
    ratings.set_channel(channel(), CHANNEL_RETIRING);
    assert_eq!(ratings.channel_state(channel()), CHANNEL_RETIRING);
    assert_eq!(ratings.start_bands(), 0b10);
}

#[test]
#[should_panic(expected: ('Key revoked', 'ENTRYPOINT_FAILED'))]
fn a_revoked_key_stays_revoked() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.revoke_matchmaker(public_key(PK_MATCHMAKER), T0);
    ratings.set_matchmaker(public_key(PK_MATCHMAKER));
}

#[test]
fn ownership_transfers_in_two_steps() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.transfer_ownership(channel());
    assert_eq!((ratings.owner(), ratings.pending_owner()), (owner(), channel()));
    set_contract_address(channel());
    ratings.accept_ownership();
    assert_eq!(ratings.owner(), channel());
    ratings.retire_referee(public_key(PK_REFEREE));
    assert_eq!(ratings.referee(public_key(PK_REFEREE)), (2, 0));
}

#[test]
#[should_panic(expected: ('Not pending owner', 'ENTRYPOINT_FAILED'))]
fn only_the_pending_owner_accepts() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.transfer_ownership(channel());
    set_contract_address('stranger'.try_into().unwrap());
    ratings.accept_ownership();
}

#[test]
fn many_games_pack_and_unpack_exactly() {
    // Nine games, before either side can be settled, both following the math
    // through every pack and unpack.
    let ratings = setup();
    let mut b = math::start(3).unwrap();
    let mut w = math::start(2).unwrap();
    for i in 1..10_u32 {
        let id: felt252 = i.into();
        let winner = if i % 3 == 0 {
            0
        } else if i % 2 == 0 {
            2
        } else {
            1
        };
        let (ticket, game) = play(ratings, id, winner);
        ratings.rate_game(ticket, game).unwrap();
        let (nb, nw) = math::update_states(
            b, w, match winner {
                0 => 1,
                1 => 2,
                _ => 0,
            }, game.played_at,
        );
        b = nb;
        w = nw;
        assert_eq!(rating(ratings, black()), b);
        assert_eq!(rating(ratings, white()), w);
    }
    let p = ratings.player(black());
    assert_eq!((p.games, p.wins, p.losses, p.draws), (9, 3, 3, 3));
    assert!(p.phi.into() < ONE * 2);
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
    ratings.set_anchor(ai, 1132924713);
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
            ticket.black_band = 0;
        }
        if b == ai {
            ticket.white_band = 0;
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
        match starknet::testing::pop_log_raw(ratings.contract_address) {
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
