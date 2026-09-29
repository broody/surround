use referee::clocks::{Standard, encode};
use referee::{Signature, TimeControl};
use referee_testing::{public_key, sign};
use starknet::syscalls::deploy_syscall;
use starknet::testing::{set_block_timestamp, set_contract_address};
use starknet::{ContractAddress, SyscallResultTrait, get_tx_info};
use crate::ratings::{
    ACCEPTED, CHANNEL_ACTIVE, CHANNEL_RETIRING, ISurroundRatingsDispatcher,
    ISurroundRatingsDispatcherTrait, MAX_TICKET_LIFE, NONE, QUEUE, SurroundRatings,
};
use crate::ticket::{Ticket, digest};

const PK_MATCHMAKER: felt252 = 0x3a7c4;
const PK_REFEREE: felt252 = 0x7e7e7e;
const NOW: u64 = 1_700_000_000;
const GAME: felt252 = 42;

fn owner() -> ContractAddress {
    'owner'.try_into().unwrap()
}

fn channel() -> ContractAddress {
    'channel'.try_into().unwrap()
}

fn prover() -> ContractAddress {
    'prover'.try_into().unwrap()
}

fn black() -> ContractAddress {
    'black'.try_into().unwrap()
}

fn white() -> ContractAddress {
    'white'.try_into().unwrap()
}

/// Surround's per-turn timer, 60 s per turn.
fn settings() -> Span<felt252> {
    encode(@Standard { turn_ms: 60000, bank_ms: 0, increment_ms: 0, byoyomi: Option::None })
}

/// A contract whose policy accepts `ticket()`, called as `channel()` at `NOW`.
fn setup() -> ISurroundRatingsDispatcher {
    let (address, _) = deploy_syscall(
        SurroundRatings::TEST_CLASS_HASH, 0, array![owner().into()].span(), false,
    )
        .unwrap_syscall();
    let ratings = ISurroundRatingsDispatcher { contract_address: address };
    set_contract_address(owner());
    ratings.set_channel(channel(), CHANNEL_ACTIVE);
    ratings.set_matchmaker(public_key(PK_MATCHMAKER));
    ratings.set_referee(public_key(PK_REFEREE));
    // Every band: the policy on new players' bands has its own tests.
    ratings.set_start_bands(0b11110);
    ratings.set_clock_preset(settings(), true);
    ratings.set_prover(prover(), true);
    ratings.set_board(9, 13, true);
    ratings.set_board(13, 13, true);
    ratings.set_board(19, 15, true);
    ratings.set_response_window(300, 900);
    set_contract_address(channel());
    set_block_timestamp(NOW);
    ratings
}

fn ticket() -> Ticket {
    Ticket {
        chain_id: get_tx_info().unbox().chain_id,
        channel: channel(),
        black: black(),
        white: white(),
        size: 19,
        komi_half: 15,
        clock: TimeControl { referee: public_key(PK_REFEREE), settings: settings() },
        prover: prover(),
        response_seconds: 600,
        source: QUEUE,
        black_band: 3,
        white_band: 2,
        matchmaker: public_key(PK_MATCHMAKER),
        issued_at: NOW - 30,
        expires_at: NOW + 270,
        nonce: 7,
    }
}

fn signed(ticket: Ticket) -> Signature {
    sign(digest(@ticket), PK_MATCHMAKER)
}

/// Sign `ticket` as the matchmaker and check it as `channel()` for black.
fn check(ratings: ISurroundRatingsDispatcher, ticket: Ticket) -> felt252 {
    ratings.check_ticket(ticket, signed(ticket), black(), GAME)
}

#[test]
fn accepts_a_ticket_once() {
    let ratings = setup();
    let t = ticket();
    assert_eq!(ratings.ticket_status(digest(@t)), (NONE, 0));
    assert_eq!(check(ratings, t), digest(@t));
    assert_eq!(ratings.ticket_status(digest(@t)), (ACCEPTED, GAME));
    let mut other = t;
    other.nonce = 8;
    check(ratings, other);
}

#[test]
#[should_panic(expected: ('Ticket used', 'ENTRYPOINT_FAILED'))]
fn rejects_a_replay() {
    let ratings = setup();
    check(ratings, ticket());
    check(ratings, ticket());
}

/// The other valid signature of the same message, (r, n − s), is the same
/// ticket: used tickets are keyed on the digest.
#[test]
#[should_panic(expected: ('Ticket used', 'ENTRYPOINT_FAILED'))]
fn rejects_a_replay_with_the_mirrored_signature() {
    let ratings = setup();
    let t = ticket();
    let signature = signed(t);
    ratings.check_ticket(t, signature, black(), GAME);
    let order: felt252 = core::ec::stark_curve::ORDER;
    ratings.check_ticket(t, Signature { r: signature.r, s: order - signature.s }, black(), GAME);
}

#[test]
#[should_panic(expected: ('Invalid session signature', 'ENTRYPOINT_FAILED'))]
fn rejects_a_changed_ticket() {
    let ratings = setup();
    let t = ticket();
    let signature = signed(t);
    let mut changed = t;
    changed.white_band = 4;
    ratings.check_ticket(changed, signature, black(), GAME);
}

#[test]
#[should_panic(expected: ('Invalid session signature', 'ENTRYPOINT_FAILED'))]
fn rejects_another_signer() {
    let ratings = setup();
    let t = ticket();
    ratings.check_ticket(t, sign(digest(@t), 0x999), black(), GAME);
}

#[test]
#[should_panic(expected: ('Matchmaker not allowed', 'ENTRYPOINT_FAILED'))]
fn rejects_an_unknown_matchmaker() {
    let ratings = setup();
    let mut t = ticket();
    t.matchmaker = public_key(0x999);
    ratings.check_ticket(t, sign(digest(@t), 0x999), black(), GAME);
}

#[test]
#[should_panic(expected: ('Unknown channel', 'ENTRYPOINT_FAILED'))]
fn rejects_an_unknown_channel() {
    let ratings = setup();
    set_contract_address('stranger'.try_into().unwrap());
    check(ratings, ticket());
}

#[test]
#[should_panic(expected: ('Wrong channel', 'ENTRYPOINT_FAILED'))]
fn rejects_another_channels_ticket() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.set_channel('other'.try_into().unwrap(), CHANNEL_ACTIVE);
    set_contract_address('other'.try_into().unwrap());
    check(ratings, ticket());
}

#[test]
#[should_panic(expected: ('Wrong chain', 'ENTRYPOINT_FAILED'))]
fn rejects_another_chain() {
    let ratings = setup();
    let mut t = ticket();
    t.chain_id += 1;
    check(ratings, t);
}

#[test]
#[should_panic(expected: ('Not black', 'ENTRYPOINT_FAILED'))]
fn rejects_a_creator_other_than_black() {
    let ratings = setup();
    let t = ticket();
    ratings.check_ticket(t, signed(t), white(), GAME);
}

#[test]
#[should_panic(expected: ('Invalid players', 'ENTRYPOINT_FAILED'))]
fn rejects_an_open_seat() {
    let ratings = setup();
    let mut t = ticket();
    t.white = 0.try_into().unwrap();
    check(ratings, t);
}

#[test]
#[should_panic(expected: ('Ticket expired', 'ENTRYPOINT_FAILED'))]
fn rejects_an_expired_ticket() {
    let ratings = setup();
    let t = ticket();
    set_block_timestamp(t.expires_at + 1);
    check(ratings, t);
}

#[test]
#[should_panic(expected: ('Ticket not yet valid', 'ENTRYPOINT_FAILED'))]
fn rejects_a_future_ticket() {
    let ratings = setup();
    let mut t = ticket();
    t.issued_at = NOW + 1;
    check(ratings, t);
}

#[test]
#[should_panic(expected: ('Ticket lives too long', 'ENTRYPOINT_FAILED'))]
fn rejects_a_long_lived_ticket() {
    let ratings = setup();
    let mut t = ticket();
    t.expires_at = t.issued_at + MAX_TICKET_LIFE + 1;
    check(ratings, t);
}

#[test]
#[should_panic(expected: ('Invalid source', 'ENTRYPOINT_FAILED'))]
fn rejects_an_unknown_source() {
    let ratings = setup();
    let mut t = ticket();
    t.source = 3;
    check(ratings, t);
}

#[test]
#[should_panic(expected: ('Invalid band', 'ENTRYPOINT_FAILED'))]
fn rejects_an_invalid_band() {
    let ratings = setup();
    let mut t = ticket();
    t.black_band = 0;
    check(ratings, t);
}

#[test]
#[should_panic(expected: ('Board not rated', 'ENTRYPOINT_FAILED'))]
fn rejects_an_unrated_board() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.set_board(9, 13, false);
    set_contract_address(channel());
    let mut t = ticket();
    t.size = 9;
    t.komi_half = 13;
    check(ratings, t);
}

#[test]
#[should_panic(expected: ('Not the rated komi', 'ENTRYPOINT_FAILED'))]
fn rejects_another_komi() {
    let ratings = setup();
    let mut t = ticket();
    t.komi_half = 13;
    check(ratings, t);
}

#[test]
#[should_panic(expected: ('Referee not allowed', 'ENTRYPOINT_FAILED'))]
fn rejects_an_unknown_referee() {
    let ratings = setup();
    let mut t = ticket();
    t.clock.referee = public_key(0x999);
    check(ratings, t);
}

#[test]
#[should_panic(expected: ('Clock not allowed', 'ENTRYPOINT_FAILED'))]
fn rejects_another_clock() {
    let ratings = setup();
    let mut t = ticket();
    t
        .clock
        .settings =
            encode(@Standard { turn_ms: 1000, bank_ms: 0, increment_ms: 0, byoyomi: Option::None });
    check(ratings, t);
}

#[test]
#[should_panic(expected: ('Prover not allowed', 'ENTRYPOINT_FAILED'))]
fn rejects_an_unknown_prover() {
    let ratings = setup();
    let mut t = ticket();
    t.prover = 'rogue'.try_into().unwrap();
    check(ratings, t);
}

#[test]
#[should_panic(expected: ('Response window not allowed', 'ENTRYPOINT_FAILED'))]
fn rejects_a_long_response_window() {
    let ratings = setup();
    let mut t = ticket();
    t.response_seconds = 604800;
    check(ratings, t);
}

#[test]
fn policy_views() {
    let ratings = setup();
    assert!(ratings.is_clock_preset(settings()));
    assert!(ratings.is_prover(prover()));
    assert_eq!(ratings.board(19), Option::Some(15));
    assert_eq!(ratings.board(9), Option::Some(13));
    assert_eq!(ratings.response_window(), (300, 900));
    set_contract_address(owner());
    ratings.set_board(19, 0, true);
    assert_eq!(ratings.board(19), Option::Some(0));
    ratings.set_board(19, 0, false);
    assert_eq!(ratings.board(19), Option::None);
}

#[test]
#[should_panic(expected: ('Only owner', 'ENTRYPOINT_FAILED'))]
fn only_the_owner_sets_policy() {
    let ratings = setup();
    ratings.set_prover(prover(), false);
}

/// The digest the SDK's `ticketDigest` computes for the same ticket
/// (offchain/sdk/test/rating.test.mjs).
#[test]
fn digest_matches_the_sdk() {
    let t = Ticket {
        chain_id: 'SN_SEPOLIA',
        channel: 0x111.try_into().unwrap(),
        black: 0x222.try_into().unwrap(),
        white: 0x333.try_into().unwrap(),
        size: 19,
        komi_half: 15,
        clock: TimeControl { referee: 0x444, settings: settings() },
        prover: 0x555.try_into().unwrap(),
        response_seconds: 600,
        source: QUEUE,
        black_band: 3,
        white_band: 2,
        matchmaker: 0x666,
        issued_at: NOW - 30,
        expires_at: NOW + 270,
        nonce: 7,
    };
    assert_eq!(digest(@t), SDK_DIGEST);
}

const SDK_DIGEST: felt252 = 0x1230217ba008ee9a520cedeee040092dd4b486a9f40467af4721669187aa2d8;

#[test]
#[should_panic(expected: ('Band not allowed', 'ENTRYPOINT_FAILED'))]
fn a_new_player_chooses_only_the_allowed_bands() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.set_start_bands(0b110);
    set_contract_address(channel());
    // Band 3 (6k) for a player with no rated games.
    check(ratings, ticket());
}

#[test]
fn the_default_bands_are_23k_17k_and_6k() {
    let (address, _) = deploy_syscall(
        SurroundRatings::TEST_CLASS_HASH, 1, array![owner().into()].span(), false,
    )
        .unwrap_syscall();
    let fresh = ISurroundRatingsDispatcher { contract_address: address };
    assert_eq!(fresh.start_bands(), 0b1110);
}

#[test]
#[should_panic(expected: ('Unknown channel', 'ENTRYPOINT_FAILED'))]
fn a_retiring_channel_takes_no_tickets() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.set_channel(channel(), CHANNEL_RETIRING);
    set_contract_address(channel());
    check(ratings, ticket());
}

#[test]
#[should_panic(expected: ('Referee not allowed', 'ENTRYPOINT_FAILED'))]
fn a_retired_referee_names_no_new_tickets() {
    let ratings = setup();
    set_contract_address(owner());
    ratings.retire_referee(public_key(PK_REFEREE));
    set_contract_address(channel());
    check(ratings, ticket());
}

#[test]
#[should_panic(expected: ('Invalid game id', 'ENTRYPOINT_FAILED'))]
fn a_game_id_must_fit_64_bits() {
    let ratings = setup();
    let t = ticket();
    ratings.check_ticket(t, signed(t), black(), 0x10000000000000000);
}
