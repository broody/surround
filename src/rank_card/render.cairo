//! A rank card's SVG and ERC-721 metadata, drawn on read from the player's
//! rating as `SurroundRatings` reports it now. Nothing is stored: the card
//! changes the moment a rated game moves the rating.
//!
//! The card: `surround.gg`, the rank as a large number with `KYU` or `DAN`
//! beside it (`?` after it while provisional) over a 19×19 board that fades
//! out from its center, then games, won and lost, and drawn where there are
//! any. A dan card is foiled: a double gold frame, gold star points, and the
//! number in a gold gradient that a pale band sweeps across every 4 s (SVG's
//! own animation, which plays where the card is shown as an image; a viewer
//! that draws it once shows the foil still).
//!
//! As with kifu (`kifu::render`), the SVG uses single quotes and `rgb()`
//! colors, so it has no `"` or `%`. Its `#`s, in the `url(#…)` of the fade,
//! the clip, the foil and its shimmer, are written by the caller's escape: the metadata
//! carries the SVG raw in a `data:image/svg+xml,` URI inside a
//! `data:application/json,` URI, where each is `%2523`.
use crate::kifu::text::{Text, append, byte, into_bytes, medium_address, num, push, splice, text};

/// What a card shows: the player and their rating's record and rank.
#[derive(Copy, Drop, Debug, PartialEq)]
pub struct Card {
    pub player: felt252,
    /// Rank on OGS's scale in tenths, with the pool's offset: 0 is 30k, 300 is 1d.
    pub shown: u16,
    /// "?": too few games, no win or no loss yet, or idle too long.
    pub provisional: bool,
    pub games: u32,
    pub wins: u32,
    pub losses: u32,
    pub draws: u32,
}

/// The rank's number (1 to 30) and whether it is dan, from tenths.
fn kyu_dan(shown: u16) -> (u64, bool) {
    let rank: u64 = (shown / 10).into();
    if rank < 30 {
        (30 - rank, false)
    } else {
        (rank - 29, true)
    }
}

/// A rank in tenths as the site writes it: `17k`, `1k`, `1d`, `9d`.
pub fn rank_label(ref t: Text, shown: u16) {
    let (n, dan) = kyu_dan(shown);
    num(ref t, n);
    byte(ref t, if dan {
        'd'
    } else {
        'k'
    });
}

/// One count under its label, centered at `x`.
fn stat(ref t: Text, x: u32, value: u32, label: @ByteArray) {
    push(ref t, '<text x=\'', 9);
    num(ref t, x.into());
    append(ref t, @"' y='372' font-size='30' fill='rgb(237,229,210)'>");
    num(ref t, value.into());
    push(ref t, '</text><text x=\'', 16);
    num(ref t, x.into());
    append(ref t, @"' y='394' font-size='11' letter-spacing='2' fill='rgb(130,145,141)'>");
    append(ref t, label);
    push(ref t, '</text>', 7);
}

/// The rank: its number, then `KYU` or `DAN` (`?` after it while
/// provisional), side by side and centered together. Monospace digits are
/// about 0.6 em wide: one digit is 200 tall, two shrink to 150 to fit.
fn rank(ref t: Text, card: @Card, hash: felt252, hash_len: u32, foil: bool) {
    let (n, dan) = kyu_dan(*card.shown);
    let (size, number_width) = if n < 10 {
        (200_u32, 120_u32)
    } else {
        (150, 180)
    };
    // The word at 26 with letter spacing 4: 19.6 a letter, 3 or 4 letters.
    let word_width = if *card.provisional {
        78_u32
    } else {
        59
    };
    let gap = 12;
    let end = 180 + number_width - (number_width + gap + word_width) / 2;
    push(ref t, '<text x=\'', 9);
    num(ref t, end.into());
    append(ref t, @"' y='262' font-size='");
    num(ref t, size.into());
    // Each haloed in the card's color, so the board's lines stop short of it.
    append(
        ref t,
        @"' font-weight='bold' text-anchor='end' stroke='rgb(23,33,45)' stroke-width='8' paint-order='stroke' fill='",
    );
    if foil {
        url(ref t, hash, hash_len, 'f');
    } else {
        append(ref t, @"rgb(240,198,113)");
    }
    push(ref t, '\'>', 2);
    num(ref t, n);
    push(ref t, '</text>', 7);
    if foil {
        // The shimmer: the same number again, clear but for a pale band
        // (gradient `s`) that sweeps across it.
        push(ref t, '<text x=\'', 9);
        num(ref t, end.into());
        append(ref t, @"' y='262' font-size='");
        num(ref t, size.into());
        append(ref t, @"' font-weight='bold' text-anchor='end' fill='");
        url(ref t, hash, hash_len, 's');
        push(ref t, '\'>', 2);
        num(ref t, n);
        push(ref t, '</text>', 7);
    }
    push(ref t, '<text x=\'', 9);
    num(ref t, (end + gap).into());
    append(
        ref t,
        @"' y='262' font-size='26' letter-spacing='4' fill='rgb(217,184,117)' text-anchor='start' stroke='rgb(23,33,45)' stroke-width='6' paint-order='stroke'>",
    );
    push(ref t, if dan {
        'DAN'
    } else {
        'KYU'
    }, 3);
    if *card.provisional {
        byte(ref t, '?');
    }
    push(ref t, '</text>', 7);
}

/// `url(#id)`, its `#` written as `hash` (`hash_len` bytes).
fn url(ref t: Text, hash: felt252, hash_len: u32, id: felt252) {
    push(ref t, 'url(', 4);
    push(ref t, hash, hash_len);
    push(ref t, id * 256 + ')', 2);
}

/// A true 19×19 board behind the rank, 18 apart, its center point at
/// (180, 190): lines 28 to 352 each way, star points on the 4th, 10th and
/// 16th lines. No line is an edge: it fades out from the center (mask `m`)
/// and stays between `surround.gg` and the record (clip `c`).
fn board(ref t: Text, hash: felt252, hash_len: u32, star: @ByteArray) {
    append(ref t, @"<g clip-path='");
    url(ref t, hash, hash_len, 'c');
    append(ref t, @"'><g mask='");
    url(ref t, hash, hash_len, 'm');
    append(ref t, @"'><path stroke='rgb(66,84,98)' d='");
    for i in 0..19_u32 {
        // Column `at`, and row `at + 10`.
        let at = 18 + i * 18;
        byte(ref t, 'M');
        num(ref t, at.into());
        push(ref t, ' 28V352M18 ', 11);
        num(ref t, (at + 10).into());
        push(ref t, 'H342', 4);
    }
    append(ref t, @"'/><g fill='");
    append(ref t, star);
    push(ref t, '\'>', 2);
    for x in array![72_u32, 180, 288] {
        for y in array![82_u32, 190, 298] {
            push(ref t, '<circle cx=\'', 12);
            num(ref t, x.into());
            push(ref t, '\' cy=\'', 6);
            num(ref t, y.into());
            push(ref t, '\' r=\'3.3\'/>', 11);
        }
    }
    push(ref t, '</g></g></g>', 12);
}

fn svg_text(card: @Card, hash: felt252, hash_len: u32) -> Text {
    let (_, dan) = kyu_dan(*card.shown);
    let foil = dan && *card.games > 0;
    let mut t = text();
    // The fade, the clip, and a dan card's foil.
    append(
        ref t,
        @"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 360 504' font-family='monospace' text-anchor='middle'><defs><radialGradient id='g' gradientUnits='userSpaceOnUse' cx='180' cy='190' r='200'><stop offset='0' stop-color='white'/><stop offset='.35' stop-color='white' stop-opacity='.8'/><stop offset='.75' stop-color='white' stop-opacity='.15'/><stop offset='1' stop-color='white' stop-opacity='0'/></radialGradient><mask id='m' maskUnits='userSpaceOnUse' x='0' y='0' width='360' height='504'><rect width='360' height='504' fill='",
    );
    url(ref t, hash, hash_len, 'g');
    append(
        ref t,
        @"'/></mask><clipPath id='c'><rect x='11' y='72' width='338' height='236'/></clipPath>",
    );
    if foil {
        append(
            ref t,
            @"<linearGradient id='f' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='rgb(255,236,180)'/><stop offset='.55' stop-color='rgb(240,198,113)'/><stop offset='1' stop-color='rgb(176,132,58)'/></linearGradient><linearGradient id='s' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='rgb(255,248,224)' stop-opacity='0'/><stop offset='.4' stop-color='rgb(255,248,224)' stop-opacity='0'/><stop offset='.5' stop-color='rgb(255,248,224)' stop-opacity='.85'/><stop offset='.6' stop-color='rgb(255,248,224)' stop-opacity='0'/><stop offset='1' stop-color='rgb(255,248,224)' stop-opacity='0'/><animateTransform attributeName='gradientTransform' type='translate' values='-1 0;1 0;1 0' keyTimes='0;.4;1' dur='4s' repeatCount='indefinite'/></linearGradient>",
        );
    }
    append(ref t, @"</defs><rect width='360' height='504' rx='20' fill='rgb(11,18,27)'/>");
    if foil {
        append(
            ref t,
            @"<rect x='10' y='10' width='340' height='484' rx='13' fill='rgb(23,33,45)' stroke='rgb(155,133,88)' stroke-width='2'/><rect x='18' y='18' width='324' height='468' rx='8' fill='none' stroke='rgb(155,133,88)' stroke-width='.8' opacity='.7'/>",
        );
        board(ref t, hash, hash_len, @"rgb(176,148,92)");
    } else {
        append(
            ref t,
            @"<rect x='10' y='10' width='340' height='484' rx='13' fill='rgb(23,33,45)' stroke='rgb(85,75,57)' stroke-width='1.5'/>",
        );
        board(ref t, hash, hash_len, @"rgb(96,112,122)");
    }
    append(
        ref t,
        @"<text x='180' y='50' font-size='16' letter-spacing='2' fill='rgb(217,184,117)'>surround.gg</text>",
    );
    if *card.games == 0 {
        // Only if the ratings were reset: no rank to show.
        append(
            ref t,
            @"<text x='180' y='240' font-size='26' letter-spacing='4' fill='rgb(166,176,170)'>UNRATED</text>",
        );
    } else {
        rank(ref t, card, hash, hash_len, foil);
    }
    // Games, won and lost, and drawn where there are any, with dividers
    // between them and no rule above: one would read as the board's edge.
    append(ref t, @"<path stroke='rgb(43,59,71)' d='");
    if *card.draws > 0 {
        append(ref t, @"M105 340V400M180 340V400M255 340V400'/>");
        stat(ref t, 67, *card.games, @"GAMES");
        stat(ref t, 142, *card.wins, @"WON");
        stat(ref t, 217, *card.losses, @"LOST");
        stat(ref t, 292, *card.draws, @"DRAWN");
    } else {
        append(ref t, @"M133 340V400M227 340V400'/>");
        stat(ref t, 86, *card.games, @"GAMES");
        stat(ref t, 180, *card.wins, @"WON");
        stat(ref t, 274, *card.losses, @"LOST");
    }
    // Whose card, and that it stays theirs.
    append(
        ref t,
        @"<g font-size='11' fill='rgb(130,145,141)'><text x='30' y='476' text-anchor='start'>",
    );
    medium_address(ref t, *card.player);
    append(
        ref t,
        @"</text><text x='330' y='476' text-anchor='end' letter-spacing='2' fill='rgb(155,133,88)'>SOULBOUND</text></g></svg>",
    );
    t
}

pub fn svg(card: @Card) -> ByteArray {
    into_bytes(svg_text(card, '#', 1))
}

fn number_trait(ref t: Text, name: @ByteArray, value: u32) {
    push(ref t, ',{"trait_type":"', 16);
    append(ref t, name);
    push(ref t, '","display_type":"number",', 26);
    push(ref t, '"value":', 8);
    num(ref t, value.into());
    byte(ref t, '}');
}

/// ERC-721 metadata as a `data:application/json,` URI, the SVG inside it raw:
/// only its `#`s are escaped, as `%2523`.
pub fn token_uri(card: @Card) -> ByteArray {
    let mut t = text();
    // Every card is a Rank; the address is on its face.
    append(
        ref t,
        @"data:application/json,{\"name\":\"Rank\",\"description\":\"A Surround player's rank and record, kept onchain by the SurroundRatings contract on Starknet. Every rated game is settled onchain and rated by that contract, and this card draws itself from the rating each time it is shown, so it changes with every game. This is soulbound.\",\"image\":\"data:image/svg+xml,",
    );
    let image = svg_text(card, '%2523', 5);
    splice(ref t, @image);
    append(ref t, @"\",\"attributes\":[{\"trait_type\":\"Rank\",\"value\":\"");
    if *card.games == 0 {
        append(ref t, @"Unrated");
    } else {
        rank_label(ref t, *card.shown);
        if *card.provisional {
            byte(ref t, '?');
        }
    }
    append(ref t, @"\"},{\"trait_type\":\"Provisional\",\"value\":\"");
    append(ref t, if *card.provisional || *card.games == 0 {
        @"Yes"
    } else {
        @"No"
    });
    push(ref t, '"}', 2);
    number_trait(ref t, @"Games", *card.games);
    number_trait(ref t, @"Wins", *card.wins);
    number_trait(ref t, @"Losses", *card.losses);
    number_trait(ref t, @"Draws", *card.draws);
    push(ref t, ']}', 2);
    into_bytes(t)
}
