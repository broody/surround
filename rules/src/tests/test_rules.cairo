use crate::rules::{self, BLACK, EMPTY, Position, WHITE};

fn position(black: Span<u16>, white: Span<u16>) -> Position {
    let mut board = rules::empty_position();
    for p in black {
        rules::insert(ref board.black, *p);
    }
    for p in white {
        rules::insert(ref board.white, *p);
    }
    board
}

#[test]
fn empty_board_scores_only_komi() {
    let score = rules::score(rules::empty_position(), 9, rules::empty_bits(), 13);
    assert_eq!(score.black_half, 0);
    assert_eq!(score.white_half, 13);
}

#[test]
fn bitsets_cover_limb_boundaries() {
    let mut bits = rules::empty_bits();
    for p in array![0, 127, 128, 255, 256, 360, 383].span() {
        rules::insert(ref bits, *p);
    }
    for p in array![0, 127, 128, 255, 256, 360, 383].span() {
        assert!(rules::contains(bits, *p));
    }
    assert!(!rules::contains(bits, 126));
    assert!(!rules::contains(bits, 359));
    assert_eq!(rules::subtract(bits, bits), rules::empty_bits());
}

#[test]
fn corners_and_edges_do_not_wrap() {
    let mut corner = rules::neighbors(0, 9);
    assert_eq!(corner.pop_front().unwrap(), 9);
    assert_eq!(corner.pop_front().unwrap(), 1);
    assert!(corner.is_empty());
    let mut edge = rules::neighbors(8, 9);
    assert_eq!(edge.pop_front().unwrap(), 17);
    assert_eq!(edge.pop_front().unwrap(), 7);
    assert!(edge.is_empty());
    assert_eq!(rules::neighbors(10, 9).len(), 4);
}

#[test]
fn capture_at_corner() {
    let board = position(array![1].span(), array![0].span());
    let (board, captured) = rules::play(board, 9, BLACK, 9);
    assert_eq!(captured, 1);
    assert_eq!(rules::stone_at(board, 0), EMPTY);
    assert_eq!(rules::stone_at(board, 9), BLACK);
}

#[test]
fn captures_multiple_groups_before_suicide_check() {
    let board = position(array![2, 10, 18].span(), array![1, 9].span());
    let (board, captured) = rules::play(board, 9, BLACK, 0);
    assert_eq!(captured, 2);
    assert_eq!(rules::stone_at(board, 1), EMPTY);
    assert_eq!(rules::stone_at(board, 9), EMPTY);
    assert_eq!(rules::stone_at(board, 0), BLACK);
}

#[test]
fn touching_the_same_group_twice_counts_it_once() {
    let board = position(array![2, 18].span(), array![0, 1, 9].span());
    let (board, captured) = rules::play(board, 9, BLACK, 10);
    assert_eq!(captured, 3);
    assert_eq!(board.white, rules::empty_bits());
}

#[test]
#[should_panic(expected: ('Suicide prohibited',))]
fn suicide_is_rejected() {
    rules::play(position(array![].span(), array![1, 9].span()), 9, BLACK, 0);
}

#[test]
#[should_panic(expected: ('Point occupied',))]
fn occupied_point_is_rejected() {
    rules::play(position(array![40].span(), array![].span()), 9, WHITE, 40);
}

#[test]
#[should_panic(expected: ('Point out of bounds',))]
fn off_board_move_is_rejected() {
    rules::play(rules::empty_position(), 9, BLACK, 81);
}

#[test]
fn shared_empty_region_is_neutral() {
    let board = position(array![0].span(), array![80].span());
    let score = rules::score(board, 9, rules::empty_bits(), 13);
    assert_eq!(score.black_half, 2);
    assert_eq!(score.white_half, 15);
}

#[test]
fn enclosed_corner_counts_with_board_edge_as_boundary() {
    let board = position(array![1, 9].span(), array![80].span());
    let score = rules::score(board, 9, rules::empty_bits(), 0);
    assert_eq!(score.black_half, 6);
    assert_eq!(score.white_half, 2);
}

#[test]
fn agreed_dead_stones_change_area_without_capture_bonus() {
    let board = position(array![2, 10, 18].span(), array![0, 80].span());
    let initial = rules::score(board, 9, rules::empty_bits(), 0);
    assert_eq!(initial.black_half, 6);
    assert_eq!(initial.white_half, 4);
    let dead = rules::mark_group(board, 9, rules::empty_bits(), 0, true);
    let final_score = rules::score(board, 9, dead, 0);
    assert_eq!(final_score.black_half, 12);
    assert_eq!(final_score.white_half, 2);
    assert_eq!(rules::stone_at(board, 0), WHITE);
}

#[test]
fn markings_apply_to_whole_groups_and_can_be_reversed() {
    let board = position(array![2, 10, 18].span(), array![0, 1, 80].span());
    let dead = rules::mark_group(board, 9, rules::empty_bits(), 0, true);
    assert!(rules::contains(dead, 0));
    assert!(rules::contains(dead, 1));
    assert!(!rules::contains(dead, 80));
    let dead = rules::mark_group(board, 9, dead, 1, false);
    assert_eq!(dead, rules::empty_bits());
}

#[test]
#[should_panic(expected: ('Partial dead group',))]
fn scorer_rejects_partial_group_witness() {
    let board = position(array![2, 10, 18].span(), array![0, 1, 80].span());
    let mut dead = rules::empty_bits();
    rules::insert(ref dead, 0);
    rules::score(board, 9, dead, 0);
}

#[test]
#[should_panic(expected: ('Dead point is empty',))]
fn scorer_rejects_dead_empty_point() {
    let mut dead = rules::empty_bits();
    rules::insert(ref dead, 0);
    rules::score(rules::empty_position(), 9, dead, 0);
}

#[test]
#[should_panic(expected: ('Board padding occupied',))]
fn scorer_rejects_hidden_padding_stones() {
    let board = position(array![361].span(), array![].span());
    rules::score(board, 19, rules::empty_bits(), 0);
}

#[test]
fn nineteen_by_nineteen_counts_all_three_limbs() {
    let mut board = rules::empty_position();
    let mut row: u16 = 0;
    while row < 19 {
        rules::insert(ref board.black, row * 19);
        rules::insert(ref board.white, row * 19 + 18);
        row += 1;
    }
    let score = rules::score(board, 19, rules::empty_bits(), 15);
    assert_eq!(score.black_half, 38);
    assert_eq!(score.white_half, 53);
}

#[test]
fn thirteen_by_thirteen_counts_full_board() {
    let board = position(array![168].span(), array![].span());
    let score = rules::score(board, 13, rules::empty_bits(), 13);
    assert_eq!(score.black_half, 338);
    assert_eq!(score.white_half, 13);
}

#[test]
#[available_gas(500000000)]
fn nineteen_by_nineteen_large_capture() {
    let mut board = rules::empty_position();
    let mut point: u16 = 0;
    while point < 361 {
        if point / 19 == 0 || point / 19 == 18 || point % 19 == 0 || point % 19 == 18 {
            rules::insert(ref board.black, point);
        } else if point != 20 {
            rules::insert(ref board.white, point);
        }
        point += 1;
    }
    let (board, captured) = rules::play(board, 19, BLACK, 20);
    assert_eq!(captured, 288);
    assert_eq!(board.white, rules::empty_bits());
    let score = rules::score(board, 19, rules::empty_bits(), 15);
    assert_eq!(score.black_half, 722);
    assert_eq!(score.white_half, 15);
}

#[test]
fn position_commitment_includes_board_size_and_colors() {
    let board = position(array![0].span(), array![].span());
    let swapped = position(array![].span(), array![0].span());
    assert!(rules::position_hash(board, 9) != rules::position_hash(board, 19));
    assert!(rules::position_hash(board, 9) != rules::position_hash(swapped, 9));
}
