//! Surround rules v1: area scoring, positional superko (enforced by the system),
//! no suicide, no handicap, player-agreed removal of complete connected groups.
use core::num::traits::WideMul;
use core::poseidon::poseidon_hash_span;

pub const EMPTY: u8 = 0;
pub const BLACK: u8 = 1;
pub const WHITE: u8 = 2;
pub const RULES_VERSION: u16 = 1;
pub const NO_POINT: u16 = 361;

// 384 bits, of which at most 361 are used. Six u128s hold the entire board.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct Bits {
    pub low: u128,
    pub mid: u128,
    pub high: u128,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct Position {
    pub black: Bits,
    pub white: Bits,
}

#[derive(Copy, Drop, Serde, PartialEq)]
pub struct Score {
    pub black_half: u16,
    pub white_half: u16,
}

pub fn empty_bits() -> Bits {
    Bits { low: 0, mid: 0, high: 0 }
}

pub fn empty_position() -> Position {
    Position { black: empty_bits(), white: empty_bits() }
}

// 2^i for i < 128.
const POWERS: [u128; 128] = [
    0x1, 0x2, 0x4, 0x8, 0x10, 0x20, 0x40, 0x80, 0x100, 0x200, 0x400, 0x800, 0x1000, 0x2000, 0x4000,
    0x8000, 0x10000, 0x20000, 0x40000, 0x80000, 0x100000, 0x200000, 0x400000, 0x800000, 0x1000000,
    0x2000000, 0x4000000, 0x8000000, 0x10000000, 0x20000000, 0x40000000, 0x80000000, 0x100000000,
    0x200000000, 0x400000000, 0x800000000, 0x1000000000, 0x2000000000, 0x4000000000, 0x8000000000,
    0x10000000000, 0x20000000000, 0x40000000000, 0x80000000000, 0x100000000000, 0x200000000000,
    0x400000000000, 0x800000000000, 0x1000000000000, 0x2000000000000, 0x4000000000000,
    0x8000000000000, 0x10000000000000, 0x20000000000000, 0x40000000000000, 0x80000000000000,
    0x100000000000000, 0x200000000000000, 0x400000000000000, 0x800000000000000, 0x1000000000000000,
    0x2000000000000000, 0x4000000000000000, 0x8000000000000000, 0x10000000000000000,
    0x20000000000000000, 0x40000000000000000, 0x80000000000000000, 0x100000000000000000,
    0x200000000000000000, 0x400000000000000000, 0x800000000000000000, 0x1000000000000000000,
    0x2000000000000000000, 0x4000000000000000000, 0x8000000000000000000, 0x10000000000000000000,
    0x20000000000000000000, 0x40000000000000000000, 0x80000000000000000000, 0x100000000000000000000,
    0x200000000000000000000, 0x400000000000000000000, 0x800000000000000000000,
    0x1000000000000000000000, 0x2000000000000000000000, 0x4000000000000000000000,
    0x8000000000000000000000, 0x10000000000000000000000, 0x20000000000000000000000,
    0x40000000000000000000000, 0x80000000000000000000000, 0x100000000000000000000000,
    0x200000000000000000000000, 0x400000000000000000000000, 0x800000000000000000000000,
    0x1000000000000000000000000, 0x2000000000000000000000000, 0x4000000000000000000000000,
    0x8000000000000000000000000, 0x10000000000000000000000000, 0x20000000000000000000000000,
    0x40000000000000000000000000, 0x80000000000000000000000000, 0x100000000000000000000000000,
    0x200000000000000000000000000, 0x400000000000000000000000000, 0x800000000000000000000000000,
    0x1000000000000000000000000000, 0x2000000000000000000000000000, 0x4000000000000000000000000000,
    0x8000000000000000000000000000, 0x10000000000000000000000000000,
    0x20000000000000000000000000000, 0x40000000000000000000000000000,
    0x80000000000000000000000000000, 0x100000000000000000000000000000,
    0x200000000000000000000000000000, 0x400000000000000000000000000000,
    0x800000000000000000000000000000, 0x1000000000000000000000000000000,
    0x2000000000000000000000000000000, 0x4000000000000000000000000000000,
    0x8000000000000000000000000000000, 0x10000000000000000000000000000000,
    0x20000000000000000000000000000000, 0x40000000000000000000000000000000,
    0x80000000000000000000000000000000,
];

// The limb holding `point` (0 = low, 1 = mid, 2 = high) and its mask in that limb.
fn locate(point: u16) -> (u8, u128) {
    let powers = POWERS.span();
    if point < 128 {
        (0, *powers[point.into()])
    } else if point < 256 {
        (1, *powers[(point - 128).into()])
    } else {
        assert(point < 384, 'Bit out of bounds');
        (2, *powers[(point - 256).into()])
    }
}

pub fn contains(bits: Bits, point: u16) -> bool {
    let (limb, mask) = locate(point);
    if limb == 0 {
        bits.low & mask != 0
    } else if limb == 1 {
        bits.mid & mask != 0
    } else {
        bits.high & mask != 0
    }
}

pub fn insert(ref bits: Bits, point: u16) {
    let (limb, mask) = locate(point);
    if limb == 0 {
        bits.low = bits.low | mask;
    } else if limb == 1 {
        bits.mid = bits.mid | mask;
    } else {
        bits.high = bits.high | mask;
    }
}

pub fn union(a: Bits, b: Bits) -> Bits {
    Bits { low: a.low | b.low, mid: a.mid | b.mid, high: a.high | b.high }
}

pub fn subtract(a: Bits, b: Bits) -> Bits {
    Bits {
        low: a.low ^ (a.low & b.low),
        mid: a.mid ^ (a.mid & b.mid),
        high: a.high ^ (a.high & b.high),
    }
}

pub fn intersect(a: Bits, b: Bits) -> Bits {
    Bits { low: a.low & b.low, mid: a.mid & b.mid, high: a.high & b.high }
}

fn single(point: u16) -> Bits {
    let mut bits = empty_bits();
    insert(ref bits, point);
    bits
}

// Board-shaped masks and shift multipliers. Points are row-major bits, so the
// neighbors of p are p ± 1 (within its row) and p ± width.
#[derive(Copy, Drop)]
struct Geometry {
    valid: Bits,
    // Destinations of an eastward (+1) or westward (-1) shift that stay in the row.
    not_first_column: Bits,
    not_last_column: Bits,
    // 2^width and 2^(128 - width), for shifting by a row.
    row_up: u128,
    row_down: u128,
}

fn geometry(size: u8) -> Geometry {
    if size == 9 {
        Geometry {
            valid: Bits { low: 0x1ffffffffffffffffffff, mid: 0, high: 0 },
            not_first_column: Bits { low: 0x1feff7fbfdfeff7fbfdfe, mid: 0, high: 0 },
            not_last_column: Bits { low: 0xff7fbfdfeff7fbfdfeff, mid: 0, high: 0 },
            row_up: 0x200,
            row_down: 0x800000000000000000000000000000,
        }
    } else if size == 13 {
        Geometry {
            valid: Bits { low: 0xffffffffffffffffffffffffffffffff, mid: 0x1ffffffffff, high: 0 },
            not_first_column: Bits {
                low: 0xffdffefff7ffbffdffefff7ffbffdffe, mid: 0x1ffefff7ffb, high: 0,
            },
            not_last_column: Bits {
                low: 0xffefff7ffbffdffefff7ffbffdffefff, mid: 0xfff7ffbffd, high: 0,
            },
            row_up: 0x2000,
            row_down: 0x80000000000000000000000000000,
        }
    } else {
        validate_size(size);
        Geometry {
            valid: Bits {
                low: 0xffffffffffffffffffffffffffffffff,
                mid: 0xffffffffffffffffffffffffffffffff,
                high: 0x1ffffffffffffffffffffffffff,
            },
            not_first_column: Bits {
                low: 0xfffbffff7fffeffffdffffbffff7fffe,
                mid: 0xff7fffeffffdffffbffff7fffeffffdf,
                high: 0x1ffffbffff7fffeffffdffffbff,
            },
            not_last_column: Bits {
                low: 0xfffdffffbffff7fffeffffdffffbffff,
                mid: 0xffbffff7fffeffffdffffbffff7fffef,
                high: 0xffffdffffbffff7fffeffffdff,
            },
            row_up: 0x80000,
            row_down: 0x2000000000000000000000000000,
        }
    }
}

// Full product as (high, low) halves.
fn u128_wide_mul(a: u128, b: u128) -> (u128, u128) {
    let product: u256 = a.wide_mul(b);
    (product.high, product.low)
}

// Shifts every point up by k, given factor = 2^k (0 < k < 128). Bits past 384 drop.
fn shift_up(bits: Bits, factor: u128) -> Bits {
    let (carry_low, low) = u128_wide_mul(bits.low, factor);
    let (carry_mid, mid) = u128_wide_mul(bits.mid, factor);
    let (_, high) = u128_wide_mul(bits.high, factor);
    Bits { low, mid: mid | carry_low, high: high | carry_mid }
}

// Shifts every point down by k, given factor = 2^(128 - k) (0 < k < 128).
fn shift_down(bits: Bits, factor: u128) -> Bits {
    let (low, _) = u128_wide_mul(bits.low, factor);
    let (mid, borrow_mid) = u128_wide_mul(bits.mid, factor);
    let (high, borrow_high) = u128_wide_mul(bits.high, factor);
    Bits { low: low | borrow_mid, mid: mid | borrow_high, high }
}

// Every on-board point orthogonally adjacent to a point in `bits`.
fn spread(bits: Bits, geometry: Geometry) -> Bits {
    let east = intersect(shift_up(bits, 2), geometry.not_first_column);
    let west = intersect(
        shift_down(bits, 0x80000000000000000000000000000000), geometry.not_last_column,
    );
    let south = intersect(shift_up(bits, geometry.row_up), geometry.valid);
    let north = shift_down(bits, geometry.row_down);
    union(union(east, west), union(south, north))
}

// Grows `start` through orthogonally connected points of `stones` until it
// touches `free`. Returns the whole group when it has no liberty.
fn liberty_search(start: Bits, stones: Bits, free: Bits, geometry: Geometry) -> (Bits, bool) {
    let mut group = start;
    let mut has_liberty = false;
    loop {
        let around = spread(group, geometry);
        if intersect(around, free) != empty_bits() {
            has_liberty = true;
            break;
        }
        let next = union(group, intersect(around, stones));
        if next == group {
            break;
        }
        group = next;
    }
    (group, has_liberty)
}

// Points of `through` connected to `seed` by orthogonal steps within `through`.
fn reach(seed: Bits, through: Bits, geometry: Geometry) -> Bits {
    let mut region = intersect(spread(seed, geometry), through);
    loop {
        let next = union(region, intersect(spread(region, geometry), through));
        if next == region {
            break;
        }
        region = next;
    }
    region
}

fn popcount_limb(value: u128) -> u16 {
    // Shifting right by k is the high half of a multiplication by 2^(128 - k).
    let (half, _) = u128_wide_mul(value, 0x80000000000000000000000000000000);
    let pairs = value - (half & 0x55555555555555555555555555555555);
    let (quarter, _) = u128_wide_mul(pairs, 0x40000000000000000000000000000000);
    let nibbles = (pairs & 0x33333333333333333333333333333333)
        + (quarter & 0x33333333333333333333333333333333);
    let (eighth, _) = u128_wide_mul(nibbles, 0x10000000000000000000000000000000);
    let bytes = (nibbles + eighth) & 0x0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f;
    let (_, sums) = u128_wide_mul(bytes, 0x01010101010101010101010101010101);
    let (total, _) = u128_wide_mul(sums, 0x100);
    total.try_into().unwrap()
}

pub fn popcount(bits: Bits) -> u16 {
    popcount_limb(bits.low) + popcount_limb(bits.mid) + popcount_limb(bits.high)
}

pub fn stone_at(board: Position, point: u16) -> u8 {
    if contains(board.black, point) {
        BLACK
    } else if contains(board.white, point) {
        WHITE
    } else {
        EMPTY
    }
}

pub fn other(color: u8) -> u8 {
    assert(color == BLACK || color == WHITE, 'Invalid color');
    3 - color
}

pub fn point_count(size: u8) -> u16 {
    let width: u16 = size.into();
    width * width
}

pub fn validate_size(size: u8) {
    assert(size == 9 || size == 13 || size == 19, 'Unsupported board size');
}

// Whether an orthogonal neighbor of an on-board `point` is in `bits`.
fn touches(bits: Bits, point: u16, size: u8) -> bool {
    let width: u16 = size.into();
    let column = point % width;
    (point >= width && contains(bits, point - width))
        || (point + width < width * width && contains(bits, point + width))
        || (column > 0 && contains(bits, point - 1))
        || (column + 1 < width && contains(bits, point + 1))
}

pub fn neighbors(point: u16, size: u8) -> Array<u16> {
    let width: u16 = size.into();
    assert(point < point_count(size), 'Point out of bounds');
    let mut result = array![];
    if point >= width {
        result.append(point - width);
    }
    if point + width < point_count(size) {
        result.append(point + width);
    }
    if point % width > 0 {
        result.append(point - 1);
    }
    if point % width + 1 < width {
        result.append(point + 1);
    }
    result
}

// Returns a whole group, whether it has any liberty, and its stone count.
pub fn group(board: Position, size: u8, start: u16) -> (Bits, bool, u16) {
    assert(start < point_count(size), 'Point out of bounds');
    let color = stone_at(board, start);
    assert(color != EMPTY, 'No group at point');
    let mut visited = empty_bits();
    insert(ref visited, start);
    let mut queue = array![start];
    let mut has_liberty = false;
    let mut count = 0;
    while let Some(point) = queue.pop_front() {
        count += 1;
        let mut adjacent = neighbors(point, size);
        while let Some(next) = adjacent.pop_front() {
            let neighbor_color = stone_at(board, next);
            if neighbor_color == EMPTY {
                has_liberty = true;
            } else if neighbor_color == color && !contains(visited, next) {
                insert(ref visited, next);
                queue.append(next);
            }
        }
    }
    (visited, has_liberty, count)
}

// Captures are resolved before testing the new group's liberties.
pub fn play(mut board: Position, size: u8, color: u8, point: u16) -> (Position, u16) {
    validate_size(size);
    assert(point < point_count(size), 'Point out of bounds');
    let opponent = other(color);
    assert(stone_at(board, point) == EMPTY, 'Point occupied');
    let geometry = geometry(size);
    let stone = single(point);
    let (own, mut opposing) = if color == BLACK {
        (union(board.black, stone), board.white)
    } else {
        (union(board.white, stone), board.black)
    };
    let mut free = subtract(geometry.valid, union(own, opposing));
    let mut captured = 0;
    let mut adjacent = neighbors(point, size);
    while let Some(next) = adjacent.pop_front() {
        // A captured group leaves `opposing`, so each group is removed once.
        // A stone next to a free point has a liberty without searching its group.
        if contains(opposing, next) && !touches(free, next, size) {
            let (stones, has_liberty) = liberty_search(single(next), opposing, free, geometry);
            if !has_liberty {
                opposing = subtract(opposing, stones);
                free = union(free, stones);
                captured += popcount(stones);
            }
        }
    }
    if !touches(free, point, size) {
        let (_, has_liberty) = liberty_search(stone, own, free, geometry);
        assert(has_liberty, 'Suicide prohibited');
    }
    if opponent == WHITE {
        board.black = own;
        board.white = opposing;
    } else {
        board.white = own;
        board.black = opposing;
    }
    (board, captured)
}

pub fn position_hash(board: Position, size: u8) -> felt252 {
    poseidon_hash_span(
        array![
            'SURROUND_POSITION_V1', size.into(), board.black.low.into(), board.black.mid.into(),
            board.black.high.into(), board.white.low.into(), board.white.mid.into(),
            board.white.high.into(),
        ]
            .span(),
    )
}

pub fn mark_group(board: Position, size: u8, dead: Bits, point: u16, is_dead: bool) -> Bits {
    let (stones, _, _) = group(board, size, point);
    let result = if is_dead {
        union(dead, stones)
    } else {
        subtract(dead, stones)
    };
    assert(result != dead, 'No marking change');
    result
}

// Dead masks are checked independently so the scorer can also be reused outside
// the Dojo system. A mask cannot include empty points or only part of a group.
pub fn score(board: Position, size: u8, dead: Bits, komi_half: u16) -> Score {
    validate_size(size);
    let geometry = geometry(size);
    let occupied = union(board.black, board.white);
    assert(subtract(dead, occupied) == empty_bits(), 'Dead point is empty');
    assert(subtract(occupied, geometry.valid) == empty_bits(), 'Board padding occupied');
    // A same-colored neighbor of a dead stone must also be dead. As in `stone_at`,
    // a point in both sets reads as black; such boards are rejected below.
    let white_only = subtract(board.white, board.black);
    let dead_black = intersect(dead, board.black);
    let dead_white = intersect(dead, white_only);
    let live_neighbors = union(
        intersect(spread(dead_black, geometry), subtract(board.black, dead)),
        intersect(spread(dead_white, geometry), subtract(white_only, dead)),
    );
    assert(live_neighbors == empty_bits(), 'Partial dead group');
    assert(subtract(board.black, board.white) == board.black, 'Overlapping stones');
    let black_stones = subtract(board.black, dead);
    let white_stones = subtract(board.white, dead);
    let free = subtract(geometry.valid, union(black_stones, white_stones));
    // An empty region scores for a player when it borders only that player's
    // stones. Mixed boundaries, or no stones at all, score for neither player.
    let near_black = reach(black_stones, free, geometry);
    let near_white = reach(white_stones, free, geometry);
    let black = popcount(black_stones) + popcount(subtract(near_black, near_white));
    let white = popcount(white_stones) + popcount(subtract(near_white, near_black));
    Score { black_half: black * 2, white_half: white * 2 + komi_half }
}
