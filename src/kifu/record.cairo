//! A kifu record: every step of a game and its final position, packed
//! losslessly into as few felts as they allow.
//!
//! Each step is one digit in base `size² + 8`: a point is its own code, and the
//! eight codes after the points are Pass, Accept, Resume, Propose, Resign by
//! seat 0, Resign by seat 1, Flag and Recommit. A proposal's dead mask follows
//! its code in whichever form is shorter: a small one as its stone count and
//! each dead point's distance past the previous one, a large one as a bitmap.
//! A recommitted tip follows as its 252 bits. After the steps, one bit per
//! point ever played says whether it holds a stone at the end; with the steps
//! that gives the final position without replaying captures. Wide values go
//! in 16-bit digits so that little of a felt goes unused.
//!
//! Digits fill each felt least significant first, in two lanes: its low 128
//! bits, then the 123 above them. So every felt stays below 2^251 and every
//! digit is u128 arithmetic, which keeps decoding cheap enough for views. A
//! 19×19 felt holds 29 steps, a 13×13 felt 33 and a 9×9 felt 37. The step
//! count is not stored: it is the settled anchor's sequence number.
//!
//! Decoding rejects any record the encoder would not produce, so every game
//! has exactly one record.
use core::dict::{Felt252Dict, Felt252DictTrait};
use core::poseidon::poseidon_hash_span;
use referee::{Move, action_hash};
use surround_rules::go::{GoAction, GoRules};
use surround_rules::rules::{self, BLACK, Bits, EMPTY, NO_POINT, Position};

const LOW_MAX: u128 = 0xffffffffffffffffffffffffffffffff; // 2^128 - 1
const HIGH_MAX: u128 = 0x7ffffffffffffffffffffffffffffff; // 2^123 - 1
const TWO_128: felt252 = 0x100000000000000000000000000000000;
const PASS: u32 = 0;
const ACCEPT: u32 = 1;
const RESUME: u32 = 2;
const PROPOSE: u32 = 3;
const RESIGN: u32 = 4; // + seat
const FLAG: u32 = 6;
const RECOMMIT: u32 = 7;
const CODES: u32 = 8;
const CHUNK: u32 = 16;
/// 2^i.
const POW2: [u128; 17] = [
    0x1, 0x2, 0x4, 0x8, 0x10, 0x20, 0x40, 0x80, 0x100, 0x200, 0x400, 0x800, 0x1000, 0x2000, 0x4000,
    0x8000, 0x10000,
];

/// The largest multipliers a digit of some base still fits under, per lane.
#[derive(Copy, Drop)]
struct Caps {
    low: u128,
    high: u128,
}

fn caps(radix: u128) -> Caps {
    Caps { low: LOW_MAX / radix, high: HIGH_MAX / radix }
}

#[derive(Drop)]
struct Writer {
    felts: Array<felt252>,
    /// The current felt's finished low lane, once `lane` is 1.
    low: u128,
    lane: u8,
    acc: u128,
    mul: u128,
}

#[derive(Drop)]
struct Reader {
    felts: Span<felt252>,
    /// The current felt's high lane, while `lane` is 0.
    high: u128,
    lane: u8,
    cur: u128,
    mul: u128,
}

fn put(ref w: Writer, value: u128, radix: u128, caps: Caps) {
    assert(value < radix, 'Unencodable step');
    let cap = if w.lane == 0 {
        caps.low
    } else {
        caps.high
    };
    if w.mul > cap {
        if w.lane == 0 {
            w.low = w.acc;
            w.lane = 1;
        } else {
            w.felts.append(w.acc.into() * TWO_128 + w.low.into());
            w.low = 0;
            w.lane = 0;
        }
        w.acc = 0;
        w.mul = 1;
    }
    w.acc += value * w.mul;
    w.mul *= radix;
}

fn take(ref r: Reader, radix: NonZero<u128>, caps: Caps) -> u128 {
    let cap = if r.lane == 0 {
        caps.low
    } else {
        caps.high
    };
    if r.mul > cap {
        assert(r.cur == 0, 'Noncanonical record');
        if r.lane == 0 {
            r.cur = r.high;
            r.lane = 1;
        } else {
            let felt: u256 = (*r.felts.pop_front().expect('Record too short')).into();
            r.cur = felt.low;
            r.high = felt.high;
            r.lane = 0;
        }
        r.mul = 1;
    }
    let (rest, digit) = DivRem::div_rem(r.cur, radix);
    r.cur = rest;
    r.mul *= radix.into();
    digit
}

/// A digit in a base used rarely enough to work out its caps each time.
fn put_any(ref w: Writer, value: u128, radix: u128) {
    put(ref w, value, radix, caps(radix));
}

fn take_any(ref r: Reader, radix: u128) -> u128 {
    take(ref r, radix.try_into().unwrap(), caps(radix))
}

fn pow2(bits: u32) -> u128 {
    *POW2.span()[bits]
}

/// `value`'s low `bits` bits as 16-bit digits, least significant first.
fn put_bits(ref w: Writer, value: u128, bits: u32) {
    let mut rest = value;
    let mut left = bits;
    while left > 0 {
        let width = if left < CHUNK {
            left
        } else {
            CHUNK
        };
        let (next, digit) = DivRem::div_rem(rest, pow2(width).try_into().unwrap());
        put_any(ref w, digit, pow2(width));
        rest = next;
        left -= width;
    }
    assert(rest == 0, 'Unencodable step');
}

fn take_bits(ref r: Reader, bits: u32) -> u128 {
    let mut value = 0;
    let mut shift = 1;
    let mut read = 0;
    while read < bits {
        let width = if bits - read < CHUNK {
            bits - read
        } else {
            CHUNK
        };
        value += take_any(ref r, pow2(width)) * shift;
        read += width;
        // The last chunk may reach bit 128; nothing reads `shift` after it.
        if read < bits {
            shift *= pow2(width);
        }
    }
    value
}

/// The widths of a dead mask's three limbs on a board of `points` points.
fn widths(points: u32) -> (u32, u32, u32) {
    let low = if points < 128 {
        points
    } else {
        128
    };
    let mid = if points - low < 128 {
        points - low
    } else {
        128
    };
    (low, mid, points - low - mid)
}

/// The most dead stones a mask lists point by point; more take a bitmap.
/// Below it the list is never longer than the bitmap.
fn list_limit(points: u32) -> u32 {
    if points == 81 {
        12
    } else if points == 169 {
        22
    } else {
        41
    }
}

fn put_mask(ref w: Writer, dead: Bits, points: u32) {
    let count: u32 = rules::popcount(dead).into();
    let limit = list_limit(points);
    if count <= limit {
        put_any(ref w, 0, 2);
        put_any(ref w, count.into(), (limit + 1).into());
        // Each point in the range left after the previous one.
        let mut start = 0;
        let listed = members(dead);
        for point in listed.span() {
            assert(*point < points, 'Unencodable step');
            put_any(ref w, (*point - start).into(), (points - start).into());
            start = *point + 1;
        }
    } else {
        put_any(ref w, 1, 2);
        let (low, mid, high) = widths(points);
        put_bits(ref w, dead.low, low);
        put_bits(ref w, dead.mid, mid);
        put_bits(ref w, dead.high, high);
    }
}

fn take_mask(ref r: Reader, points: u32) -> Bits {
    let limit = list_limit(points);
    let mut dead = rules::empty_bits();
    if take_any(ref r, 2) == 0 {
        let count: u32 = take_any(ref r, (limit + 1).into()).try_into().unwrap();
        let mut start = 0;
        for _ in 0..count {
            assert(start < points, 'Noncanonical record');
            let offset: u32 = take_any(ref r, (points - start).into()).try_into().unwrap();
            rules::insert(ref dead, (start + offset).try_into().unwrap());
            start += offset + 1;
        }
    } else {
        let (low, mid, high) = widths(points);
        dead =
            Bits {
                low: take_bits(ref r, low),
                mid: take_bits(ref r, mid),
                high: take_bits(ref r, high),
            };
        assert(rules::popcount(dead).into() > limit, 'Noncanonical record');
    }
    dead
}

fn put_tip(ref w: Writer, tip: felt252) {
    let tip: u256 = tip.into();
    put_bits(ref w, tip.low, 128);
    put_bits(ref w, tip.high, 124);
}

fn take_tip(ref r: Reader) -> felt252 {
    let low = take_bits(ref r, 128);
    let high = take_bits(ref r, 124);
    u256 { low, high }.try_into().expect('Noncanonical record')
}

/// What walking a game's steps shows without replaying captures: each move's
/// color, the last move at every point, and the dead stones agreed. Turns
/// follow `GoRules::apply`, where captures never change who is due.
#[derive(Destruct)]
pub struct Walk {
    /// Each Play and Pass: its color and point, `NO_POINT` for a pass.
    pub moves: Array<(u8, u16)>,
    /// The points played at least once.
    pub played: Bits,
    /// The last move at each played point, as its move number * 4 + its color.
    pub last: Felt252Dict<u32>,
    /// The stones each color placed.
    pub black_stones: u32,
    pub white_stones: u32,
    /// The accepted proposal's dead stones, when a proposal was accepted.
    pub dead: Bits,
    pub scored: bool,
}

pub fn walk(steps: Span<Move<GoAction>>) -> Walk {
    let mut moves = array![];
    let mut played = rules::empty_bits();
    let mut last: Felt252Dict<u32> = Default::default();
    let mut black_stones = 0;
    let mut white_stones = 0;
    let mut next = BLACK;
    let mut resume = BLACK;
    let mut passes = 0;
    let mut proposal = rules::empty_bits();
    let mut dead = rules::empty_bits();
    let mut scored = false;
    for step in steps {
        // Resignations, flags and recommitments leave the board and turn alone.
        if let Move::Play(action) = *step {
            match action {
                GoAction::Play(point) => {
                    moves.append((next, point));
                    rules::insert(ref played, point);
                    last.insert(point.into(), moves.len() * 4 + next.into());
                    if next == BLACK {
                        black_stones += 1;
                    } else {
                        white_stones += 1;
                    }
                    passes = 0;
                    next = rules::other(next);
                },
                GoAction::Pass => {
                    moves.append((next, NO_POINT));
                    passes += 1;
                    next = rules::other(next);
                    if passes == 2 {
                        resume = next;
                    }
                },
                GoAction::Propose(mask) => {
                    proposal = mask;
                    next = rules::other(next);
                },
                GoAction::Accept => {
                    dead = proposal;
                    scored = true;
                },
                GoAction::Resume => {
                    next = resume;
                    passes = 0;
                },
            }
        }
    }
    Walk { moves, played, last, black_stones, white_stones, dead, scored }
}

/// Which played points hold a stone at the end, in point order, 16 to a
/// digit. A stone is always the last one played on its point, so this and
/// the steps give the final position without replaying captures.
fn put_board(ref w: Writer, ref walk: Walk, board: Position, points: u32) {
    let played = members(walk.played);
    let occupied = rules::union(board.black, board.white);
    // Every stone stands on a played point, in the color last played there.
    assert(rules::subtract(occupied, walk.played) == rules::empty_bits(), 'Unencodable board');
    let mut bits: Array<u128> = array![];
    for p in played.span() {
        let stone = rules::stone_at(board, (*p).try_into().unwrap());
        let last = walk.last.get((*p).into()) % 4;
        assert(stone == EMPTY || stone.into() == last, 'Unencodable board');
        bits.append(if stone == EMPTY {
            0
        } else {
            1
        });
    }
    let mut bits = bits.span();
    while !bits.is_empty() {
        let width = if bits.len() < CHUNK {
            bits.len()
        } else {
            CHUNK
        };
        let mut value = 0;
        for i in 0..width {
            value += *bits.pop_front().unwrap() * pow2(i);
        }
        put_any(ref w, value, pow2(width));
    }
}

fn take_board(ref r: Reader, ref walk: Walk) -> Position {
    let played = members(walk.played);
    let count = played.len();
    let mut bits: Array<u128> = array![];
    let mut read = 0;
    while read < count {
        let width = if count - read < CHUNK {
            count - read
        } else {
            CHUNK
        };
        let mut rest = take_any(ref r, pow2(width));
        for _ in 0..width {
            let (next, bit) = DivRem::div_rem(rest, 2);
            bits.append(bit);
            rest = next;
        }
        read += width;
    }
    let mut bits = bits.span();
    let mut board = rules::empty_position();
    for p in played {
        if *bits.pop_front().unwrap() == 1 {
            let point: u16 = p.try_into().unwrap();
            if walk.last.get(p.into()) % 4 == BLACK.into() {
                rules::insert(ref board.black, point);
            } else {
                rules::insert(ref board.white, point);
            }
        }
    }
    board
}

/// The points in `bits`, in order.
pub fn members(bits: Bits) -> Array<u32> {
    let mut out = array![];
    collect(ref out, bits.low, 0);
    collect(ref out, bits.mid, 128);
    collect(ref out, bits.high, 256);
    out
}

fn collect(ref out: Array<u32>, limb: u128, first: u32) {
    let mut rest = limb;
    let mut point = first;
    while rest != 0 {
        let (next, bit) = DivRem::div_rem(rest, 2);
        if bit == 1 {
            out.append(point);
        }
        rest = next;
        point += 1;
    }
}

/// Pack a game's steps and its final position `board`. Panics on anything a
/// settled Go game cannot contain.
pub fn encode(size: u8, steps: Span<Move<GoAction>>, board: Position) -> Array<felt252> {
    let points: u32 = size.into() * size.into();
    let radix: u128 = (points + CODES).into();
    let step_caps = caps(radix);
    let mut w = Writer { felts: array![], low: 0, lane: 0, acc: 0, mul: 1 };
    for step in steps {
        let code = match *step {
            Move::Play(action) => match action {
                GoAction::Play(point) => {
                    assert(point.into() < points, 'Unencodable step');
                    point.into()
                },
                GoAction::Pass => points + PASS,
                GoAction::Propose(_) => points + PROPOSE,
                GoAction::Accept => points + ACCEPT,
                GoAction::Resume => points + RESUME,
            },
            Move::Resign(seat) => {
                assert(seat < 2, 'Unencodable step');
                points + RESIGN + seat.into()
            },
            Move::Flag => points + FLAG,
            Move::Recommit(_) => points + RECOMMIT,
            _ => panic!("Unencodable step"),
        };
        put(ref w, code.into(), radix, step_caps);
        match *step {
            Move::Play(GoAction::Propose(dead)) => put_mask(ref w, dead, points),
            Move::Recommit(tip) => put_tip(ref w, tip),
            _ => {},
        }
    }
    let mut walk = walk(steps);
    put_board(ref w, ref walk, board, points);
    if w.lane == 1 {
        w.felts.append(w.acc.into() * TWO_128 + w.low.into());
    } else if w.mul > 1 {
        w.felts.append(w.acc.into());
    }
    w.felts
}

/// A record unpacked: every step, the final position, and the walk.
#[derive(Destruct)]
pub struct Record {
    pub steps: Array<Move<GoAction>>,
    pub board: Position,
    pub walk: Walk,
}

/// A step after the points' codes, which carry no more digits than their own.
fn special(ref r: Reader, kind: u32, points: u32) -> Move<GoAction> {
    if kind == PASS {
        Move::Play(GoAction::Pass)
    } else if kind == ACCEPT {
        Move::Play(GoAction::Accept)
    } else if kind == RESUME {
        Move::Play(GoAction::Resume)
    } else if kind == PROPOSE {
        Move::Play(GoAction::Propose(take_mask(ref r, points)))
    } else if kind == FLAG {
        Move::Flag
    } else if kind == RECOMMIT {
        Move::Recommit(take_tip(ref r))
    } else {
        Move::Resign((kind - RESIGN).try_into().unwrap())
    }
}

/// Unpack a record of `count` steps. Panics unless `record` is exactly what
/// `encode` produces.
pub fn decode(size: u8, count: u32, record: Span<felt252>) -> Record {
    let points: u32 = size.into() * size.into();
    let radix: u128 = (points + CODES).into();
    let base: NonZero<u128> = radix.try_into().unwrap();
    let step_caps = caps(radix);
    // Past every cap, so the first digit loads the first felt.
    let mut r = Reader { felts: record, high: 0, lane: 1, cur: 0, mul: LOW_MAX };
    let mut steps = array![];
    for _ in 0..count {
        let code: u32 = take(ref r, base, step_caps).try_into().unwrap();
        steps
            .append(
                if code < points {
                    Move::Play(GoAction::Play(code.try_into().unwrap()))
                } else {
                    special(ref r, code - points, points)
                },
            );
    }
    let mut walk = walk(steps.span());
    let board = take_board(ref r, ref walk);
    // Nothing may follow the last digit, in its lane or after it.
    assert(r.cur == 0 && r.felts.is_empty(), 'Noncanonical record');
    assert(r.lane == 1 || r.high == 0, 'Noncanonical record');
    Record { steps, board, walk }
}

/// The transcript hash referee chains over `steps` from the opening, the one
/// the settled anchor carries.
pub fn transcript(context: felt252, steps: Span<Move<GoAction>>) -> felt252 {
    let mut transcript = 0;
    let mut seq = 0;
    for step in steps {
        let message = action_hash::<GoRules>(context, seq, transcript, step);
        transcript = poseidon_hash_span(array![transcript, message].span());
        seq += 1;
    }
    transcript
}
