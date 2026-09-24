use dojo::world::{WorldStorage, WorldStorageTrait, world};
use dojo_cairo_test::{
    ContractDefTrait, NamespaceDef, TestResource, WorldStorageTestTrait, spawn_test_world,
};
use starknet::{ContractAddress, SyscallResultTrait, testing};
use crate::channel_models::{self, e_ChannelUpdated, m_ChannelGame};
use crate::channel_protocol::{self as protocol, Action, ChannelState, Signature, SignedAction};
use crate::rules;
use crate::systems::channel::{IChannelDispatcher, IChannelDispatcherTrait, channel};
use super::channel_vectors;

#[starknet::interface]
pub trait IProofStub<T> {
    fn relay(
        ref self: T,
        channel: ContractAddress,
        id: felt252,
        epoch: u32,
        start: felt252,
        end: ChannelState,
    );
}

// Callback authentication double only. Tests do not call this a verified proof.
#[starknet::contract]
pub mod proof_stub {
    use super::{
        ChannelState, ContractAddress, IChannelDispatcher, IChannelDispatcherTrait, Signature,
    };
    #[storage]
    struct Storage {}
    #[abi(embed_v0)]
    impl StubImpl of super::IProofStub<ContractState> {
        fn relay(
            ref self: ContractState,
            channel: ContractAddress,
            id: felt252,
            epoch: u32,
            start: felt252,
            end: ChannelState,
        ) {
            let mut api = IChannelDispatcher { contract_address: channel };
            let zero = Signature { r: 0, s: 0 };
            api.accept_verified(id, epoch, start, end, zero, zero);
        }
    }
}

fn black() -> ContractAddress {
    111.try_into().unwrap()
}
fn white() -> ContractAddress {
    222.try_into().unwrap()
}
fn caller(address: ContractAddress) {
    testing::set_contract_address(address);
}
fn zero() -> Signature {
    Signature { r: 0, s: 0 }
}

fn setup() -> (WorldStorage, IChannelDispatcher, IProofStubDispatcher, felt252) {
    testing::set_block_timestamp(1000);
    testing::set_block_number(10);
    testing::set_chain_id('KATANA');
    let namespace = NamespaceDef {
        namespace: "surround",
        resources: array![
            TestResource::Model(m_ChannelGame::TEST_CLASS_HASH),
            TestResource::Event(e_ChannelUpdated::TEST_CLASS_HASH),
            TestResource::Contract(channel::TEST_CLASS_HASH),
        ]
            .span(),
    };
    let mut world = spawn_test_world(world::TEST_CLASS_HASH, array![namespace].span());
    world
        .sync_perms_and_inits(
            array![
                ContractDefTrait::new(@"surround", @"channel")
                    .with_writer_of(
                        array![
                            dojo::utils::selector_from_names(@"surround", @"ChannelGame"),
                            dojo::utils::selector_from_names(@"surround", @"ChannelUpdated"),
                        ]
                            .span(),
                    ),
            ]
                .span(),
        );
    let (address, _) = world.dns(@"channel").unwrap();
    let api = IChannelDispatcher { contract_address: address };
    let (stub, _) = starknet::syscalls::deploy_syscall(
        proof_stub::TEST_CLASS_HASH, 0, [].span(), false,
    )
        .unwrap_syscall();
    let prover = IProofStubDispatcher { contract_address: stub };
    caller(black());
    let (terms, _, _, _, _) = channel_vectors::corner();
    let id = api.create_channel(9, 13, white(), terms.black_key, stub, 300);
    caller(white());
    api.join_channel(id, terms.white_key);
    (world, api, prover, id)
}

fn candidate(api: IChannelDispatcher, stub: IProofStubDispatcher, id: felt252, sequence: u32) {
    let game = api.get_channel(id);
    let mut end = game.anchor;
    end.sequence = sequence;
    stub.relay(api.contract_address, id, game.epoch, protocol::state_hash(game.anchor), end);
}

fn forced(api: IChannelDispatcher, id: felt252) {
    caller(white());
    api.open_dispute(id, 0);
    testing::set_block_timestamp(1300);
    api.resolve_dispute(id, 0);
}

#[test]
#[available_gas(1000000000)]
fn offchain_open_has_no_running_private_clock() {
    let (_, api, _, id) = setup();
    let g = api.get_channel(id);
    assert_eq!(g.status, channel_models::ACTIVE);
    assert_eq!(g.deadline, 0);
    let (terms, epoch, start, block) = api.get_snapshot(id);
    assert_eq!(protocol::context_hash(terms), g.context);
    assert_eq!(epoch, 0);
    assert_eq!(block, 10);
    assert_eq!(start, protocol::initial_state(9));
}

#[test]
#[available_gas(1000000000)]
fn newer_candidates_preserve_anchor_epoch_and_original_deadline() {
    let (_, api, stub, id) = setup();
    let before = api.get_channel(id);
    candidate(api, stub, id, 8);
    let pending = api.get_channel(id);
    assert_eq!(pending.status, channel_models::DISPUTE);
    assert_eq!(pending.deadline, 1300);
    assert_eq!(pending.anchor, before.anchor);
    testing::set_block_timestamp(1299);
    candidate(api, stub, id, 12);
    let latest = api.get_channel(id);
    assert_eq!(latest.deadline, 1300);
    assert_eq!(latest.epoch, 0);
    assert_eq!(latest.anchor, before.anchor);
    assert_eq!(latest.candidate.sequence, 12);
    testing::set_block_timestamp(1300);
    api.resolve_dispute(id, 0);
    let resolved = api.get_channel(id);
    assert_eq!(resolved.anchor.sequence, 12);
    assert_eq!(resolved.epoch, 1);
    assert_eq!(resolved.status, channel_models::FORCED);
    assert_eq!(resolved.deadline, 1600);
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Not a newer candidate', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'))]
fn extra_self_signed_actions_do_not_outrank_an_opponent_acknowledgement() {
    let (_, api, stub, id) = setup();
    let start = api.get_channel(id).anchor;
    let mut supported = start;
    supported.sequence = 4;
    supported.support_turn = 4;
    stub.relay(api.contract_address, id, 0, protocol::state_hash(start), supported);
    let mut fork = start;
    fork.sequence = 5;
    fork.support_turn = 3;
    stub.relay(api.contract_address, id, 0, protocol::state_hash(start), fork);
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Need both approvals', 'ENTRYPOINT_FAILED'))]
fn forced_play_cannot_be_reopened_unilaterally() {
    let (_, api, _, id) = setup();
    forced(api, id);
    api.resume_channel(id, 1, zero(), zero());
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Stale channel epoch', 'ENTRYPOINT_FAILED'))]
fn forced_action_from_previous_epoch_is_rejected() {
    let (_, api, _, id) = setup();
    forced(api, id);
    caller(black());
    api
        .force_action(
            id,
            0,
            [rules::position_hash(rules::empty_position(), 9)].span(),
            Action {
                kind: protocol::PASS, actor: 1, point: rules::NO_POINT, dead: rules::empty_bits(),
            },
        );
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Not a newer candidate', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'))]
fn stale_candidate_cannot_replace_newer_state() {
    let (_, api, stub, id) = setup();
    candidate(api, stub, id, 8);
    candidate(api, stub, id, 7);
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Dispute window closed', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'))]
fn late_proof_cannot_extend_dispute() {
    let (_, api, stub, id) = setup();
    candidate(api, stub, id, 8);
    testing::set_block_timestamp(1300);
    candidate(api, stub, id, 9);
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Only pinned prover', 'ENTRYPOINT_FAILED'))]
fn arbitrary_caller_cannot_inject_a_proved_state() {
    let (_, api, _, id) = setup();
    let g = api.get_channel(id);
    let mut end = g.anchor;
    end.sequence = 8;
    api.accept_verified(id, 0, protocol::state_hash(g.anchor), end, zero(), zero());
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Wrong proof anchor', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'))]
fn proof_from_another_anchor_is_rejected() {
    let (_, api, stub, id) = setup();
    let mut end = api.get_channel(id).anchor;
    end.sequence = 8;
    stub.relay(api.contract_address, id, 0, 999, end);
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Turn window open', 'ENTRYPOINT_FAILED'))]
fn resolving_a_dispute_does_not_instantly_forfeit_next_player() {
    let (_, api, _, id) = setup();
    forced(api, id);
    api.claim_timeout(id, 1);
}

#[test]
#[available_gas(1000000000)]
fn timeout_is_enforced_from_the_onchain_response_window() {
    let (_, api, _, id) = setup();
    forced(api, id);
    testing::set_block_timestamp(1600);
    caller(white());
    api.claim_timeout(id, 1);
    let g = api.get_channel(id);
    assert_eq!(g.status, channel_models::SETTLED);
    assert_eq!(g.anchor.winner, rules::WHITE);
    assert_eq!(g.anchor.finish_reason, protocol::TIMEOUT);
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Only waiting player', 'ENTRYPOINT_FAILED'))]
fn timed_out_player_cannot_claim_the_win() {
    let (_, api, _, id) = setup();
    forced(api, id);
    testing::set_block_timestamp(1600);
    caller(black());
    api.claim_timeout(id, 1);
}

#[test]
#[available_gas(1000000000)]
fn forced_legal_move_advances_epoch_and_opponent_deadline() {
    let (_, api, _, id) = setup();
    forced(api, id);
    let first = rules::position_hash(rules::empty_position(), 9);
    caller(black());
    api
        .force_action(
            id,
            1,
            [first].span(),
            Action {
                kind: protocol::PLAY, actor: rules::BLACK, point: 40, dead: rules::empty_bits(),
            },
        );
    let g = api.get_channel(id);
    assert_eq!(g.epoch, 2);
    assert_eq!(g.anchor.next_player, rules::WHITE);
    assert_eq!(g.anchor.move_number, 1);
    assert_eq!(g.deadline, 1600);
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Turn deadline passed', 'ENTRYPOINT_FAILED'))]
fn forced_move_at_deadline_is_too_late() {
    let (_, api, _, id) = setup();
    forced(api, id);
    testing::set_block_timestamp(1600);
    caller(black());
    api
        .force_action(
            id,
            1,
            [rules::position_hash(rules::empty_position(), 9)].span(),
            Action {
                kind: protocol::PASS,
                actor: rules::BLACK,
                point: rules::NO_POINT,
                dead: rules::empty_bits(),
            },
        );
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Wrong position history', 'ENTRYPOINT_FAILED'))]
fn forced_move_cannot_erase_superko_history() {
    let (_, api, _, id) = setup();
    forced(api, id);
    caller(black());
    api
        .force_action(
            id,
            1,
            [999].span(),
            Action {
                kind: protocol::PLAY, actor: rules::BLACK, point: 40, dead: rules::empty_bits(),
            },
        );
}

#[test]
#[available_gas(1000000000)]
fn unilateral_wallet_resignation_does_not_require_the_prover() {
    let (_, api, _, id) = setup();
    caller(black());
    api.resign_channel(id);
    let g = api.get_channel(id);
    assert_eq!(g.status, channel_models::SETTLED);
    assert_eq!(g.anchor.winner, rules::WHITE);
}

#[test]
#[available_gas(1000000000)]
fn cryptographic_js_vector_matches_cairo_through_dispute_and_scoring() {
    let (terms, start, history, actions, expected) = channel_vectors::corner();
    let end = protocol::replay(terms, start, history, actions);
    assert_eq!(end, expected);
    assert_eq!(end.black_captures, 2);
    assert_eq!(end.finish_reason, protocol::AGREEMENT);
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Invalid session signature',))]
fn authentic_transcript_cannot_be_used_in_another_game() {
    let (mut terms, start, history, actions, _) = channel_vectors::corner();
    terms.game_id += 1;
    protocol::replay(terms, start, history, actions);
}

// Replaces the signature of action `index`, keeping the action itself.
fn with_signature(
    actions: Span<SignedAction>, index: u32, signature: Signature,
) -> Span<SignedAction> {
    let mut result = array![];
    let mut i = 0;
    for step in actions {
        let mut step = *step;
        if i == index {
            step.signature = signature;
        }
        result.append(step);
        i += 1;
    }
    result.span()
}

// The index of `actor`'s last action.
fn last_by(actions: Span<SignedAction>, actor: u8) -> u32 {
    let mut last = 0;
    let mut i = 0;
    for step in actions {
        if *step.action.actor == actor {
            last = i;
        }
        i += 1;
    }
    last
}

#[test]
#[available_gas(1000000000)]
fn only_final_signatures_are_verified() {
    let (terms, start, history, actions, expected) = channel_vectors::corner();
    let garbage = Signature { r: 1, s: 1 };
    let mut earlier = with_signature(actions, 0, garbage);
    earlier = with_signature(earlier, 1, garbage);
    assert_eq!(protocol::replay(terms, start, history, earlier), expected);
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Invalid session signature',))]
fn final_black_signature_is_required() {
    let (terms, start, history, actions, _) = channel_vectors::corner();
    let index = last_by(actions, rules::BLACK);
    let forged = Signature { r: *actions[index].signature.r, s: *actions[index].signature.s + 1 };
    protocol::replay(terms, start, history, with_signature(actions, index, forged));
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Invalid session signature',))]
fn final_white_signature_is_required() {
    let (terms, start, history, actions, _) = channel_vectors::corner();
    let index = last_by(actions, rules::WHITE);
    let forged = Signature { r: *actions[index].signature.r, s: *actions[index].signature.s + 1 };
    protocol::replay(terms, start, history, with_signature(actions, index, forged));
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Invalid session signature',))]
fn changed_earlier_action_breaks_later_final_signatures() {
    let (terms, start, history, actions, _) = channel_vectors::corner();
    // Black 2, White 0, Black 10, with Black's opening moved to another empty
    // point. Black's final signature (on the third action) covers the original.
    let mut opening = *actions[0];
    opening.action.point = 4;
    let changed = array![opening, *actions[1], *actions[2]];
    protocol::replay(terms, start, history, changed.span());
}

#[test]
#[available_gas(1000000000)]
#[should_panic(expected: ('Positional superko',))]
fn channel_history_survives_passes_and_resumption() {
    let (terms, mut state, _, _, _) = channel_vectors::corner();
    for p in [1, 9, 19].span() {
        rules::insert(ref state.board.black, *p);
    }
    for p in [10, 2, 12, 20].span() {
        rules::insert(ref state.board.white, *p);
    }
    let first = rules::position_hash(state.board, 9);
    state.history_root = protocol::append_history(0, first);
    state =
        protocol::force(
            terms,
            state,
            [first].span(),
            Action { kind: protocol::PLAY, actor: 1, point: 11, dead: rules::empty_bits() },
        );
    let second = rules::position_hash(state.board, 9);
    let history = [first, second].span();
    state =
        protocol::force(
            terms,
            state,
            history,
            Action {
                kind: protocol::PASS, actor: 2, point: rules::NO_POINT, dead: rules::empty_bits(),
            },
        );
    state =
        protocol::force(
            terms,
            state,
            history,
            Action {
                kind: protocol::PASS, actor: 1, point: rules::NO_POINT, dead: rules::empty_bits(),
            },
        );
    state =
        protocol::force(
            terms,
            state,
            history,
            Action {
                kind: protocol::RESUME, actor: 2, point: rules::NO_POINT, dead: rules::empty_bits(),
            },
        );
    protocol::force(
        terms,
        state,
        history,
        Action { kind: protocol::PLAY, actor: 2, point: 10, dead: rules::empty_bits() },
    );
}
