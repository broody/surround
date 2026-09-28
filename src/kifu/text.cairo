//! A text buffer written a word at a time, and the formatting metadata needs.
//!
//! Views that build kilobytes of SVG must stay inside the gas RPC nodes allow
//! a call (Juno's default is 100M). `ByteArray` spends thousands of gas per
//! appended byte, and Sierra charges a function's most expensive branch even
//! when a cheaper one runs. `Text` therefore packs bytes into felts with plain
//! felt arithmetic in both branches: a token that does not fit starts a new
//! word instead of being split, and each word keeps its own length.

/// 256^i.
const POW256: [felt252; 32] = [
    0x1, 0x100, 0x10000, 0x1000000, 0x100000000, 0x10000000000, 0x1000000000000, 0x100000000000000,
    0x10000000000000000, 0x1000000000000000000, 0x100000000000000000000, 0x10000000000000000000000,
    0x1000000000000000000000000, 0x100000000000000000000000000, 0x10000000000000000000000000000,
    0x1000000000000000000000000000000, 0x100000000000000000000000000000000,
    0x10000000000000000000000000000000000, 0x1000000000000000000000000000000000000,
    0x100000000000000000000000000000000000000, 0x10000000000000000000000000000000000000000,
    0x1000000000000000000000000000000000000000000, 0x100000000000000000000000000000000000000000000,
    0x10000000000000000000000000000000000000000000000,
    0x1000000000000000000000000000000000000000000000000,
    0x100000000000000000000000000000000000000000000000000,
    0x10000000000000000000000000000000000000000000000000000,
    0x1000000000000000000000000000000000000000000000000000000,
    0x100000000000000000000000000000000000000000000000000000000,
    0x10000000000000000000000000000000000000000000000000000000000,
    0x1000000000000000000000000000000000000000000000000000000000000,
    0x100000000000000000000000000000000000000000000000000000000000000,
];
const HEX: [felt252; 16] = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f',
];

/// Finished `words` of `lens[i]` bytes each, then the `len` bytes in `acc`.
#[derive(Drop)]
pub struct Text {
    words: Array<felt252>,
    lens: Array<u32>,
    acc: felt252,
    len: u32,
}

pub fn text() -> Text {
    Text { words: array![], lens: array![], acc: 0, len: 0 }
}

pub fn pow256(bytes: u32) -> felt252 {
    *POW256.span()[bytes]
}

/// `word`'s `len` bytes, `len` at most 31: a short string such as `'<g>'`.
pub fn push(ref t: Text, word: felt252, len: u32) {
    if t.len + len <= 31 {
        t.acc = t.acc * pow256(len) + word;
        t.len += len;
    } else {
        t.words.append(t.acc);
        t.lens.append(t.len);
        t.acc = word;
        t.len = len;
    }
}

pub fn byte(ref t: Text, value: u8) {
    if t.len < 31 {
        t.acc = t.acc * 256 + value.into();
        t.len += 1;
    } else {
        t.words.append(t.acc);
        t.lens.append(t.len);
        t.acc = value.into();
        t.len = 1;
    }
}

/// A string of any length.
pub fn append(ref t: Text, s: @ByteArray) {
    let mut felts = array![];
    s.serialize(ref felts);
    let mut felts = felts.span();
    let full: u32 = (*felts.pop_front().unwrap()).try_into().unwrap();
    for _ in 0..full {
        push(ref t, *felts.pop_front().unwrap(), 31);
    }
    let pending = *felts.pop_front().unwrap();
    let len: u32 = (*felts.pop_front().unwrap()).try_into().unwrap();
    push(ref t, pending, len);
}

/// Another buffer's bytes, which it keeps.
pub fn splice(ref t: Text, other: @Text) {
    t.words.append(t.acc);
    t.lens.append(t.len);
    t.words.append_span(other.words.span());
    t.lens.append_span(other.lens.span());
    t.acc = *other.acc;
    t.len = *other.len;
}

pub fn into_bytes(t: Text) -> ByteArray {
    let mut out: ByteArray = "";
    let mut lens = t.lens.span();
    for word in t.words {
        let len = *lens.pop_front().unwrap();
        if len > 0 {
            out.append_word(word, len);
        }
    }
    if t.len > 0 {
        out.append_word(t.acc, t.len);
    }
    out
}

/// Decimal digits as a word and its length.
pub fn digits(value: u64) -> (felt252, u32) {
    let mut word = 0;
    let mut len = 0;
    let mut rest = value;
    loop {
        let (next, digit) = DivRem::div_rem(rest, 10);
        word += ('0' + digit.into()) * pow256(len);
        len += 1;
        rest = next;
        if rest == 0 {
            break;
        }
    }
    (word, len)
}

pub fn num(ref t: Text, value: u64) {
    let (word, len) = digits(value);
    push(ref t, word, len);
}

/// A count of half points: `13` is `6.5`.
pub fn halves(ref t: Text, value: u32) {
    num(ref t, (value / 2).into());
    if value % 2 == 1 {
        push(ref t, '.5', 2);
    }
}

/// `count` hex digits of `value`, which has no more.
fn hex(value: u128, count: u32) -> felt252 {
    let table = HEX.span();
    let mut word = 0;
    let mut rest = value;
    for i in 0..count {
        let (next, digit) = DivRem::div_rem(rest, 16);
        word += *table[digit.try_into().unwrap()] * pow256(i);
        rest = next;
    }
    word
}

/// `0x` and all 64 hex digits.
pub fn address(ref t: Text, value: felt252) {
    let value: u256 = value.into();
    let (high, low) = DivRem::div_rem(value.high, 0x10000000000000000);
    let (high_low, low_low) = DivRem::div_rem(value.low, 0x10000000000000000);
    push(ref t, '0x', 2);
    push(ref t, hex(high, 16), 16);
    push(ref t, hex(low, 16), 16);
    push(ref t, hex(high_low, 16), 16);
    push(ref t, hex(low_low, 16), 16);
}

/// `0x054f..eca3`: the first and last four of the 64 hex digits.
pub fn short_address(ref t: Text, value: felt252) {
    let value: u256 = value.into();
    let (first, _) = DivRem::div_rem(value.high, 0x10000000000000000000000000000);
    let (_, last) = DivRem::div_rem(value.low, 0x10000);
    push(ref t, '0x', 2);
    push(ref t, hex(first, 4), 4);
    push(ref t, '..', 2);
    push(ref t, hex(last, 4), 4);
}

/// A Unix timestamp's UTC date as `YYYY-MM-DD` (Hinnant's civil-from-days).
pub fn date(ref t: Text, timestamp: u64) {
    let z = timestamp / 86400 + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 {
        mp + 3
    } else {
        mp - 9
    };
    let year = yoe + era * 400 + if month <= 2 {
        1
    } else {
        0
    };
    num(ref t, year);
    push(ref t, '-' * 0x10000 + two(month), 3);
    push(ref t, '-' * 0x10000 + two(day), 3);
}

/// Two digits, the first possibly `0`.
fn two(value: u64) -> felt252 {
    let (tens, units) = DivRem::div_rem(value, 10);
    ('0' + tens.into()) * 256 + '0' + units.into()
}
