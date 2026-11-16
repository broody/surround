//! Rank cards: one soulbound card per rated player, drawn on read from
//! `SurroundRatings`, so it follows every rated game with no write of its own.
use arbiter_ratings::{IRatingsDispatcher, IRatingsDispatcherTrait, Ticket};
use openzeppelin_interfaces::erc721::{
    IERC721Dispatcher, IERC721DispatcherTrait, IERC721MetadataDispatcher,
    IERC721MetadataDispatcherTrait,
};
use starknet::syscalls::deploy_syscall;
use starknet::{ContractAddress, SyscallResultTrait, get_block_timestamp, get_contract_address};
use surround_ratings::rules::GO;
use crate::kifu::text::{into_bytes, text};
use crate::rank_card::card::{IRankCardDispatcher, IRankCardDispatcherTrait, RankCard};
use crate::rank_card::render::{self, Card, rank_label};
use crate::systems::channel::{IChannelDispatcher, IChannelDispatcherTrait};
use super::test_channel::{black, caller, rekeyed, session_keys, ticket_terms, white};
use super::test_rated::{
    open, open_with, played_out, played_out_by, rated_world, ratings_owner, ticket,
};

fn contains(haystack: @ByteArray, needle: @ByteArray) -> bool {
    let (h, n) = (haystack.len(), needle.len());
    if n > h {
        return false;
    }
    for i in 0..h - n + 1 {
        let mut j = 0;
        while j < n && haystack[i + j] == needle[j] {
            j += 1;
        }
        if j == n {
            return true;
        }
    }
    false
}

fn count(haystack: @ByteArray, byte: u8) -> u32 {
    let mut n = 0;
    for i in 0..haystack.len() {
        if haystack[i] == byte {
            n += 1;
        }
    }
    n
}

fn label(shown: u16) -> ByteArray {
    let mut t = text();
    rank_label(ref t, shown);
    into_bytes(t)
}

fn token(player: ContractAddress) -> u256 {
    Into::<felt252, u256>::into(player.into())
}

/// A world with `SurroundRatings` and a rank card contract reading it.
fn setup() -> (IChannelDispatcher, IRatingsDispatcher, IRankCardDispatcher) {
    let (_, api, ratings) = rated_world();
    let (address, _) = deploy_syscall(
        RankCard::TEST_CLASS_HASH, 0, array![ratings.contract_address.into()].span(), false,
    )
        .unwrap_syscall();
    (api, ratings, IRankCardDispatcher { contract_address: address })
}

fn erc721(cards: IRankCardDispatcher) -> IERC721Dispatcher {
    IERC721Dispatcher { contract_address: cards.contract_address }
}

fn metadata(cards: IRankCardDispatcher) -> IERC721MetadataDispatcher {
    IERC721MetadataDispatcher { contract_address: cards.contract_address }
}

/// One rated game, black winning, from a minute after now.
fn one_game(api: IChannelDispatcher) {
    let t = ticket(api);
    let id = open(api, t);
    played_out(api, id, get_block_timestamp() + 60);
    api.rate(id, t);
}

#[test]
#[available_gas(100000000000)]
fn rank_labels_read_as_kyu_and_dan() {
    assert_eq!(label(0), "30k");
    assert_eq!(label(9), "30k");
    assert_eq!(label(10), "29k");
    assert_eq!(label(255), "5k");
    assert_eq!(label(299), "1k");
    assert_eq!(label(300), "1d");
    assert_eq!(label(389), "9d");
}

#[test]
#[available_gas(100000000000)]
fn the_card_shows_rank_and_record() {
    let card = Card {
        player: 0x54f00000000000000000000000000000000000000000000000000000000eca3,
        shown: 255,
        provisional: false,
        games: 12,
        wins: 7,
        losses: 5,
        draws: 0,
    };
    let svg = render::svg(@card);
    assert!(contains(@svg, @">surround.gg</text>"));
    // 5 kyu: the number, then the word beside it.
    assert!(
        contains(
            @svg,
            @"font-size='200' font-weight='bold' fill='rgb(240,198,113)' text-anchor='end'>5</text>",
        ),
    );
    assert!(contains(@svg, @"text-anchor='start'>KYU</text>"));
    assert!(contains(@svg, @">12</text>"));
    assert!(contains(@svg, @">GAMES</text>"));
    assert!(contains(@svg, @">7</text>"));
    assert!(contains(@svg, @">WON</text>"));
    assert!(contains(@svg, @">5</text>"));
    assert!(contains(@svg, @">LOST</text>"));
    assert!(contains(@svg, @">0x054f..eca3<"));
    // No draws, no drawn column.
    assert!(!contains(@svg, @"DRAWN"));
    // Single quotes only, no `#`, and the one `%`.
    assert_eq!((count(@svg, '"'), count(@svg, '#'), count(@svg, '%')), (0, 0, 0));
}

#[test]
#[available_gas(100000000000)]
fn a_provisional_rank_has_a_question_mark() {
    let card = Card {
        player: 1, shown: 135, provisional: true, games: 2, wins: 1, losses: 0, draws: 1,
    };
    let svg = render::svg(@card);
    // Two digits shrink the number to fit.
    assert!(
        contains(
            @svg,
            @"font-size='150' font-weight='bold' fill='rgb(240,198,113)' text-anchor='end'>17</text>",
        ),
    );
    assert!(contains(@svg, @">KYU?</text>"));
    assert!(contains(@svg, @">DRAWN</text>"));
}

#[test]
#[available_gas(100000000000)]
fn metadata_carries_the_svg_and_the_record() {
    let card = Card {
        player: 1, shown: 312, provisional: false, games: 40, wins: 30, losses: 9, draws: 1,
    };
    let uri = render::token_uri(@card);
    assert!(contains(@uri, @"data:application/json,{\"name\":\"Surround Rank Card 0x0000..0001\""));
    assert!(contains(@uri, @"\"image\":\"data:image/svg+xml,<svg "));
    assert!(contains(@uri, @"{\"trait_type\":\"Rank\",\"value\":\"2d\"}"));
    assert!(contains(@uri, @"{\"trait_type\":\"Provisional\",\"value\":\"No\"}"));
    assert!(contains(@uri, @"\"trait_type\":\"Games\",\"display_type\":\"number\",\"value\":40}"));
    assert!(contains(@uri, @"\"trait_type\":\"Wins\",\"display_type\":\"number\",\"value\":30}"));
    assert!(contains(@uri, @"\"trait_type\":\"Losses\",\"display_type\":\"number\",\"value\":9}"));
    assert!(contains(@uri, @"\"trait_type\":\"Draws\",\"display_type\":\"number\",\"value\":1}"));
    // The SVG's `%` is escaped for two URIs, and nothing else needs to be.
    assert!(contains(@uri, @"text-anchor='start'>DAN</text>"));
    // Nothing in the SVG needs escaping in either URI.
    assert_eq!((count(@uri, '%'), count(@uri, '#')), (0, 0));
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('No rated game yet', 'ENTRYPOINT_FAILED'))]
fn no_card_before_a_rated_game() {
    let (_, _, cards) = setup();
    cards.mint(black());
}

#[test]
#[available_gas(100000000000)]
fn rated_players_get_a_card_that_follows_their_rating() {
    let (api, ratings, cards) = setup();
    one_game(api);
    // Anyone may send it; it goes to the player.
    cards.mint(black());
    cards.mint(white());
    assert_eq!(erc721(cards).owner_of(token(black())), black());
    assert_eq!(erc721(cards).balance_of(white()), 1);
    assert!(cards.locked(token(black())));
    assert_eq!(metadata(cards).name(), "Surround Rank Card");
    // The card is the rating as it stands.
    let rating = ratings.player(GO, black());
    let card = Card {
        player: black().into(),
        shown: rating.shown,
        provisional: rating.provisional,
        games: 1,
        wins: 1,
        losses: 0,
        draws: 0,
    };
    assert_eq!(cards.svg(token(black())), render::svg(@card));
    assert_eq!(metadata(cards).token_uri(token(black())), render::token_uri(@card));
    let uri = metadata(cards).token_uri(token(black()));
    assert!(contains(@uri, @"\"trait_type\":\"Wins\",\"display_type\":\"number\",\"value\":1}"));
    let uri = metadata(cards).token_uri(token(white()));
    assert!(contains(@uri, @"\"trait_type\":\"Losses\",\"display_type\":\"number\",\"value\":1}"));

    // A second rated game, on fresh session keys: the card changes with no
    // call to it.
    let now = get_block_timestamp();
    let t = Ticket { nonce: 2, issued_at: now - 30, expires_at: now + 270, ..ticket(api) };
    let terms = rekeyed(ticket_terms(@t), session_keys(1));
    open_with(api, terms, t);
    played_out_by(session_keys(1), api, terms.game_id, now + 60);
    api.rate(terms.game_id, t);
    assert_eq!(ratings.player(GO, black()).games, 2);
    let uri = metadata(cards).token_uri(token(black()));
    assert!(contains(@uri, @"\"trait_type\":\"Games\",\"display_type\":\"number\",\"value\":2}"));
    assert!(contains(@uri, @"\"trait_type\":\"Wins\",\"display_type\":\"number\",\"value\":2}"));
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Card already minted', 'ENTRYPOINT_FAILED'))]
fn one_card_a_player() {
    let (api, _, cards) = setup();
    one_game(api);
    cards.mint(black());
    cards.mint(black());
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Rank cards are soulbound', 'ENTRYPOINT_FAILED'))]
fn the_owner_cannot_transfer_a_card() {
    let (api, _, cards) = setup();
    one_game(api);
    cards.mint(black());
    caller(black());
    erc721(cards).transfer_from(black(), white(), token(black()));
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Rank cards are soulbound', 'ENTRYPOINT_FAILED'))]
fn an_approved_operator_cannot_transfer_a_card() {
    let (api, _, cards) = setup();
    one_game(api);
    cards.mint(black());
    caller(black());
    erc721(cards).set_approval_for_all(white(), true);
    caller(white());
    erc721(cards).safe_transfer_from(black(), white(), token(black()), array![].span());
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('No card for an AI', 'ENTRYPOINT_FAILED'))]
fn an_ai_anchor_gets_no_card() {
    let (api, ratings, cards) = setup();
    let admin = get_contract_address();
    caller(ratings_owner());
    ratings.set_anchor(GO, white(), 1132924713);
    caller(admin);
    let t = Ticket { band_1: 0, ..ticket(api) };
    let id = open(api, t);
    played_out(api, id, get_block_timestamp() + 60);
    api.rate(id, t);
    cards.mint(white());
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Unknown card', 'ENTRYPOINT_FAILED'))]
fn an_unminted_card_has_no_image() {
    let (_, _, cards) = setup();
    metadata(cards).token_uri(token(black()));
}

#[test]
#[available_gas(100000000000)]
fn reads_stay_far_inside_call_limits() {
    let (api, _, cards) = setup();
    one_game(api);
    cards.mint(black());
    let before = core::testing::get_available_gas();
    metadata(cards).token_uri(token(black()));
    let used = before - core::testing::get_available_gas();
    // Juno allows a call 100M gas.
    assert!(used < 20_000_000, "token_uri used {used} gas");
}
