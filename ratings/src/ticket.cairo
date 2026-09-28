use referee::{TimeControl, signing_hash};
use starknet::ContractAddress;

/// A rated pairing signed by the matchmaker: who plays whom, on which channel,
/// under which terms. Black creates the game with it (`create_rated_channel`),
/// white must join before it expires, and `SurroundRatings::check_ticket`
/// accepts each ticket once.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct Ticket {
    pub chain_id: felt252,
    /// The channel contract the game is created on.
    pub channel: ContractAddress,
    pub black: ContractAddress,
    pub white: ContractAddress,
    pub size: u8,
    pub komi_half: u16,
    /// Rated games are always timed: the referee key and clock settings.
    pub clock: TimeControl,
    pub prover: ContractAddress,
    pub response_seconds: u32,
    /// `QUEUE` or `TABLE`.
    pub source: u8,
    /// Starting bands, used for a player's first rated game.
    pub black_band: u8,
    pub white_band: u8,
    /// The matchmaker key that signed this ticket.
    pub matchmaker: felt252,
    /// Unix seconds: when the matchmaker paired the players, and the deadline
    /// for creating and joining the game.
    pub issued_at: u64,
    pub expires_at: u64,
    pub nonce: felt252,
}

/// The message the matchmaker signs: referee's 250-bit `signing_hash` over the
/// ticket's Serde encoding, so any language reproduces it from the same fields
/// (offchain/sdk `ticketDigest`).
pub fn digest(ticket: @Ticket) -> felt252 {
    let mut fields = array!['SURROUND_PAIRING_V1'];
    ticket.serialize(ref fields);
    signing_hash(fields.span())
}
