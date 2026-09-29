//! Gas profile of a rated game's lifecycle, for comparing changes: each call's
//! Sierra gas and the event felts it emitted (Starknet charges archival gas
//! per key and data felt). Run `scarb test -f gas_profile` and read the output.
use core::testing::get_available_gas;
use dojo::world::WorldStorage;
use referee::{checkpoint_hash, context_hash, state_hash};
use referee_testing::{public_key, sign};
use starknet::syscalls::deploy_syscall;
use starknet::testing::{pop_log_raw, set_block_timestamp};
use starknet::{ContractAddress, SyscallResultTrait, get_contract_address, get_tx_info};
use surround_ratings::ratings::{
    CHANNEL_ACTIVE, ISurroundRatingsDispatcher, ISurroundRatingsDispatcherTrait, QUEUE,
    SurroundRatings,
};
use surround_ratings::ticket::{Ticket, digest};
use surround_rules::fixtures::{self, ReplayFixture};
use surround_rules::go::GoRules;
use surround_rules::replay::{game_steps, opening_history};
use crate::kifu::record;
use crate::systems::channel::{IChannelDispatcher, IChannelDispatcherTrait, channel};
use crate::systems::kifu::IKifuDispatcherTrait;
use super::test_channel::{
    WINDOW, approvals, black, caller, channel_in, deploy, every, keeper, opening, ranked,
    stamp_game, white,
};
use super::test_kifu::kifu_in;

const PK_MATCHMAKER: felt252 = 0x3a7c4;
const PK_BLACK: felt252 = 0x1a2b3c;
const PK_WHITE: felt252 = 0x4d5e6f;
const NOW: u64 = 1_700_000_000;

fn rated_world() -> (WorldStorage, IChannelDispatcher, ISurroundRatingsDispatcher) {
    let admin = get_contract_address();
    let world = deploy();
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
    ratings.set_board(13, 14, true);
    ratings.set_board(19, 15, true);
    ratings.set_response_window(300, WINDOW);
    caller(admin);
    api.set_ratings(address);
    set_block_timestamp(NOW);
    (world, api, ratings)
}

fn ticket(api: IChannelDispatcher, fixture: @ReplayFixture, nonce: felt252) -> Ticket {
    Ticket {
        chain_id: get_tx_info().unbox().chain_id,
        channel: api.contract_address,
        black: black(),
        white: white(),
        size: *fixture.size,
        komi_half: if *fixture.size == 19 {
            15
        } else {
            14
        },
        clock: ranked().unwrap(),
        prover: api.contract_address,
        response_seconds: WINDOW,
        source: QUEUE,
        black_band: 2,
        white_band: 2,
        matchmaker: public_key(PK_MATCHMAKER),
        issued_at: NOW - 30,
        expires_at: NOW + 270,
        nonce,
    }
}

/// Event felts emitted by `address` since the last drain: (events, keys, data).
fn drain(address: ContractAddress) -> (u32, u32, u32) {
    let (mut n, mut k, mut d) = (0, 0, 0);
    loop {
        match pop_log_raw(address) {
            Option::Some((keys, data)) => {
                n += 1;
                k += keys.len();
                d += data.len();
            },
            Option::None => { break; },
        }
    }
    (n, k, d)
}

fn report(label: ByteArray, gas: u128, addresses: Span<ContractAddress>) {
    let (mut n, mut k, mut d): (u32, u32, u32) = (0, 0, 0);
    for address in addresses {
        let (a, b, c) = drain(*address);
        n += a;
        k += b;
        d += c;
    }
    println!("{label}: {gas} gas; {n} events, {k} key and {d} data felts");
}

/// A rated game on `fixture` from creation to its kifu, profiled.
fn profile(fixture: ReplayFixture, nonce: felt252) {
    let (world, api, ratings) = rated_world();
    let kifu = kifu_in(world);
    let watch = array![
        world.dispatcher.contract_address, ratings.contract_address, api.contract_address,
        kifu.contract_address,
    ]
        .span();
    report("setup", 0, watch);
    let t = ticket(api, @fixture, nonce);
    let size = fixture.size;
    caller(black());
    let before = get_available_gas();
    let id = api.create_rated_channel(t, sign(digest(@t), PK_MATCHMAKER), public_key(PK_BLACK));
    report(format!("{size}x{size} create_rated_channel"), before - get_available_gas(), watch);
    set_block_timestamp(NOW + 60);
    caller(white());
    let before = get_available_gas();
    api.join_channel(id, public_key(PK_WHITE));
    report(format!("{size}x{size} join_channel"), before - get_available_gas(), watch);
    let terms = api.terms(id);
    let steps = game_steps(@fixture);
    let (batch, end) = stamp_game(
        @terms, opening(@terms), opening_history(@terms.config), steps, every(59000, steps),
    );
    let context = context_hash::<GoRules>(@terms);
    let acks = approvals(checkpoint_hash::<GoRules>(context, 0, state_hash::<GoRules>(@end)));
    caller(keeper());
    let before = get_available_gas();
    api.submit_history(id, 0, opening(@terms), opening_history(@terms.config), batch, acks);
    let n = steps.len();
    report(
        format!("{size}x{size} submit_history ({n} steps)"), before - get_available_gas(), watch,
    );
    let before = get_available_gas();
    api.rate(id, t);
    report(format!("{size}x{size} rate"), before - get_available_gas(), watch);
    let before = get_available_gas();
    kifu.mint(id, end, record::encode(size, steps, end.game.board).span());
    report(format!("{size}x{size} kifu mint"), before - get_available_gas(), watch);
}

#[test]
#[available_gas(10000000000000)]
fn gas_profile_9x9() {
    profile(fixtures::cgos_9_1682833(), 1);
}

#[test]
#[available_gas(10000000000000)]
fn gas_profile_13x13() {
    profile(fixtures::cgos_13_277988(), 2);
}

#[test]
#[available_gas(10000000000000)]
fn gas_profile_19x19() {
    profile(fixtures::kgs_2019_04_26_17(), 3);
}
