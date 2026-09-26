//! Build referee steps from recorded games, for tests and tooling. Steps carry
//! no seat: referee derives it from the state.
use referee::Move;
use crate::fixtures::ReplayFixture;
use crate::go::{GoAction, GoConfig};
use crate::rules::{self, NO_POINT};

pub fn config(fixture: @ReplayFixture) -> GoConfig {
    GoConfig { size: *fixture.size, komi_half: *fixture.komi_half }
}

/// The position history witness for a game's opening state.
pub fn opening_history(config: @GoConfig) -> Span<felt252> {
    array![rules::position_hash(rules::empty_position(), *config.size)].span()
}

pub fn go(action: GoAction) -> Move<GoAction> {
    Move::Play(action)
}

pub fn stone(point: u16) -> Move<GoAction> {
    go(GoAction::Play(point))
}

pub fn pass() -> Move<GoAction> {
    go(GoAction::Pass)
}

/// Every recorded move, then the player due after the two passes proposes the
/// recorded dead stones and the other accepts.
pub fn game_steps(fixture: @ReplayFixture) -> Span<Move<GoAction>> {
    let mut steps = array![];
    for point in *fixture.moves {
        steps.append(if *point == NO_POINT {
            pass()
        } else {
            stone(*point)
        });
    }
    steps.append(go(GoAction::Propose(*fixture.dead)));
    steps.append(go(GoAction::Accept));
    steps.span()
}
