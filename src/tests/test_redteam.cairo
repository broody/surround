//! The 2026-09-28 red team's proofs of concept, as regression tests: each
//! attack must now fail. See HARDENING_PLAN.md (RT-H1, RT-H2, RT-H3).
use arbiter::channel::{ACTIVE, DISPUTE, SETTLED};
use arbiter::{Envelope, Move, REASON_TIMEOUT, apply_steps, context_hash, live_hash};
use arbiter_testing::{public_key, sign};
use starknet::syscalls::deploy_syscall;
use starknet::testing::set_block_timestamp;
use starknet::{ContractAddress, SyscallResultTrait, get_contract_address, get_tx_info};
use surround_ratings::ratings::{
    CHANNEL_ACTIVE, ISurroundRatingsDispatcher, ISurroundRatingsDispatcherTrait, QUEUE,
    SurroundRatings,
};
use surround_ratings::ticket::{Ticket, digest};
use surround_rules::go::{GoAction, GoConfig, GoRules, GoState, PLAYED_OUT};
use surround_rules::replay::{go, opening_history, pass, stone};
use surround_rules::rules;
use crate::systems::channel::{IChannelDispatcher, IChannelDispatcherTrait, channel};
use super::test_channel::{
    PK_REF, WINDOW, black, caller, channel_in, deploy, deploy_wallet, keeper, no_approvals, opening,
    ranked, stamp_game, started_in, ticket_terms, wallet, wallet_signature, white,
};
use super::test_rated::first_stone;

const CONFIG: GoConfig = GoConfig { size: 9, komi_half: 13, ticket: 0 };
const NOW: u64 = 1_700_000_000;

/// The position history after each stone in `steps`.
fn history_after(
    terms: @arbiter::Terms<GoConfig>, steps: Span<Move<GoAction>>,
) -> (Envelope<GoState>, Span<felt252>) {
    let context = context_hash::<GoRules>(terms);
    let mut env = opening(terms);
    let mut history: Array<felt252> = opening_history(terms.config).into();
    for step in steps {
        let before = env.game.board;
        env =
            apply_steps::<
                GoRules,
            >(context, terms, env, history.span(), array![*step].span(), array![].span());
        if env.game.board != before {
            history.append(rules::position_hash(env.game.board, *terms.config.size));
        }
    }
    (env, history.span())
}

// RT-H2: a seat escaped the referee's 60 s clock by timing a dispute window.
// Now the live referee acknowledges the dispute, `resolve` returns the game to
// offchain play, and the referee's flag settles it.
#[test]
#[available_gas(100000000000)]
fn a_dispute_no_longer_escapes_a_live_referee() {
    let (api, id) = started_in(deploy(), CONFIG, ranked());
    let terms = api.terms(id);
    set_block_timestamp(1000);
    caller(white());
    api.open_dispute(id, 0);
    let deadline = api.get_channel(id).deadline;
    let steps = array![stone(40), stone(41), stone(42)].span();
    let (batch, end) = stamp_game(
        @terms, opening(@terms), opening_history(@CONFIG), steps, array![1000, 31000, 61000].span(),
    );
    set_block_timestamp(deadline - 30);
    caller(keeper());
    api.submit_history(id, 0, opening(@terms), opening_history(@CONFIG), batch, no_approvals());
    let context = context_hash::<GoRules>(@terms);
    api.acknowledge(id, 0, sign(live_hash::<GoRules>(context, 0, deadline), PK_REF));
    set_block_timestamp(deadline);
    api.resolve_dispute(id, 0);
    let channel = api.get_channel(id);
    assert_eq!((channel.status, channel.epoch, channel.anchor.due), (ACTIVE, 1, 1));
    // White stalls; 60 s into its turn the referee flags it, and it settles.
    let (_, history) = history_after(@terms, steps);
    let (flag, _) = stamp_game(
        @terms, end, history, array![Move::Flag].span(), array![121001].span(),
    );
    api.submit_history(id, 1, end, history, flag, no_approvals());
    assert_eq!(api.get_channel(id).status, DISPUTE);
    set_block_timestamp(deadline + WINDOW.into());
    api.resolve_dispute(id, 1);
    let channel = api.get_channel(id);
    assert_eq!(
        (channel.status, channel.result.winner, channel.result.reason),
        (SETTLED, 1, REASON_TIMEOUT),
    );
}

// RT-H1: a losing player refused to finish by looping pass, pass, propose,
// resume. Now the second pair of passes after the one resume ends the game.

/// Black 40, white 41, black 42 (white wins on komi), then `cycles` rounds of
/// pass, pass, propose, resume, then `tail`; 59 s per step.
fn refusal(cycles: u32, tail: Array<Move<GoAction>>) -> Envelope<GoState> {
    let (api, id) = started_in(deploy(), CONFIG, ranked());
    let terms = api.terms(id);
    let context = context_hash::<GoRules>(@terms);
    let mut steps = array![stone(40), stone(41), stone(42)];
    for _ in 0..cycles {
        steps.append(pass());
        steps.append(pass());
        steps.append(go(GoAction::Propose(rules::empty_bits())));
        steps.append(go(GoAction::Resume));
    }
    for step in tail {
        steps.append(step);
    }
    let mut stamps = array![];
    let mut t = 1000;
    for _ in 0..steps.len() {
        stamps.append(t);
        t += 59000;
    }
    apply_steps::<
        GoRules,
    >(context, @terms, opening(@terms), opening_history(@CONFIG), steps.span(), stamps.span())
}

#[test]
#[available_gas(1000000000000)]
fn the_refusal_loop_ends_at_its_second_round() {
    let env = refusal(1, array![pass(), pass()]);
    assert!(env.outcome.finished);
    // Played out: the board as it stands, and white wins on komi.
    assert_eq!((env.outcome.winner, env.outcome.reason), (2, PLAYED_OUT));
}

#[test]
#[available_gas(1000000000000)]
#[should_panic(expected: 'Game already finished')]
fn there_is_no_third_round() {
    refusal(2, array![]);
}

// RT-H3: ten throwaway accounts claiming 1k and resigning at once made an
// established 4d. Now a new account can't claim 1k, and an instant onchain
// resignation counts only for the loser.

const PK_MATCHMAKER: felt252 = 0x3a7c4;
/// The farmer's wallet keys: its main account's and its throwaways'.
const WALLET_MAIN: felt252 = 0x3a1;
const WALLET_SYBIL: felt252 = 0x5b11;

/// The farmer's main account, which plays black.
fn main_account() -> ContractAddress {
    wallet('MAIN', WALLET_MAIN)
}

/// Throwaway `i`, deployed.
fn sybil(i: u32) -> ContractAddress {
    let salt = 0x5b11_0000 + i.into();
    deploy_wallet(salt, WALLET_SYBIL);
    wallet(salt, WALLET_SYBIL)
}

fn rated_world() -> (IChannelDispatcher, ISurroundRatingsDispatcher) {
    let admin = get_contract_address();
    let world = deploy();
    deploy_wallet('MAIN', WALLET_MAIN);
    let api = channel_in(world);
    api.allow_prover(channel::TEST_CLASS_HASH.try_into().unwrap(), true);
    let owner: ContractAddress = 'RATINGS_OWNER'.try_into().unwrap();
    let (address, _) = deploy_syscall(
        SurroundRatings::TEST_CLASS_HASH, 0, array![owner.into()].span(), false,
    )
        .unwrap_syscall();
    let ratings = ISurroundRatingsDispatcher { contract_address: address };
    let clock = ranked().unwrap();
    caller(owner);
    ratings.set_channel(api.contract_address, CHANNEL_ACTIVE);
    ratings.set_matchmaker(public_key(PK_MATCHMAKER));
    ratings.set_referee(clock.referee);
    ratings.set_clock_preset(clock.settings, true);
    ratings.set_prover(api.contract_address, true);
    ratings.set_board(9, 14, true);
    ratings.set_response_window(300, WINDOW);
    // The default policy: new accounts start at 23k, 17k or 6k.
    ratings.seal();
    caller(admin);
    api.set_ratings(address);
    (api, ratings)
}

fn ticket(
    api: IChannelDispatcher,
    main: ContractAddress,
    sybil: ContractAddress,
    band: u8,
    nonce: felt252,
) -> Ticket {
    let now = starknet::get_block_timestamp();
    Ticket {
        chain_id: get_tx_info().unbox().chain_id,
        channel: api.contract_address,
        black: main,
        white: sybil,
        size: 9,
        komi_half: 14,
        clock: ranked().unwrap(),
        prover: api.contract_address,
        response_seconds: WINDOW,
        source: QUEUE,
        black_band: 2,
        white_band: band,
        matchmaker: public_key(PK_MATCHMAKER),
        issued_at: now - 30,
        expires_at: now + 200,
        nonce,
    }
}

/// Open `tk`'s game, signed by the main account and the throwaway.
fn open_farmed(api: IChannelDispatcher, tk: Ticket) -> felt252 {
    let terms = ticket_terms(@tk);
    let signatures = array![
        wallet_signature(@terms, 0, WALLET_MAIN), wallet_signature(@terms, 1, WALLET_SYBIL),
    ];
    caller(keeper());
    api.open_rated_game(terms, signatures.span(), tk, sign(digest(@tk), PK_MATCHMAKER));
    terms.game_id
}

#[test]
#[available_gas(1000000000000)]
#[should_panic(expected: ('Band not allowed', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'))]
fn a_throwaway_account_cannot_claim_1k() {
    let (api, _) = rated_world();
    set_block_timestamp(NOW);
    let tk = ticket(api, main_account(), sybil(0), 4, 1);
    open_farmed(api, tk);
}

#[test]
#[available_gas(1000000000000)]
fn instant_resignations_farm_nothing() {
    let (api, ratings) = rated_world();
    let main = main_account();
    let mut t = NOW;
    // Ten throwaways at 17k resign onchain once the game has started: after
    // the referee stamped the main account's first stone.
    for i in 0..10_u32 {
        set_block_timestamp(t);
        let sybil = sybil(i);
        let tk = ticket(api, main, sybil, 2, i.into());
        let id = open_farmed(api, tk);
        first_stone(api, id, t + 10);
        caller(sybil);
        api.resign_channel(id);
        api.rate(id, tk);
        t += 300;
    }
    // Each sybil lost; the main account, which played one move, gained nothing.
    let p = ratings.player(main);
    assert_eq!((p.games, p.wins), (0, 0));
    assert_eq!(p.rank_tenths, 0);
    assert_eq!(ratings.player(sybil(0)).losses, 1);
    assert!(black() != main);
}
