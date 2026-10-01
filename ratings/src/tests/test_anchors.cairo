use starknet::ContractAddress;
use starknet::testing::{pop_log, set_block_timestamp, set_contract_address};
use crate::math::{self, ANCHOR_PHI, Rating};
use crate::ratings::SurroundRatings::{Event, RatingUpdated};
use crate::ratings::{
    ISurroundRatingsDispatcher, ISurroundRatingsDispatcherTrait, QUEUE, RATED, TIMELOCK_SECONDS,
    VOID, admin_op,
};
use crate::ticket::{Ticket, digest};
use super::test_ratings::{
    T0, accept, black, channel, owner, result, settle_both, setup, ticket_for, white,
};

/// μ at 5k (OGS rank 25) and at 9d (rank 38).
const MU_5K: i64 = 1132924713;
const MU_9D: i64 = 29926744192;

fn ai() -> ContractAddress {
    'ai'.try_into().unwrap()
}

fn pin(ratings: ISurroundRatingsDispatcher, player: ContractAddress, mu: i64) {
    set_contract_address(owner());
    ratings.set_anchor(player, mu);
    set_contract_address(channel());
}

/// A ticket for game `id` at `t` between `black` and the anchor, which has no
/// band.
fn against_ai(id: felt252, t: u64, black: ContractAddress) -> Ticket {
    Ticket { white_band: 0, ..ticket_for(id, t, black, ai(), QUEUE) }
}

fn rating(ratings: ISurroundRatingsDispatcher, player: ContractAddress) -> Rating {
    let p = ratings.player(player);
    Rating { mu: p.mu.into(), phi: p.phi.into(), last: p.last_played }
}

fn drain(ratings: ISurroundRatingsDispatcher) {
    loop {
        match pop_log::<Event>(ratings.contract_address) {
            Option::Some(_) => {},
            Option::None => { break; },
        }
    }
}

#[test]
fn an_anchor_rates_only_its_opponent() {
    let ratings = setup();
    pin(ratings, ai(), MU_5K);
    let t = T0 + 3600;
    let ticket = accept(ratings, against_ai(1, t, black()), 1);
    let (b, w) = ratings.rate_game(ticket, result(1, t, 1)).unwrap();
    let anchor = Rating { mu: MU_5K.into(), phi: ANCHOR_PHI, last: t };
    let (expected, _) = math::update_states(math::start(3).unwrap(), anchor, 2, t);
    assert_eq!(rating(ratings, black()), expected);
    assert_eq!((b.games, b.wins, b.band), (1, 1, 3));
    assert!(!b.anchor);
    // The anchor is unchanged and never stored: no games, a firm rank.
    assert_eq!((w.mu, w.phi.into(), w.games), (MU_5K, ANCHOR_PHI, 0));
    assert!(w.anchor && !w.provisional && w.established && !w.settled);
    assert_eq!(ratings.anchor(ai()), Option::Some(MU_5K));
    assert_eq!(ratings.ticket_status(digest(@ticket)), (RATED, 1));
}

#[test]
fn an_anchor_never_ages() {
    let ratings = setup();
    pin(ratings, ai(), MU_5K);
    let mut prev = math::start(3).unwrap();
    let mut t = T0 + 3600;
    for id in 1..4_u32 {
        let id: felt252 = id.into();
        let ticket = accept(ratings, against_ai(id, t, black()), id);
        ratings.rate_game(ticket, result(id, t, 2)).unwrap();
        let anchor = Rating { mu: MU_5K.into(), phi: ANCHOR_PHI, last: t };
        let (expected, _) = math::update_states(prev, anchor, 0, t);
        assert_eq!(rating(ratings, black()), expected);
        prev = expected;
        t += 400 * 86400;
    }
    let view = ratings.player(ai());
    assert_eq!((view.mu, view.phi.into()), (MU_5K, ANCHOR_PHI));
}

#[test]
fn an_anchors_events_show_its_pin_unchanged() {
    let ratings = setup();
    pin(ratings, ai(), MU_5K);
    let t = T0 + 3600;
    let ticket = accept(ratings, against_ai(1, t, black()), 1);
    drain(ratings);
    ratings.rate_game(ticket, result(1, t, 2)).unwrap();
    let mut events = array![];
    loop {
        match pop_log::<Event>(ratings.contract_address) {
            Option::Some(Event::RatingUpdated(e)) => events.append(e),
            Option::Some(_) => {},
            Option::None => { break; },
        }
    }
    let human: RatingUpdated = events.pop_front().unwrap();
    let anchor: RatingUpdated = events.pop_front().unwrap();
    assert!(human.applied && !human.anchor);
    assert_eq!((anchor.player, anchor.score, anchor.band), (ai(), 2, 0));
    assert!(!anchor.applied && anchor.anchor);
    assert_eq!((anchor.pre_mu, anchor.pre_phi.into(), anchor.pre_last), (MU_5K, ANCHOR_PHI, t));
    assert_eq!((anchor.mu, anchor.phi.into(), anchor.last_played), (MU_5K, ANCHOR_PHI, t));
    assert_eq!(anchor.rank_tenths, 250);
}

#[test]
fn ranks_show_an_anchor_firm() {
    let ratings = setup();
    pin(ratings, ai(), MU_9D);
    let ranks = ratings.ranks(array![ai(), black()].span());
    assert_eq!(*ranks.at(0), (380, false, true));
    assert_eq!(*ranks.at(1), (0, true, false));
}

#[test]
fn anchor_games_move_no_peak() {
    let ratings = setup();
    let next = settle_both(ratings, black(), white(), 14);
    pin(ratings, ai(), MU_9D);
    let before = ratings.player(black());
    assert!(before.settled);
    let t = T0 + 20 * 3600;
    let ticket = accept(
        ratings, Ticket { white_band: 0, ..ticket_for(next, t, black(), ai(), QUEUE) }, next,
    );
    let (b, _) = ratings.rate_game(ticket, result(next, t, 1)).unwrap();
    assert!(b.mu > before.mu);
    assert_eq!((b.peak, b.has_peak), (before.peak, before.has_peak));
}

#[test]
#[should_panic(expected: ('Anchor has a band', 'ENTRYPOINT_FAILED'))]
fn an_anchors_ticket_has_no_band() {
    let ratings = setup();
    pin(ratings, ai(), MU_5K);
    accept(ratings, ticket_for(1, T0 + 3600, black(), ai(), QUEUE), 1);
}

#[test]
#[should_panic(expected: ('Two anchors', 'ENTRYPOINT_FAILED'))]
fn two_anchors_never_play_rated() {
    let ratings = setup();
    pin(ratings, ai(), MU_5K);
    pin(ratings, black(), MU_9D);
    accept(ratings, Ticket { black_band: 0, ..against_ai(1, T0 + 3600, black()) }, 1);
}

#[test]
#[should_panic(expected: ('Player is rated', 'ENTRYPOINT_FAILED'))]
fn a_rated_player_cannot_become_an_anchor() {
    let ratings = setup();
    settle_both(ratings, black(), white(), 1);
    pin(ratings, black(), MU_5K);
}

#[test]
#[should_panic(expected: ('Invalid anchor rating', 'ENTRYPOINT_FAILED'))]
fn an_anchor_is_pinned_within_the_ranks() {
    let ratings = setup();
    pin(ratings, ai(), 32884882087);
}

#[test]
fn removing_an_anchor_voids_its_unrated_games() {
    let ratings = setup();
    pin(ratings, ai(), MU_5K);
    let t = T0 + 3600;
    let ticket = accept(ratings, against_ai(1, t, black()), 1);
    set_contract_address(owner());
    ratings.remove_anchor(ai());
    assert_eq!(ratings.anchor(ai()), Option::None);
    set_contract_address(channel());
    assert!(ratings.rate_game(ticket, result(1, t, 1)).is_none());
    assert_eq!(ratings.ticket_status(digest(@ticket)), (VOID, 1));
    assert_eq!(ratings.player(black()).games, 0);
}

#[test]
#[should_panic(expected: ('Not queued', 'ENTRYPOINT_FAILED'))]
fn after_sealing_an_anchor_waits_for_the_timelock() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.seal();
    ratings.set_anchor(ai(), MU_5K);
}

#[test]
fn after_sealing_anchors_are_queued_and_removed_at_once() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.seal();
    let pinned: felt252 = (MU_5K.into() + 0x8000000000_i128).try_into().unwrap();
    ratings.queue(admin_op('set_anchor', array![ai().into(), pinned].span()));
    set_block_timestamp(T0 + TIMELOCK_SECONDS);
    ratings.set_anchor(ai(), MU_5K);
    assert_eq!(ratings.anchor(ai()), Option::Some(MU_5K));
    // Removing trusts less: no wait.
    ratings.remove_anchor(ai());
    assert_eq!(ratings.anchor(ai()), Option::None);
}
