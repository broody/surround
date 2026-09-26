//! Transcripts signed by the JS SDK (offchain/generate-fixtures.mjs) replay in
//! Cairo to the same end state: the two implementations agree on hashing,
//! signatures, encoding and Go rules.
use referee::{context_hash, replay, state_hash};
use crate::go::GoRules;
use super::vectors::{self, Vector};

fn check(v: Vector) {
    let context = context_hash::<GoRules>(@v.terms);
    let end = replay::<
        GoRules,
    >(context, v.terms.keys, @v.terms.config, v.start, v.history, v.steps, v.signatures);
    assert_eq!(state_hash::<GoRules>(@end), v.end_hash);
}

#[test]
#[available_gas(100000000000)]
fn js_signed_scoring_dispute_replays_in_cairo() {
    check(vectors::corner_dispute());
}

#[test]
#[available_gas(100000000000)]
fn js_signed_recorded_game_replays_in_cairo() {
    check(vectors::cgos_9_1682833());
}
