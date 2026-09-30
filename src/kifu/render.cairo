//! A kifu's SVG, SGF and ERC-721 metadata, computed on read from its record.
//! Nothing here is stored: captures, score, territory and each stone's move
//! number all follow from the steps and the final position.
//!
//! The SVG uses single quotes and `rgb()` colors, so it contains no `"` or
//! `%` and one `#`. The metadata carries it raw in a `data:image/svg+xml,`
//! URI inside a `data:application/json,` URI, with only that `#` escaped and
//! no base64, which keeps `token_uri` far inside RPC call limits.
use core::dict::Felt252DictTrait;
use referee::clocks::{Standard, decode};
use referee::{REASON_ABANDON, REASON_RESIGN, REASON_TIMEOUT};
use starknet::ContractAddress;
use surround_rules::go::MOVE_LIMIT;
use surround_rules::rules::{self, BLACK, NO_POINT};
use crate::models::KifuSummary;
use super::record::{Record, members};
use super::text::{
    Text, address, append, byte, date, digits, halves, into_bytes, num, pow256, push, short_address,
    splice, text,
};

const COLUMNS: [felt252; 19] = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
];

/// A minted game as rendering reads it.
#[derive(Destruct)]
pub struct Game {
    pub id: felt252,
    pub size: u8,
    pub komi_half: u16,
    pub black: felt252,
    pub white: felt252,
    /// Referee's winner: 1 is black (seat 0), 2 white (seat 1).
    pub winner: u8,
    pub reason: u8,
    /// Serialized `referee::clocks::Standard` settings.
    pub clock: Span<felt252>,
    /// When the game settled, in Unix seconds; zero if unrecorded.
    pub settled_at: u64,
    pub record: Record,
}

/// What the record says beyond its moves.
#[derive(Copy, Drop)]
struct Facts {
    moves: u32,
    black_captures: u32,
    white_captures: u32,
    /// Both scores in half points, for a game that ended by score.
    score: Option<(u16, u16)>,
}

fn facts(game: @Game) -> Facts {
    let record = game.record;
    let board = *record.board;
    let walk = record.walk;
    // A move limit scores the board as it stands, which the walk can't see.
    let score = if *walk.scored || *game.reason == MOVE_LIMIT {
        let score = rules::score(board, *game.size, dead_of(game), *game.komi_half);
        Option::Some((score.black_half, score.white_half))
    } else {
        Option::None
    };
    // Stones leave the board only by capture: Surround has no suicide.
    let black_left: u32 = rules::popcount(board.black).into();
    let white_left: u32 = rules::popcount(board.white).into();
    Facts {
        moves: walk.moves.len(),
        black_captures: *walk.white_stones - white_left,
        white_captures: *walk.black_stones - black_left,
        score,
    }
}

/// The kifu's queryable facts.
pub fn summary(game: @Game) -> KifuSummary {
    let facts = facts(game);
    let (black_score_half, white_score_half) = facts.score.unwrap_or((0, 0));
    let black: ContractAddress = (*game.black).try_into().unwrap();
    let white: ContractAddress = (*game.white).try_into().unwrap();
    let (winner, loser) = if *game.winner == BLACK {
        (black, white)
    } else {
        (white, black)
    };
    KifuSummary {
        game_id: *game.id,
        black,
        white,
        winner,
        loser,
        size: *game.size,
        komi_half: *game.komi_half,
        moves: facts.moves,
        reason: *game.reason,
        black_score_half,
        white_score_half,
        black_captures: facts.black_captures,
        white_captures: facts.white_captures,
        settled_at: *game.settled_at,
    }
}

// The dead stones a scored game agreed on; none otherwise.
fn dead_of(game: @Game) -> rules::Bits {
    let walk = game.record.walk;
    if *walk.scored && *game.reason != MOVE_LIMIT {
        *walk.dead
    } else {
        rules::empty_bits()
    }
}

/// `B+204.5`, `W+R`, `B+T` or `W+F` (forfeit: forced play abandoned), as SGF
/// writes results.
fn result(ref t: Text, game: @Game, facts: Facts) {
    push(ref t, if *game.winner == BLACK {
        'B+'
    } else {
        'W+'
    }, 2);
    if *game.reason == REASON_RESIGN {
        byte(ref t, 'R');
    } else if *game.reason == REASON_TIMEOUT {
        byte(ref t, 'T');
    } else if *game.reason == REASON_ABANDON {
        byte(ref t, 'F');
    } else if let Option::Some((b, w)) = facts.score {
        let margin = if b > w {
            b - w
        } else {
            w - b
        };
        halves(ref t, margin.into());
    }
}

fn seconds(ref t: Text, ms: u64) {
    num(ref t, ms / 1000);
    byte(ref t, 's');
}

/// `60s per move`, or main time, increment and byo-yomi: `10m + 3x30s`.
fn time_control(ref t: Text, settings: Span<felt252>) {
    let clock: Standard = decode(settings);
    let mut first = true;
    if clock.turn_ms > 0 {
        seconds(ref t, clock.turn_ms);
        push(ref t, ' per move', 9);
        first = false;
    }
    if clock.bank_ms > 0 {
        if !first {
            push(ref t, ' + ', 3);
        }
        if clock.bank_ms % 60000 == 0 {
            num(ref t, clock.bank_ms / 60000);
            byte(ref t, 'm');
        } else {
            seconds(ref t, clock.bank_ms);
        }
        first = false;
    }
    if clock.increment_ms > 0 {
        push(ref t, ' +', 2);
        seconds(ref t, clock.increment_ms);
        push(ref t, ' per move', 9);
    }
    if let Option::Some(byoyomi) = clock.byoyomi {
        if !first {
            push(ref t, ' + ', 3);
        }
        num(ref t, byoyomi.periods.into());
        byte(ref t, 'x');
        seconds(ref t, byoyomi.period_ms);
    }
}

/// Star points: 3-3 corners and the center on 9x9, 4-4 corners and the center
/// on 13x13, the nine traditional points on 19x19.
fn star_points(size: u8) -> Span<u32> {
    if size == 9 {
        array![20, 24, 40, 56, 60].span()
    } else if size == 13 {
        array![42, 48, 84, 120, 126].span()
    } else {
        array![60, 66, 72, 174, 180, 186, 288, 294, 300].span()
    }
}

/// A board coordinate, 1 to 20: its digits and their count.
fn coordinate(value: u32) -> (felt252, u32) {
    if value < 10 {
        ('0' + value.into(), 1)
    } else {
        let (tens, units) = DivRem::div_rem(value, 10);
        (('0' + tens.into()) * 256 + '0' + units.into(), 2)
    }
}

/// `M{x} {y}h0` for each point: a zero-length segment whose cap is a dot.
fn dots(ref t: Text, points: Span<u32>, width: NonZero<u32>) {
    for p in points {
        let (row, col) = DivRem::div_rem(*p, width);
        let (x, x_len) = coordinate(col + 1);
        let (y, y_len) = coordinate(row + 1);
        let head = ('M' * pow256(x_len) + x) * 256 + ' ';
        push(ref t, (head * pow256(y_len) + y) * 0x10000 + 'h0', x_len + y_len + 4);
    }
}

/// Each stone's move number: `<text x='{x}' y='{y}'>{number}</text>`.
fn labels(ref t: Text, ref game: Game, points: Span<u32>, width: NonZero<u32>) {
    for p in points {
        let (row, col) = DivRem::div_rem(*p, width);
        let (x, x_len) = coordinate(col + 1);
        let (y, y_len) = coordinate(row + 1);
        let (number, number_len) = digits((game.record.walk.last.get((*p).into()) / 4).into());
        let head = ('<text x=\'' * pow256(x_len) + x) * 0x10000000000 + '\' y=\'';
        push(ref t, (head * pow256(y_len) + y) * 0x10000 + '\'>', 9 + x_len + 5 + y_len + 2);
        push(ref t, number * 0x100000000000000 + '</text>', number_len + 7);
    }
}

/// Stones: a paper disc under every stone, then ink over the black ones.
fn stones(ref t: Text, black: @Text, white: @Text) {
    append(ref t, @"<path stroke='rgb(237,231,216)' stroke-width='.9' d='");
    splice(ref t, black);
    splice(ref t, white);
    append(ref t, @"'/><path stroke='rgb(17,24,32)' stroke-width='.76' d='");
    splice(ref t, black);
    push(ref t, '\'/>', 3);
}

/// `hash` is how the SVG writes `#`: itself, or percent-encoded where the SVG
/// sits inside nested data URIs.
fn svg_text(ref game: Game, hash: felt252, hash_len: u32) -> Text {
    let facts = facts(@game);
    let n: u32 = game.size.into();
    let width: NonZero<u32> = n.try_into().unwrap();
    let board = game.record.board;
    let scored = game.record.walk.scored || game.reason == MOVE_LIMIT;
    let dead = dead_of(@game);
    let (black_area, white_area) = if scored {
        rules::areas(board, game.size, dead)
    } else {
        (rules::empty_bits(), rules::empty_bits())
    };
    let live_black = members(rules::subtract(board.black, dead));
    let live_white = members(rules::subtract(board.white, dead));
    let dead_black = members(rules::intersect(board.black, dead));
    let dead_white = members(rules::intersect(board.white, dead));
    let black_area = members(black_area);
    let white_area = members(white_area);

    let mut t = text();
    append(ref t, @"<svg xmlns='http://www.w3.org/2000/svg' viewBox='-1 -3 ");
    num(ref t, (n + 2).into());
    byte(ref t, ' ');
    num(ref t, (n + 6).into());
    append(ref t, @"' font-family='monospace' stroke-linecap='round'><rect x='-1' y='-3' width='");
    num(ref t, (n + 2).into());
    push(ref t, '\' height=\'', 10);
    num(ref t, (n + 6).into());
    append(
        ref t, @"' fill='rgb(17,24,32)'/><path stroke='rgb(127,137,149)' stroke-width='.05' d='",
    );
    let (last, last_len) = coordinate(n);
    for i in 1..n + 1 {
        // `M1 {i}H{n}M{i} 1V{n}`
        let (at, at_len) = coordinate(i);
        push(ref t, ('M1 ' * pow256(at_len) + at) * 256 + 'H', 3 + at_len + 1);
        push(ref t, last * 256 + 'M', last_len + 1);
        push(ref t, (at * 0x1000000 + ' 1V') * pow256(last_len) + last, at_len + 3 + last_len);
    }
    append(ref t, @"'/><path stroke='rgb(127,137,149)' stroke-width='.24' d='");
    dots(ref t, star_points(game.size), width);
    // Columns A-T without I along the top; rows count up from the bottom.
    append(
        ref t,
        @"'/><g fill='rgb(127,137,149)' font-size='.42' text-anchor='middle' dominant-baseline='central'><text y='0' x='",
    );
    for i in 1..n + 1 {
        let (at, at_len) = coordinate(i);
        push(ref t, at * 256 + ' ', at_len + 1);
    }
    push(ref t, '\'>', 2);
    let columns = COLUMNS.span();
    for i in 0..n {
        push(ref t, *columns[i], 1);
    }
    push(ref t, '</text>', 7);
    for i in 1..n + 1 {
        let (at, at_len) = coordinate(i);
        let (row, row_len) = coordinate(n + 1 - i);
        push(ref t, '<text x=\'0\' y=\'' * pow256(at_len) + at, 15 + at_len);
        push(ref t, ('\'>' * pow256(row_len) + row) * 0x100000000000000 + '</text>', 9 + row_len);
    }
    push(ref t, '</g>', 4);

    let mut black = text();
    let mut white = text();
    dots(ref black, live_black.span(), width);
    dots(ref white, live_white.span(), width);
    stones(ref t, @black, @white);
    if dead_black.len() + dead_white.len() > 0 {
        let mut black = text();
        let mut white = text();
        dots(ref black, dead_black.span(), width);
        dots(ref white, dead_white.span(), width);
        push(ref t, '<g opacity=\'.4\'>', 16);
        stones(ref t, @black, @white);
        push(ref t, '</g>', 4);
    }
    if black_area.len() + white_area.len() > 0 {
        // A paper square on every point of territory, then ink inside black's.
        let mut black = text();
        let mut white = text();
        dots(ref black, black_area.span(), width);
        dots(ref white, white_area.span(), width);
        append(
            ref t,
            @"<g stroke-linecap='square'><path stroke='rgb(237,231,216)' stroke-width='.32' d='",
        );
        splice(ref t, @black);
        splice(ref t, @white);
        append(ref t, @"'/><path stroke='rgb(17,24,32)' stroke-width='.18' d='");
        splice(ref t, @black);
        push(ref t, '\'/></g>', 7);
    }
    append(
        ref t,
        @"<g font-size='.36' text-anchor='middle' dominant-baseline='central'><g fill='rgb(237,231,216)'>",
    );
    labels(ref t, ref game, live_black.span(), width);
    append(ref t, @"</g><g fill='rgb(17,24,32)'>");
    labels(ref t, ref game, live_white.span(), width);
    push(ref t, '</g></g>', 8);

    // The result and number above the board; players and the game below it.
    append(
        ref t,
        @"<g fill='rgb(237,231,216)'><text x='0' y='-1.4' font-size='1.1' font-weight='bold'>",
    );
    result(ref t, @game, facts);
    append(ref t, @"</text><text y='-1.4' font-size='.5' text-anchor='end' x='");
    num(ref t, n.into());
    append(ref t, @"'>SURROUND KIFU ");
    push(ref t, hash, hash_len);
    num(ref t, game.id.try_into().unwrap());
    append(ref t, @"</text><text x='0' font-size='.5'");
    if game.winner == BLACK {
        append(ref t, @" fill='rgb(240,198,113)'");
    }
    push(ref t, ' y=\'', 4);
    num(ref t, (n + 1).into());
    push(ref t, '.3\'>B ', 6);
    short_address(ref t, game.black);
    append(ref t, @"</text><text font-size='.5' text-anchor='end'");
    if game.winner != BLACK {
        append(ref t, @" fill='rgb(240,198,113)'");
    }
    push(ref t, ' x=\'', 4);
    num(ref t, n.into());
    push(ref t, '\' y=\'', 5);
    num(ref t, (n + 1).into());
    push(ref t, '.3\'>W ', 6);
    short_address(ref t, game.white);
    append(ref t, @"</text><text x='0' font-size='.4' fill='rgb(127,137,149)' y='");
    num(ref t, (n + 2).into());
    push(ref t, '.2\'>', 4);
    num(ref t, n.into());
    byte(ref t, 'x');
    num(ref t, n.into());
    push(ref t, '  komi ', 7);
    halves(ref t, game.komi_half.into());
    push(ref t, '  ', 2);
    num(ref t, facts.moves.into());
    push(ref t, ' moves', 6);
    if game.settled_at != 0 {
        push(ref t, '  ', 2);
        date(ref t, game.settled_at);
    }
    push(ref t, '</text></g></svg>', 17);
    t
}

pub fn svg(ref game: Game) -> ByteArray {
    into_bytes(svg_text(ref game, '#', 1))
}

/// The game in SGF: its moves and passes. Scoring steps have no SGF form;
/// the contract's `steps` returns every step.
pub fn sgf(ref game: Game) -> ByteArray {
    let facts = facts(@game);
    let mut t = text();
    append(ref t, @"(;GM[1]FF[4]CA[UTF-8]AP[Surround]SZ[");
    num(ref t, game.size.into());
    push(ref t, ']KM[', 4);
    halves(ref t, game.komi_half.into());
    push(ref t, ']PB[', 4);
    address(ref t, game.black);
    push(ref t, ']PW[', 4);
    address(ref t, game.white);
    if game.settled_at != 0 {
        push(ref t, ']DT[', 4);
        date(ref t, game.settled_at);
    }
    push(ref t, ']RE[', 4);
    result(ref t, @game, facts);
    byte(ref t, ']');
    let n: NonZero<u16> = Into::<u8, u16>::into(game.size).try_into().unwrap();
    for move in game.record.walk.moves.span() {
        let (color, point) = *move;
        let node = if color == BLACK {
            ';B['
        } else {
            ';W['
        };
        if point == NO_POINT {
            push(ref t, node * 256 + ']', 4);
        } else {
            let (row, col) = DivRem::div_rem(point, n);
            let column = node * 256 + 'a' + col.into();
            push(ref t, (column * 256 + 'a' + row.into()) * 256 + ']', 6);
        }
    }
    byte(ref t, ')');
    into_bytes(t)
}

fn text_trait(ref t: Text, name: @ByteArray, value: @Text) {
    push(ref t, ',{"trait_type":"', 16);
    append(ref t, name);
    push(ref t, '","value":"', 11);
    splice(ref t, value);
    push(ref t, '"}', 2);
}

fn number_trait(ref t: Text, name: @ByteArray, value: u64) {
    push(ref t, ',{"trait_type":"', 16);
    append(ref t, name);
    push(ref t, '","display_type":"number",', 26);
    push(ref t, '"value":', 8);
    num(ref t, value);
    byte(ref t, '}');
}

/// ERC-721 metadata as a `data:application/json,` URI, the SVG inside it raw.
/// Only `#` needs escaping: the JSON's `#` is `%23`, and the SVG's, one URI
/// deeper, `%2523`.
pub fn token_uri(ref game: Game) -> ByteArray {
    let facts = facts(@game);
    let id: u64 = game.id.try_into().unwrap();
    let mut outcome = text();
    result(ref outcome, @game, facts);

    let mut t = text();
    append(ref t, @"data:application/json,{\"name\":\"Surround Kifu %23");
    num(ref t, id);
    append(ref t, @"\",\"description\":\"Game ");
    num(ref t, id);
    push(ref t, ' on Surround, ', 14);
    splice(ref t, @outcome);
    append(ref t, @". Every move is stored onchain: sgf(");
    num(ref t, id);
    append(ref t, @") returns the game record.\",\"image\":\"data:image/svg+xml,");
    let image = svg_text(ref game, '%2523', 5);
    splice(ref t, @image);
    append(ref t, @"\",\"attributes\":[{\"trait_type\":\"Result\",\"value\":\"");
    splice(ref t, @outcome);
    push(ref t, '"}', 2);
    let mut value = text();
    append(ref value, if game.winner == BLACK {
        @"Black"
    } else {
        @"White"
    });
    text_trait(ref t, @"Winner", @value);
    let mut value = text();
    append(
        ref value,
        if game.reason == REASON_RESIGN {
            @"Resignation"
        } else if game.reason == REASON_TIMEOUT {
            @"Time"
        } else if game.reason == REASON_ABANDON {
            @"Forfeit"
        } else {
            @"Score"
        },
    );
    text_trait(ref t, @"Won by", @value);
    let mut value = text();
    num(ref value, game.size.into());
    byte(ref value, 'x');
    num(ref value, game.size.into());
    text_trait(ref t, @"Board", @value);
    let mut value = text();
    halves(ref value, game.komi_half.into());
    text_trait(ref t, @"Komi", @value);
    let mut value = text();
    time_control(ref value, game.clock);
    text_trait(ref t, @"Time control", @value);
    number_trait(ref t, @"Moves", facts.moves.into());
    number_trait(ref t, @"Black captures", facts.black_captures.into());
    number_trait(ref t, @"White captures", facts.white_captures.into());
    if let Option::Some((b, w)) = facts.score {
        let mut value = text();
        halves(ref value, b.into());
        text_trait(ref t, @"Black score", @value);
        let mut value = text();
        halves(ref value, w.into());
        text_trait(ref t, @"White score", @value);
    }
    let mut value = text();
    address(ref value, game.black);
    text_trait(ref t, @"Black", @value);
    let mut value = text();
    address(ref value, game.white);
    text_trait(ref t, @"White", @value);
    if game.settled_at != 0 {
        append(ref t, @",{\"trait_type\":\"Date\",\"display_type\":\"date\",\"value\":");
        num(ref t, game.settled_at);
        byte(ref t, '}');
    }
    push(ref t, ']}', 2);
    into_bytes(t)
}
