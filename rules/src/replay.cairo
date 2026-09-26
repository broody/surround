//! Build referee steps from recorded games, for tests and tooling.
use referee::{Move, Step};
use crate::fixtures::ReplayFixture;
use crate::go::{ACCEPT, GoAction, GoConfig, PASS, PLAY, PROPOSE};
use crate::rules::{self, Bits, NO_POINT};

pub fn config(fixture: @ReplayFixture) -> GoConfig {
    GoConfig { size: *fixture.size, komi_half: *fixture.komi_half }
}

/// The position history witness for a game's opening state.
pub fn opening_history(config: @GoConfig) -> Span<felt252> {
    array![rules::position_hash(rules::empty_position(), *config.size)].span()
}

pub fn go(seat: u8, kind: u8, point: u16, dead: Bits) -> Step<GoAction> {
    Step { seat, action: Move::Play(GoAction { kind, point, dead }), entropy: 0 }
}

pub fn stone(seat: u8, point: u16) -> Step<GoAction> {
    go(seat, PLAY, point, rules::empty_bits())
}

pub fn pass(seat: u8) -> Step<GoAction> {
    go(seat, PASS, NO_POINT, rules::empty_bits())
}

/// Every recorded move, then the player due after the two passes proposes the
/// recorded dead stones and the other accepts.
pub fn game_steps(fixture: @ReplayFixture) -> Span<Step<GoAction>> {
    let mut steps = array![];
    let mut seat: u8 = 0;
    for point in *fixture.moves {
        steps.append(if *point == NO_POINT {
            pass(seat)
        } else {
            stone(seat, *point)
        });
        seat = 1 - seat;
    }
    steps.append(go(seat, PROPOSE, NO_POINT, *fixture.dead));
    steps.append(go(1 - seat, ACCEPT, NO_POINT, rules::empty_bits()));
    steps.span()
}
