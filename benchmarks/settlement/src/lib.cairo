use surround_score_bench::rules::{Bits, Position};

#[starknet::interface]
trait IScoringBench<T> {
    fn direct(ref self: T, id: felt252, size: u8, komi_half: u16, board: Position, dead: Bits);
    fn result(self: @T, id: felt252) -> (felt252, u16, u16);
}

// Benchmark-only contract. Inputs are public fixture data, not live game state.
// It measures direct scorer execution plus storing a result on a local devnet.
#[starknet::contract]
mod ScoringBench {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use surround_score_bench::evaluate;
    use surround_score_bench::rules::{Bits, Position};

    #[storage]
    struct Storage {
        results: Map<felt252, (felt252, u16, u16)>,
    }

    #[abi(embed_v0)]
    impl ScoringBenchImpl of super::IScoringBench<ContractState> {
        fn direct(
            ref self: ContractState,
            id: felt252,
            size: u8,
            komi_half: u16,
            board: Position,
            dead: Bits,
        ) {
            let (statement, score) = evaluate(size, komi_half, board, dead);
            self.results.write(id, (statement, score.black_half, score.white_half));
        }

        fn result(self: @ContractState, id: felt252) -> (felt252, u16, u16) {
            self.results.read(id)
        }
    }
}
