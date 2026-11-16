//! A rank card's SVG and ERC-721 metadata, drawn on read from the player's
//! rating as `SurroundRatings` reports it now. Nothing is stored: the card
//! changes the moment a rated game moves the rating.
//!
//! The card: `surround.gg`, the rank as a large number with `KYU` or `DAN`
//! beside it (`?` after it while provisional), then games, won and lost, and
//! drawn where there are any. As with kifu (`kifu::render`), the SVG uses
//! single quotes and `rgb()` colors, so it has no `"`, `#` or `%`, and the
//! metadata carries it raw in a `data:image/svg+xml,` URI inside a
//! `data:application/json,` URI with nothing to escape.
use crate::kifu::text::{Text, append, byte, into_bytes, num, push, short_address, splice, text};

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
fn rank(ref t: Text, card: @Card) {
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
    append(ref t, @"' font-weight='bold' fill='rgb(240,198,113)' text-anchor='end'>");
    num(ref t, n);
    push(ref t, '</text><text x=\'', 16);
    num(ref t, (end + gap).into());
    append(
        ref t,
        @"' y='262' font-size='26' letter-spacing='4' fill='rgb(217,184,117)' text-anchor='start'>",
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

fn svg_text(card: @Card) -> Text {
    let mut t = text();
    append(
        ref t,
        @"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 360 504' font-family='monospace' text-anchor='middle'><rect width='360' height='504' rx='20' fill='rgb(11,18,27)'/><rect x='10' y='10' width='340' height='484' rx='13' fill='rgb(23,33,45)' stroke='rgb(85,75,57)' stroke-width='1.5'/><text x='180' y='50' font-size='16' letter-spacing='2' fill='rgb(217,184,117)'>surround.gg</text>",
    );
    if *card.games == 0 {
        // Only if the ratings were reset: no rank to show.
        append(
            ref t,
            @"<text x='180' y='240' font-size='26' letter-spacing='4' fill='rgb(166,176,170)'>UNRATED</text>",
        );
    } else {
        rank(ref t, card);
    }
    // Games, won and lost, and drawn where there are any, divided.
    append(ref t, @"<path stroke='rgb(43,59,71)' d='M40 318H320");
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
    short_address(ref t, *card.player);
    append(
        ref t,
        @"</text><text x='330' y='476' text-anchor='end' letter-spacing='2' fill='rgb(155,133,88)'>SOULBOUND</text></g></svg>",
    );
    t
}

pub fn svg(card: @Card) -> ByteArray {
    into_bytes(svg_text(card))
}

fn number_trait(ref t: Text, name: @ByteArray, value: u32) {
    push(ref t, ',{"trait_type":"', 16);
    append(ref t, name);
    push(ref t, '","display_type":"number",', 26);
    push(ref t, '"value":', 8);
    num(ref t, value.into());
    byte(ref t, '}');
}

/// ERC-721 metadata as a `data:application/json,` URI, the SVG inside it raw.
pub fn token_uri(card: @Card) -> ByteArray {
    let mut t = text();
    append(ref t, @"data:application/json,{\"name\":\"Surround Rank Card ");
    short_address(ref t, *card.player);
    append(
        ref t,
        @"\",\"description\":\"A Surround player's rank and record, read from SurroundRatings each time it is shown, so it changes as each rated game settles. Soulbound: it stays with ",
    );
    short_address(ref t, *card.player);
    append(ref t, @".\",\"image\":\"data:image/svg+xml,");
    let image = svg_text(card);
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
