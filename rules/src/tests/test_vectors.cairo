//! Transcripts signed by the JS SDK (offchain/generate-fixtures.mjs) replay in
//! Cairo to the same end state: the two implementations agree on hashing,
//! signatures, encoding, Go rules and, for ranked games, referee clocks under
//! the standard time rules: the per-turn timer and byo-yomi.
use referee::clocks::{Byoyomi, Standard, StandardClock, decode, encode};
use referee::{Batch, Clock, Envelope, REASON_TIMEOUT, Signature, context_hash, replay, state_hash};
use crate::go::{AGREEMENT, GoRules, GoState, SCORING};
use crate::rules::WHITE;
use super::vectors::{self, Vector};

fn check(v: Vector) -> Envelope<GoState> {
    let context = context_hash::<GoRules>(@v.terms);
    let end = replay::<GoRules>(context, @v.terms, v.start, v.history, v.batch);
    assert_eq!(state_hash::<GoRules>(@end), v.end_hash);
    end
}

/// The ranked game's batch with another attestation or stamps.
fn timed_with(attestation: Signature, stamps: Span<u64>) -> Vector {
    let v = vectors::timed_flag();
    let batch = Batch { attestation, stamps, ..v.batch };
    Vector { batch, ..v }
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

#[test]
#[available_gas(100000000000)]
fn untimed_games_carry_no_clock() {
    let v = vectors::cgos_9_1682833();
    assert!(v.terms.clock.is_none());
    assert!(v.batch.stamps.is_empty());
    assert!(check(v).clock.is_none());
}

#[test]
#[available_gas(100000000000)]
fn timed_game_replays_against_its_stamps_and_attestation() {
    let v = vectors::timed_flag();
    let settings: Standard = decode(v.terms.clock.unwrap().settings);
    assert_eq!(
        settings, Standard { turn_ms: 60000, bank_ms: 0, increment_ms: 0, byoyomi: Option::None },
    );
    assert_eq!(v.batch.stamps.len(), v.batch.steps.len());
    let last = *v.batch.stamps.at(v.batch.stamps.len() - 1);
    let end = check(v);
    // Black was flagged answering white's proposal: a scoring step is timed
    // like a move, and the flag leaves the scoring phase as it was.
    assert!(end.outcome.finished);
    assert_eq!(end.outcome.winner, WHITE);
    assert_eq!(end.outcome.reason, REASON_TIMEOUT);
    assert_eq!(end.game.phase, SCORING);
    assert!(end.game.proposed);
    let seats = encode(@StandardClock { banks: array![0, 0].span(), periods: array![].span() });
    assert_eq!(end.clock.unwrap(), Clock { seats, used: 0, stamp: last });
}

/// Byo-yomi in the fixtures: 60 s of main time, then 3 periods of 10 s.
fn byoyomi() -> Standard {
    Standard {
        turn_ms: 0,
        bank_ms: 60000,
        increment_ms: 0,
        byoyomi: Option::Some(Byoyomi { periods: 3, period_ms: 10000 }),
    }
}

#[test]
#[available_gas(100000000000)]
fn byoyomi_game_loses_periods_and_replays() {
    let v = vectors::byoyomi_period();
    assert_eq!(decode::<Standard>(v.terms.clock.unwrap().settings), byoyomi());
    let end = check(v);
    // White outlasted two periods; black stayed inside its first.
    let seats: StandardClock = decode(end.clock.unwrap().seats);
    assert_eq!(seats, StandardClock { banks: array![0, 0].span(), periods: array![3, 1].span() });
    assert_eq!(end.outcome.reason, AGREEMENT);
}

#[test]
#[available_gas(100000000000)]
fn byoyomi_flag_in_overtime_replays() {
    let v = vectors::byoyomi_flag();
    let end = check(v);
    assert_eq!(end.outcome.winner, WHITE);
    assert_eq!(end.outcome.reason, REASON_TIMEOUT);
    // The flag leaves black's main time and periods as its turn began.
    let seats: StandardClock = decode(end.clock.unwrap().seats);
    assert_eq!(
        seats, StandardClock { banks: array![60000, 30000].span(), periods: array![3, 3].span() },
    );
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: 'Clock not expired')]
fn byoyomi_flag_needs_every_period_spent() {
    // The same flag a millisecond earlier, inside black's last period.
    let v = vectors::byoyomi_flag();
    let n = v.batch.stamps.len();
    let mut stamps: Array<u64> = v.batch.stamps.slice(0, n - 1).into();
    stamps.append(*v.batch.stamps.at(n - 1) - 1);
    check(Vector { batch: Batch { stamps: stamps.span(), ..v.batch }, ..v });
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: 'Invalid session signature')]
fn intermediate_attestation_is_not_a_final_one() {
    let attestations = vectors::timed_flag_attestations();
    let v = vectors::timed_flag();
    check(timed_with(*attestations.at(attestations.len() - 2), v.batch.stamps));
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: 'Invalid session signature')]
fn later_flag_breaks_the_attestation() {
    // Flagging black a second later is still a legal flag, but not the time
    // the referee attested.
    let v = vectors::timed_flag();
    let mut stamps: Array<u64> = v.batch.stamps.slice(0, v.batch.stamps.len() - 1).into();
    stamps.append(*v.batch.stamps.at(v.batch.stamps.len() - 1) + 1000);
    check(timed_with(v.batch.attestation, stamps.span()));
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: 'Flag fell')]
fn a_step_after_the_turn_ran_out_is_refused() {
    // White's 60 s answer (the sixth step) arriving a millisecond later.
    let v = vectors::timed_flag();
    let mut stamps = array![];
    let mut i: u32 = 0;
    for stamp in v.batch.stamps {
        stamps.append(if i >= 5 {
            *stamp + 1
        } else {
            *stamp
        });
        i += 1;
    }
    check(timed_with(v.batch.attestation, stamps.span()));
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: 'Wrong stamp count')]
fn timed_replay_needs_every_stamp() {
    let v = vectors::timed_flag();
    check(timed_with(v.batch.attestation, v.batch.stamps.slice(1, v.batch.stamps.len() - 1)));
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: 'Unexpected stamps')]
fn untimed_replay_takes_no_stamps() {
    let v = vectors::cgos_9_1682833();
    let mut stamps = array![];
    for _ in v.batch.steps {
        stamps.append(1000);
    }
    let batch = Batch { stamps: stamps.span(), ..v.batch };
    check(Vector { batch, ..v });
}
