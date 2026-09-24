use surround_offchain::channel_protocol::{self, ChannelState, SignedAction, Terms};

// Public outputs bind both ends of the transition. Native settlement uses the
// same replay through ChannelProver in a virtual Starknet transaction.
#[executable]
fn main(
    terms: Terms, start: ChannelState, history: Span<felt252>, actions: Span<SignedAction>,
) -> (felt252, felt252, ChannelState) {
    let result = channel_protocol::replay(terms, start, history, actions);
    (channel_protocol::context_hash(terms), channel_protocol::state_hash(start), result)
}
