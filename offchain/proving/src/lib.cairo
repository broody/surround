use referee::{Envelope, SignedStep, Terms, context_hash, replay, state_hash};
use surround_rules::go::{GoAction, GoConfig, GoRules, GoState};

// Public outputs bind both ends of the transition. Native settlement runs the
// same referee replay through ChannelProver in a virtual Starknet transaction.
#[executable]
fn main(
    terms: Terms<GoConfig>,
    start: Envelope<GoState>,
    history: Span<felt252>,
    steps: Span<SignedStep<GoAction>>,
) -> (felt252, felt252, Envelope<GoState>) {
    let context = context_hash::<GoRules>(@terms);
    let start_hash = state_hash::<GoRules>(@start);
    let end = replay::<GoRules>(context, terms.keys, @terms.config, start, history, steps);
    (context, start_hash, end)
}
