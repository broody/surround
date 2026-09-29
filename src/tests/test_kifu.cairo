//! Kifu: settled ranked games mint to their winners, a record packs every step
//! losslessly and canonically, and the image, SGF and metadata render from it.
use dojo::model::{ModelStorage, ModelStorageTest};
use dojo::world::{WorldStorage, WorldStorageTrait};
use openzeppelin_interfaces::erc721::{
    IERC721Dispatcher, IERC721DispatcherTrait, IERC721MetadataDispatcher,
    IERC721MetadataDispatcherTrait,
};
use referee::clocks::{Standard, encode};
use referee::{
    Envelope, Move, REASON_ABANDON, REASON_TIMEOUT, checkpoint_hash, context_hash, force,
    state_hash,
};
use starknet::testing::set_block_timestamp;
use surround_rules::fixtures::{self, ReplayFixture};
use surround_rules::go::{AGREEMENT, GoAction, GoConfig, GoRules, GoState, PLAYED_OUT};
use surround_rules::replay::{config, game_steps, go, opening_history, pass, stone};
use surround_rules::rules::{self, Bits, NO_POINT, Position};
use crate::kifu::record;
use crate::kifu::render::{self, Game};
use crate::models::{Kifu, KifuSummary, RatedGame, Settlement};
use crate::systems::channel::IChannelDispatcherTrait;
use crate::systems::kifu::{IKifuDispatcher, IKifuDispatcherTrait};
use super::test_channel::{
    WINDOW, approvals, black, caller, deploy, every, keeper, no_approvals, opening, ranked,
    stamp_game, started_in, white,
};

const MAX_U128: u128 = 0xffffffffffffffffffffffffffffffff;
/// When these games settle, in Unix seconds: 2026-09-24 12:00 UTC.
const SETTLED_AT: u64 = 1790251200;
/// The largest felt, P - 1.

pub fn kifu_in(world: WorldStorage) -> IKifuDispatcher {
    let (contract_address, _) = world.dns(@"kifu").unwrap();
    IKifuDispatcher { contract_address }
}

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
    let mut total = 0;
    for i in 0..haystack.len() {
        if haystack[i] == byte {
            total += 1;
        }
    }
    total
}

/// Play `steps` on the per-turn timer, one stamp every 59 s, and settle them.
/// The flagged or losing seat need not approve: an unapproved history settles
/// after the dispute window.
fn settle_ranked(
    config: GoConfig, steps: Span<Move<GoAction>>, approved: bool,
) -> (WorldStorage, felt252, Envelope<GoState>) {
    let world = deploy();
    let (api, id) = started_in(world, config, ranked());
    rank(world, id);
    let terms = api.terms(id);
    let (batch, end) = stamp_game(
        @terms, opening(@terms), opening_history(@terms.config), steps, every(59000, steps),
    );
    let acks = if approved {
        let context = context_hash::<GoRules>(@terms);
        approvals(checkpoint_hash::<GoRules>(context, 0, state_hash::<GoRules>(@end)))
    } else {
        no_approvals()
    };
    caller(keeper());
    if approved {
        set_block_timestamp(SETTLED_AT);
    }
    api.submit_history(id, 0, opening(@terms), opening_history(@terms.config), batch, acks);
    if !approved {
        set_block_timestamp(SETTLED_AT + WINDOW.into());
        api.resolve_dispute(id, 0);
    }
    (world, id, end)
}

/// Mark game `id` ranked, as `create_rated_channel` does: only games created
/// from a matchmaker's ticket mint a kifu.
fn rank(world: WorldStorage, id: felt252) {
    let mut world = world;
    world.write_model_test(@RatedGame { game_id: id, ticket: 1, times: 0 });
}

fn recorded(
    fixture: @ReplayFixture,
) -> (WorldStorage, felt252, Span<Move<GoAction>>, Envelope<GoState>) {
    let steps = game_steps(fixture);
    let (world, id, end) = settle_ranked(config(fixture), steps, true);
    (world, id, steps, end)
}

fn packed(fixture: @ReplayFixture) -> Array<felt252> {
    record::encode(*fixture.size, game_steps(fixture), *fixture.final_board)
}

fn game(fixture: @ReplayFixture) -> Game {
    let steps = game_steps(fixture);
    Game {
        id: 7,
        size: *fixture.size,
        komi_half: *fixture.komi_half,
        black: black().into(),
        white: white().into(),
        winner: if *fixture.margin_half > 0 {
            1
        } else {
            2
        },
        reason: AGREEMENT,
        clock: encode(
            @Standard { turn_ms: 60000, bank_ms: 0, increment_ms: 0, byoyomi: Option::None },
        ),
        settled_at: 1790208000,
        record: record::decode(*fixture.size, steps.len(), packed(fixture).span()),
    }
}

// Records

#[test]
fn every_step_kind_round_trips() {
    let steps = array![
        stone(0), stone(360), pass(),
        go(
            GoAction::Propose(
                Bits { low: MAX_U128, mid: MAX_U128, high: 0x1ffffffffffffffffffffffffff },
            ),
        ),
        go(GoAction::Resume), go(GoAction::Propose(Bits { low: 0, mid: 0, high: 0 })),
        go(GoAction::Accept), Move::Resign(0), Move::Resign(1), Move::Flag, Move::Start,
        Move::Start, stone(180),
    ]
        .span();
    let packed = record::encode(19, steps, rules::empty_position());
    assert_eq!(record::decode(19, steps.len(), packed.span()).steps.span(), steps);
}

#[test]
fn a_felt_holds_37_9x9_33_13x13_or_29_19x19_steps() {
    for (size, fit) in array![(9_u8, 37_u32), (13, 33), (19, 29)] {
        let mut steps = array![];
        for _ in 0..fit {
            steps.append(pass());
        }
        let empty = rules::empty_position();
        assert_eq!(record::encode(size, steps.span(), empty).len(), 1);
        steps.append(pass());
        assert_eq!(record::encode(size, steps.span(), empty).len(), 2);
    }
}

#[test]
fn recorded_games_pack_into_a_few_felts() {
    // Steps: 68 and 81 on 9x9, 203 and 207 on 13x13, 311 (34 stones agreed
    // dead) and 319 on 19x19; each with its final position.
    let games = array![
        (fixtures::cgos_9_1682833(), 3_u32), (fixtures::cgos_9_1682827(), 3),
        (fixtures::cgos_13_277988(), 7), (fixtures::cgos_13_277982(), 7),
        (fixtures::kgs_2019_04_10_39(), 14), (fixtures::kgs_2019_04_26_17(), 13),
    ];
    for (fixture, felts) in games {
        let steps = game_steps(@fixture);
        let packed = packed(@fixture);
        assert_eq!(packed.len(), felts);
        let unpacked = record::decode(fixture.size, steps.len(), packed.span());
        assert_eq!(unpacked.steps.span(), steps);
        assert_eq!(unpacked.board, fixture.final_board);
    }
}

#[test]
fn the_walk_keeps_referees_turn_order() {
    // Scoring resumed once: black plays, white and black pass, white proposes,
    // black resumes and white is due; then two passes play the game out.
    let steps = array![
        stone(0), pass(), pass(), go(GoAction::Propose(rules::empty_bits())), go(GoAction::Resume),
        stone(1), pass(), pass(),
    ]
        .span();
    let config = GoConfig { size: 9, komi_half: 13 };
    let mut state = GoRules::init(@config);
    let mut scratch = Default::default();
    let mut expected = array![];
    for step in steps {
        if let Move::Play(action) = *step {
            let color = state.next_player;
            match action {
                GoAction::Play(point) => expected.append((color, point)),
                GoAction::Pass => expected.append((color, NO_POINT)),
                _ => {},
            }
            let (next, _) = GoRules::apply(@config, ref scratch, state, color - 1, action);
            state = next;
        }
    }
    let walk = record::walk(steps);
    assert_eq!(walk.moves.span(), expected.span());
    assert_eq!(
        expected.span(),
        array![(1, 0), (2, NO_POINT), (1, NO_POINT), (2, 1), (1, NO_POINT), (2, NO_POINT)].span(),
    );
    assert!(walk.scored);
    assert_eq!(walk.dead, rules::empty_bits());
    assert_eq!(state.finish_reason, PLAYED_OUT);
}

#[test]
#[should_panic(expected: ('Noncanonical record',))]
fn leftover_digits_are_rejected() {
    // Play(1) and its stone pack to [1 + 89]; 1 + 2 * 89 hides one more digit.
    record::decode(9, 1, array![1 + 2 * 89].span());
}

#[test]
#[should_panic(expected: ('Noncanonical record',))]
fn trailing_felts_are_rejected() {
    record::decode(9, 1, array![1, 0].span());
}

#[test]
#[should_panic(expected: ('Record too short',))]
fn missing_felts_are_rejected() {
    record::decode(9, 39, array![0].span());
}

#[test]
#[should_panic(expected: ('Unencodable step',))]
fn off_board_points_are_rejected() {
    record::encode(9, array![stone(81)].span(), rules::empty_position());
}

// Rendering

#[test]
fn sgf_records_every_move() {
    let fixture = fixtures::cgos_9_1682833();
    let mut game = game(@fixture);
    let sgf = render::sgf(ref game);
    assert!(contains(@sgf, @"(;GM[1]FF[4]CA[UTF-8]AP[Surround]SZ[9]KM[7]"));
    assert!(contains(@sgf, @"DT[2026-09-24]RE[W+2]"));
    // Black opens at point 40, the center (column e, row e); white answers at 29.
    assert!(contains(@sgf, @"RE[W+2];B[ee];W[cd];"));
    // 64 stones and 2 passes after the root node.
    assert_eq!(count(@sgf, ';'), 1 + 66);
    assert!(contains(@sgf, @";B[];W[])"));
}

#[test]
fn svg_draws_dead_stones_territory_and_move_numbers() {
    let fixture = fixtures::kgs_2019_04_10_39();
    let mut game = game(@fixture);
    let svg = render::svg(ref game);
    assert!(contains(@svg, @"viewBox='-1 -3 21 25'"));
    assert!(contains(@svg, @">B+1.5</text>"));
    assert!(contains(@svg, @"<g opacity='.4'>"));
    assert!(contains(@svg, @"<g stroke-linecap='square'>"));
    assert!(contains(@svg, @"SURROUND KIFU #7"));
    assert!(contains(@svg, @"309 moves  2026-09-24"));
    assert_eq!(count(@svg, '#'), 1);
    assert_eq!(count(@svg, '%'), 0);
    assert_eq!(count(@svg, '"'), 0);
}

#[test]
fn an_unknown_date_is_left_out() {
    let fixture = fixtures::cgos_9_1682833();
    let mut game = game(@fixture);
    game.settled_at = 0;
    assert!(!contains(@render::sgf(ref game), @"DT["));
    assert!(contains(@render::svg(ref game), @"66 moves</text>"));
    assert!(!contains(@render::token_uri(ref game), @"Date"));
}

#[test]
fn metadata_is_a_json_data_uri() {
    let mut game = game(@fixtures::kgs_2019_04_10_39());
    let uri = render::token_uri(ref game);
    assert!(contains(@uri, @"data:application/json,{\"name\":\"Surround Kifu %237\""));
    assert!(contains(@uri, @"SURROUND KIFU %25237"));
    assert!(
        contains(@uri, @"\"image\":\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'"),
    );
    // The fixture's captures, as the record gives them.
    assert!(contains(@uri, @"Black captures\",\"display_type\":\"number\",\"value\":15}"));
    assert!(contains(@uri, @"White captures\",\"display_type\":\"number\",\"value\":10}"));
    // Every `#` is escaped, and every `%` escapes one.
    assert_eq!(count(@uri, '#'), 0);
    assert_eq!(count(@uri, '%'), 2);
}

// Minting

#[test]
#[available_gas(1000000000000)]
fn ranked_game_mints_to_its_winner() {
    let fixture = fixtures::cgos_9_1682827();
    let (world, id, steps, end) = recorded(@fixture);
    let kifu = kifu_in(world);
    let packed = record::encode(9, steps, end.game.board);
    // Anyone may mint, a month later; the token goes to the winner, black, and
    // is dated by the settlement.
    set_block_timestamp(SETTLED_AT + 30 * 86400);
    caller(keeper());
    kifu.mint(id, end, packed.span());
    let token = IERC721Dispatcher { contract_address: kifu.contract_address };
    assert_eq!(token.owner_of(id.into()), black());
    assert_eq!(token.balance_of(black()), 1);
    assert_eq!(token.balance_of(white()), 0);
    let stored: Kifu = world.read_model(id);
    assert_eq!(stored.record, packed.span());
    let expected = KifuSummary {
        game_id: id,
        black: black(),
        white: white(),
        winner: black(),
        loser: white(),
        size: 9,
        komi_half: fixture.komi_half,
        moves: 79,
        reason: AGREEMENT,
        black_score_half: end.game.black_half,
        white_score_half: end.game.white_half,
        black_captures: fixture.black_captures,
        white_captures: fixture.white_captures,
        settled_at: SETTLED_AT,
    };
    assert_eq!(kifu.summary(id.into()), expected);
    assert_eq!(kifu.steps(id.into()), steps);
    assert!(contains(@kifu.svg(id.into()), @">B+8</text>"));
    assert!(contains(@kifu.sgf(id.into()), @"DT[2026-09-24]RE[B+8]"));
    let metadata = IERC721MetadataDispatcher { contract_address: kifu.contract_address };
    assert_eq!(metadata.name(), "Surround Kifu");
    assert_eq!(metadata.symbol(), "KIFU");
    assert!(contains(@metadata.token_uri(id.into()), @"data:application/json,{"));
}

#[test]
#[available_gas(100000000000)]
fn a_flag_mints_to_the_other_seat() {
    // Black plays; white lets its 60 s run out and the referee flags it.
    let steps = array![stone(40), Move::Flag].span();
    let world = deploy();
    let (api, id) = started_in(world, GoConfig { size: 9, komi_half: 13 }, ranked());
    rank(world, id);
    let terms = api.terms(id);
    let (batch, end) = stamp_game(
        @terms, opening(@terms), opening_history(@terms.config), steps, array![1000, 61001].span(),
    );
    caller(black());
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
    set_block_timestamp(WINDOW.into());
    api.resolve_dispute(id, 0);
    let kifu = kifu_in(world);
    kifu.mint(id, end, record::encode(9, steps, end.game.board).span());
    let token = IERC721Dispatcher { contract_address: kifu.contract_address };
    assert_eq!(token.owner_of(id.into()), black());
    assert!(contains(@kifu.sgf(id.into()), @"RE[B+T];B[ee])"));
    let summary = kifu.summary(id.into());
    assert_eq!((summary.winner, summary.loser), (black(), white()));
    assert_eq!((summary.reason, summary.moves, summary.black_score_half), (REASON_TIMEOUT, 1, 0));
    assert_eq!(summary.settled_at, 3600);
}

#[test]
#[available_gas(100000000000)]
fn forced_play_is_dated_by_its_settlement() {
    // The referee is down: black disputes, the window resolves into forced
    // play, black plays and white never answers.
    let config = GoConfig { size: 9, komi_half: 13 };
    let world = deploy();
    let (api, id) = started_in(world, config, ranked());
    rank(world, id);
    let terms = api.terms(id);
    caller(black());
    api.open_dispute(id, 0);
    set_block_timestamp(WINDOW.into());
    api.resolve_dispute(id, 0);
    let steps = array![stone(40)].span();
    api.force_steps(id, 1, opening(@terms), opening_history(@config), steps);
    let end = force::<
        GoRules,
    >(context_hash::<GoRules>(@terms), @terms, opening(@terms), opening_history(@config), 0, steps);
    // Forced steps carry no referee stamp, and nothing is settled yet.
    assert_eq!(end.clock.unwrap().stamp, 0);
    let settlement: Settlement = world.read_model(id);
    assert_eq!(settlement.timestamp, 0);
    set_block_timestamp(SETTLED_AT);
    api.claim_timeout(id, 2);
    let settlement: Settlement = world.read_model(id);
    assert_eq!(settlement.timestamp, SETTLED_AT);
    let kifu = kifu_in(world);
    kifu.mint(id, end, record::encode(9, steps, end.game.board).span());
    let summary = kifu.summary(id.into());
    assert_eq!((summary.winner, summary.reason), (black(), REASON_ABANDON));
    assert_eq!(summary.settled_at, SETTLED_AT);
    assert!(contains(@kifu.sgf(id.into()), @"DT[2026-09-24]RE[B+F];B[ee])"));
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('No winner', 'ENTRYPOINT_FAILED'))]
fn a_draw_has_no_kifu() {
    // No komi and no stones: both sides score nothing.
    let steps = array![
        pass(), pass(), go(GoAction::Propose(Bits { low: 0, mid: 0, high: 0 })),
        go(GoAction::Accept),
    ]
        .span();
    let (world, id, end) = settle_ranked(GoConfig { size: 9, komi_half: 0 }, steps, true);
    kifu_in(world).mint(id, end, record::encode(9, steps, end.game.board).span());
}

#[test]
#[available_gas(1000000000000)]
#[should_panic(expected: ('Not a ranked game', 'ENTRYPOINT_FAILED'))]
fn casual_games_have_no_kifu() {
    let fixture = fixtures::cgos_9_1682833();
    let world = deploy();
    let (api, id) = started_in(world, config(@fixture), Option::None);
    let terms = api.terms(id);
    let steps = game_steps(@fixture);
    let (batch, end) = stamp_game(
        @terms, opening(@terms), opening_history(@terms.config), steps, array![].span(),
    );
    let context = context_hash::<GoRules>(@terms);
    let acks = approvals(checkpoint_hash::<GoRules>(context, 0, state_hash::<GoRules>(@end)));
    api.submit_history(id, 0, opening(@terms), opening_history(@terms.config), batch, acks);
    kifu_in(world).mint(id, end, record::encode(9, steps, end.game.board).span());
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Game not settled', 'ENTRYPOINT_FAILED'))]
fn unsettled_games_have_no_kifu() {
    let world = deploy();
    let (api, id) = started_in(world, GoConfig { size: 9, komi_half: 13 }, ranked());
    rank(world, id);
    kifu_in(world).mint(id, opening(@api.terms(id)), array![].span());
}

#[test]
#[available_gas(1000000000000)]
#[should_panic(expected: ('Kifu already minted', 'ENTRYPOINT_FAILED'))]
fn a_game_mints_once() {
    let fixture = fixtures::cgos_9_1682827();
    let (world, id, steps, end) = recorded(@fixture);
    let kifu = kifu_in(world);
    let packed = record::encode(9, steps, end.game.board);
    kifu.mint(id, end, packed.span());
    kifu.mint(id, end, packed.span());
}

#[test]
#[available_gas(1000000000000)]
#[should_panic(expected: ('Wrong move record', 'ENTRYPOINT_FAILED'))]
fn an_altered_record_is_rejected() {
    let fixture = fixtures::cgos_9_1682827();
    let (world, id, steps, end) = recorded(@fixture);
    // Black's first two stones swapped: same steps, same final position.
    let mut altered = array![*steps[2], *steps[1], *steps[0]];
    altered.append_span(steps.slice(3, steps.len() - 3));
    kifu_in(world).mint(id, end, record::encode(9, altered.span(), end.game.board).span());
}

#[test]
#[available_gas(1000000000000)]
#[should_panic(expected: ('Wrong anchor state', 'ENTRYPOINT_FAILED'))]
fn only_the_settled_state_mints() {
    let fixture = fixtures::cgos_9_1682827();
    let (world, id, steps, end) = recorded(@fixture);
    let mut other = end;
    other.game.black_half += 2;
    kifu_in(world).mint(id, other, record::encode(9, steps, end.game.board).span());
}

#[test]
#[available_gas(1000000000000)]
#[should_panic(expected: ('Wrong final position', 'ENTRYPOINT_FAILED'))]
fn only_the_settled_position_mints() {
    let fixture = fixtures::cgos_9_1682827();
    let (world, id, steps, end) = recorded(@fixture);
    // The first stone, still on the board, left out.
    let mut board: Position = end.game.board;
    board.black = rules::subtract(board.black, position(40));
    kifu_in(world).mint(id, end, record::encode(9, steps, board).span());
}

fn position(point: u16) -> Bits {
    let mut bits = rules::empty_bits();
    rules::insert(ref bits, point);
    bits
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Not a ranked game', 'ENTRYPOINT_FAILED'))]
fn a_timed_game_without_a_ticket_has_no_kifu() {
    // Timed with its own referee key, but not paired by the matchmaker.
    let steps = array![stone(40), Move::Flag].span();
    let world = deploy();
    let (api, id) = started_in(world, GoConfig { size: 9, komi_half: 13 }, ranked());
    let terms = api.terms(id);
    let (batch, end) = stamp_game(
        @terms, opening(@terms), opening_history(@terms.config), steps, array![1000, 61001].span(),
    );
    caller(black());
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
    set_block_timestamp(WINDOW.into());
    api.resolve_dispute(id, 0);
    kifu_in(world).mint(id, end, record::encode(9, steps, end.game.board).span());
}
