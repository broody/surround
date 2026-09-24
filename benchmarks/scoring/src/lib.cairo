pub mod rules;
use core::poseidon::poseidon_hash_span;
use rules::{Bits, Position, Score};

// Binds the complete scoring input and output. This is a standalone Cairo
// benchmark statement; native SNIP-36 additionally requires virtual SNOS.
pub fn evaluate(size: u8, komi_half: u16, board: Position, dead: Bits) -> (felt252, Score) {
    let score = rules::score(board, size, dead, komi_half);
    let statement = poseidon_hash_span(
        array![
            'SURROUND_SCORE_BENCH_V1', rules::RULES_VERSION.into(), size.into(), komi_half.into(),
            rules::position_hash(board, size), dead.low.into(), dead.mid.into(), dead.high.into(),
            score.black_half.into(), score.white_half.into(),
        ]
            .span(),
    );
    (statement, score)
}

#[executable]
fn main(size: u8, komi_half: u16, board: Position, dead: Bits) -> (felt252, Score) {
    evaluate(size, komi_half, board, dead)
}
