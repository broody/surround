//! Surround's Go rules (bitboards, captures, area scoring) and `GoRules`, their
//! referee `GameRules` implementation. No Dojo dependency: the Dojo channel,
//! the proof adapter and the proving executable all build from this crate.
pub mod fixtures;
pub mod go;
pub mod replay;
pub mod rules;

#[cfg(test)]
mod tests {
    mod test_go;
    mod test_rules;
    mod test_vectors;
    mod vectors;
}
