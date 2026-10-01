//! Surround's channel in a Dojo test world: games open on both wallets'
//! signed terms, under the id of their wallets and session keys, recorded
//! games settle through `submit_history`, disputes fall back to forced onchain
//! Go, and the superko witness cannot be erased. Ranked games are timed: the
//! referee's stamps and attestation replay onchain, the first stamp dates the
//! game, a flag settles as a timeout, and forced play pauses the clock.
use arbiter::channel::{ACTIVE, DISPUTE, FORCED, SETTLED};
use arbiter::clocks::{Byoyomi, Standard, StandardClock, decode, encode};
use arbiter::{
    Batch, Clock, Envelope, Move, REASON_ABANDON, REASON_RESIGN, REASON_TIMEOUT, REFEREE, Signature,
    Terms, TimeControl, action_hash, actor, apply_steps, checkpoint_hash, context_hash, force,
    game_id_of, open, reopen_hash, stamp_hash, state_hash, terms_message,
};
use arbiter_dojo::models::{e_ChannelUpdated, m_ChannelState, m_ChannelTerms, m_ProverAllowed};
use arbiter_testing::{public_key, sign};
use core::hash::HashStateTrait;
use core::pedersen::PedersenTrait;
use dojo::world::{WorldStorage, WorldStorageTrait, world};
use dojo_cairo_test::{
    ContractDef, ContractDefTrait, NamespaceDef, TestResource, WorldStorageTestTrait,
    spawn_test_world,
};
use starknet::syscalls::{deploy_syscall, get_class_hash_at_syscall};
use starknet::testing::{set_account_contract_address, set_block_timestamp, set_contract_address};
use starknet::{ContractAddress, SyscallResultTrait, get_tx_info};
use surround_ratings::ticket::{Ticket, digest};
use surround_rules::fixtures::{self, ReplayFixture};
use surround_rules::go::{AGREEMENT, GoAction, GoConfig, GoRules, GoState};
use surround_rules::replay::{config, game_steps, opening_history, stone};
use surround_rules::rules::{self, BLACK, WHITE};
use crate::models::{e_KifuSummary, e_PlayerRank, m_Kifu, m_RatedGame, m_Settlement};
use crate::systems::channel::{IChannelDispatcher, IChannelDispatcherTrait, channel};
use crate::systems::kifu::kifu;
use super::account::TestAccount;

/// Black's and white's session keys, which these tests' games use unless
/// they say otherwise (`session_keys`).
pub const PK_BLACK: felt252 = 0x1a2b3c;
pub const PK_WHITE: felt252 = 0x4d5e6f;
/// The keeper that referees ranked games.
pub const PK_REF: felt252 = 0x7e7e7e;
/// The wallets' own keys, apart from the per-game session keys.
pub const WALLET_BLACK: felt252 = 0xb1ac;
pub const WALLET_WHITE: felt252 = 0x3417e;
pub const WINDOW: u32 = 3600;
const TURN: u64 = 60000;

/// A test wallet (`TestAccount`) deployed from zero with `salt`, at the
/// address Starknet derives for it.
pub fn wallet(salt: felt252, key: felt252) -> ContractAddress {
    let class_hash: felt252 = TestAccount::TEST_CLASS_HASH.into();
    let calldata = PedersenTrait::new(0).update(public_key(key)).update(1).finalize();
    let hash = PedersenTrait::new(0)
        .update('STARKNET_CONTRACT_ADDRESS')
        .update(0)
        .update(salt)
        .update(class_hash)
        .update(calldata)
        .update(5)
        .finalize();
    let hash: u256 = hash.into();
    let bound: u256 = 0x800000000000000000000000000000000000000000000000000000000000000 - 256;
    let address: felt252 = (hash % bound).try_into().unwrap();
    address.try_into().unwrap()
}

/// Deploy `wallet(salt, key)`, once.
pub fn deploy_wallet(salt: felt252, key: felt252) {
    let address = wallet(salt, key);
    if get_class_hash_at_syscall(address).unwrap_or(0.try_into().unwrap()).into() != 0 {
        return;
    }
    let (deployed, _) = deploy_syscall(
        TestAccount::TEST_CLASS_HASH, salt, array![public_key(key)].span(), true,
    )
        .unwrap_syscall();
    assert_eq!(deployed, address);
}

pub fn black() -> ContractAddress {
    wallet('BLACK', WALLET_BLACK)
}

pub fn white() -> ContractAddress {
    wallet('WHITE', WALLET_WHITE)
}

pub fn keeper() -> ContractAddress {
    'KEEPER'.try_into().unwrap()
}

pub fn caller(address: ContractAddress) {
    set_contract_address(address);
    set_account_contract_address(address);
}

/// The Surround namespace: the channel and Kifu, with their models, and the
/// two players' wallets.
pub fn deploy() -> WorldStorage {
    let ndef = NamespaceDef {
        namespace: "surround",
        resources: [
            TestResource::Model(m_ChannelTerms::TEST_CLASS_HASH),
            TestResource::Model(m_ChannelState::TEST_CLASS_HASH),
            TestResource::Model(m_ProverAllowed::TEST_CLASS_HASH),
            TestResource::Event(e_ChannelUpdated::TEST_CLASS_HASH),
            TestResource::Model(m_Settlement::TEST_CLASS_HASH),
            TestResource::Model(m_RatedGame::TEST_CLASS_HASH),
            TestResource::Event(e_PlayerRank::TEST_CLASS_HASH),
            TestResource::Model(m_Kifu::TEST_CLASS_HASH),
            TestResource::Event(e_KifuSummary::TEST_CLASS_HASH),
            TestResource::Contract(channel::TEST_CLASS_HASH),
            TestResource::Contract(kifu::TEST_CLASS_HASH),
        ]
            .span(),
    };
    let defs: Span<ContractDef> = [
        ContractDefTrait::new(@"surround", @"channel")
            .with_writer_of([dojo::utils::bytearray_hash(@"surround")].span()),
        ContractDefTrait::new(@"surround", @"kifu")
            .with_writer_of(
                [selector_from_tag!("surround-Kifu"), selector_from_tag!("surround-KifuSummary")]
                    .span(),
            ),
    ]
        .span();
    let mut world: WorldStorage = spawn_test_world(world::TEST_CLASS_HASH, [ndef].span());
    world.sync_perms_and_inits(defs);
    deploy_wallet('BLACK', WALLET_BLACK);
    deploy_wallet('WHITE', WALLET_WHITE);
    world
}

fn setup() -> IChannelDispatcher {
    channel_in(deploy())
}

/// A world whose channel trusts itself as the prover, before any game.
fn trusting() -> IChannelDispatcher {
    let api = setup();
    api.allow_prover(channel::TEST_CLASS_HASH.try_into().unwrap(), true);
    api
}

pub fn channel_in(world: WorldStorage) -> IChannelDispatcher {
    let (contract_address, _) = world.dns(@"channel").unwrap();
    IChannelDispatcher { contract_address }
}

/// Black's and white's session private keys for one game.
#[derive(Copy, Drop)]
pub struct SessionKeys {
    pub black: felt252,
    pub white: felt252,
}

/// The session keys of another game between black and white: `PK_BLACK` and
/// `PK_WHITE` plus `salt`. A game's id is its wallets' and session keys' hash,
/// so games the same wallets play side by side need different keys.
pub fn session_keys(salt: felt252) -> SessionKeys {
    SessionKeys { black: PK_BLACK + salt, white: PK_WHITE + salt }
}

/// `terms` under its seats' game id: the id that goes with its players and
/// session keys, after a test changes them.
pub fn own_id(terms: Terms<GoConfig>) -> Terms<GoConfig> {
    Terms { game_id: game_id_of(terms.players, terms.keys), ..terms }
}

/// `terms` for the same wallets on the session keys `keys`: another game,
/// under its own id. Go takes no randomness: the keys are the tips.
pub fn rekeyed(terms: Terms<GoConfig>, keys: SessionKeys) -> Terms<GoConfig> {
    let keys = array![public_key(keys.black), public_key(keys.white)].span();
    own_id(Terms { keys, rng_tips: keys, ..terms })
}

/// A time control refereed by PK_REF.
fn refereed(settings: Standard) -> Option<TimeControl> {
    Option::Some(
        TimeControl { referee: public_key(PK_REF), settings: encode(@settings), rng_tip: 0 },
    )
}

/// Surround's per-turn timer: 60 s per turn.
pub fn ranked() -> Option<TimeControl> {
    refereed(Standard { turn_ms: TURN, bank_ms: 0, increment_ms: 0, byoyomi: Option::None })
}

/// Byo-yomi in these tests: 60 s of main time, then 3 periods of 10 s.
fn byoyomi() -> Option<TimeControl> {
    refereed(
        Standard {
            turn_ms: 0,
            bank_ms: 60000,
            increment_ms: 0,
            byoyomi: Option::Some(Byoyomi { periods: 3, period_ms: 10000 }),
        },
    )
}

/// The per-turn timer's clocks: no bank and no periods.
fn no_bank() -> Span<felt252> {
    encode(@StandardClock { banks: array![0, 0].span(), periods: array![].span() })
}

/// Black (seat 0) and white (seat 1) on `api`'s channel, which stands in as
/// the trusted prover, on the session keys `PK_BLACK` and `PK_WHITE`, under
/// their game id. Go takes no randomness: each seat's session key is its tip.
pub fn terms_for(
    api: IChannelDispatcher, config: GoConfig, clock: Option<TimeControl>,
) -> Terms<GoConfig> {
    let players = array![black().into(), white().into()].span();
    let keys = array![public_key(PK_BLACK), public_key(PK_WHITE)].span();
    Terms {
        chain_id: get_tx_info().unbox().chain_id,
        channel: api.contract_address.into(),
        game_id: game_id_of(players, keys),
        prover: api.contract_address.into(),
        response_seconds: WINDOW,
        clock,
        players,
        keys,
        rng_tips: keys,
        config,
    }
}

/// The terms of `ticket`'s game: its players, board, clock, prover and window,
/// with its digest in the config, on the session keys `PK_BLACK` and
/// `PK_WHITE`, under the seats' game id.
pub fn ticket_terms(ticket: @Ticket) -> Terms<GoConfig> {
    let players = array![(*ticket.black).into(), (*ticket.white).into()].span();
    let keys = array![public_key(PK_BLACK), public_key(PK_WHITE)].span();
    Terms {
        chain_id: *ticket.chain_id,
        channel: (*ticket.channel).into(),
        game_id: game_id_of(players, keys),
        prover: (*ticket.prover).into(),
        response_seconds: *ticket.response_seconds,
        clock: Option::Some(*ticket.clock),
        players,
        keys,
        rng_tips: keys,
        config: GoConfig {
            size: *ticket.size, komi_half: *ticket.komi_half, ticket: digest(ticket),
        },
    }
}

/// Seat `seat`'s wallet signature over `terms`, with the wallet key `key`.
pub fn wallet_signature(terms: @Terms<GoConfig>, seat: u32, key: felt252) -> Span<felt252> {
    let context = context_hash::<GoRules>(terms);
    let message = terms_message::<
        GoRules,
    >(*terms.chain_id, *terms.game_id, context, *terms.players.at(seat));
    let signature = sign(message, key);
    array![signature.r, signature.s].span()
}

/// Black's and white's wallet signatures over `terms`.
pub fn signed_by_both(terms: @Terms<GoConfig>) -> Span<Span<felt252>> {
    array![wallet_signature(terms, 0, WALLET_BLACK), wallet_signature(terms, 1, WALLET_WHITE)]
        .span()
}

/// Go takes no randomness: no referee signs a tip.
pub fn no_tip() -> Signature {
    Signature { r: 0, s: 0 }
}

/// The keeper opens `terms` with both wallets' signatures: anyone may.
pub fn open_terms(api: IChannelDispatcher, terms: Terms<GoConfig>) {
    caller(keeper());
    api.open_game(terms, signed_by_both(@terms), no_tip());
}

/// Black and white open a game. The channel system itself stands in as the
/// trusted prover; these tests settle by onchain replay.
fn started(config: GoConfig) -> (IChannelDispatcher, felt252) {
    started_with(config, Option::None)
}

fn started_with(config: GoConfig, clock: Option<TimeControl>) -> (IChannelDispatcher, felt252) {
    started_in(deploy(), config, clock)
}

/// Trust the channel as the prover (as the namespace owner) and open a game,
/// leaving white as the caller.
pub fn started_in(
    world: WorldStorage, config: GoConfig, clock: Option<TimeControl>,
) -> (IChannelDispatcher, felt252) {
    let api = channel_in(world);
    api.allow_prover(channel::TEST_CLASS_HASH.try_into().unwrap(), true);
    let terms = terms_for(api, config, clock);
    open_terms(api, terms);
    caller(white());
    (api, terms.game_id)
}

pub fn opening(terms: @Terms<GoConfig>) -> Envelope<GoState> {
    open::<GoRules>(terms)
}

/// Sign each step as the two clients would and, in a timed game, stamp it as
/// the referee would, tracking the superko witness from `history`. Returns the
/// batch replay takes (each seat's final signature, the stamps and the
/// referee's final attestation) and the end state.
pub fn stamp_game(
    terms: @Terms<GoConfig>,
    start: Envelope<GoState>,
    history: Span<felt252>,
    steps: Span<Move<GoAction>>,
    stamps: Span<u64>,
) -> (Batch<GoAction>, Envelope<GoState>) {
    stamp_game_by(session_keys(0), terms, start, history, steps, stamps)
}

/// `stamp_game`, with the seats signing on the session keys `keys`.
pub fn stamp_game_by(
    keys: SessionKeys,
    terms: @Terms<GoConfig>,
    start: Envelope<GoState>,
    history: Span<felt252>,
    steps: Span<Move<GoAction>>,
    stamps: Span<u64>,
) -> (Batch<GoAction>, Envelope<GoState>) {
    let context = context_hash::<GoRules>(terms);
    let size = *terms.config.size;
    let mut env = start;
    let mut history = history;
    let mut finals = no_approvals();
    let mut i = 0;
    for step in steps {
        let seat = actor::<GoRules>(@env, step);
        let message = action_hash::<GoRules>(context, env.seq, env.transcript, step);
        finals =
            if seat == REFEREE {
                finals
            } else if seat == 0 {
                array![sign(message, keys.black), *finals.at(1)].span()
            } else {
                array![*finals.at(0), sign(message, keys.white)].span()
            };
        let stamp = if stamps.is_empty() {
            stamps
        } else {
            stamps.slice(i, 1)
        };
        let before = env.game.board;
        env = apply_steps::<GoRules>(context, terms, env, history, array![*step].span(), stamp);
        if env.game.board != before {
            let mut next: Array<felt252> = history.into();
            next.append(rules::position_hash(env.game.board, size));
            history = next.span();
        }
        i += 1;
    }
    let attestation = match env.clock {
        Option::Some(clock) => sign(
            stamp_hash::<GoRules>(context, env.seq, env.transcript, @clock), PK_REF,
        ),
        Option::None => Signature { r: 0, s: 0 },
    };
    (Batch { steps, stamps, signatures: finals, attestation }, env)
}

/// Sign an untimed game from the opening.
pub fn sign_game(
    terms: @Terms<GoConfig>, steps: Span<Move<GoAction>>,
) -> (Batch<GoAction>, Envelope<GoState>) {
    stamp_game(terms, opening(terms), opening_history(terms.config), steps, array![].span())
}

/// One stamp per step, `interval` ms apart from the first at 1 s.
pub fn every(interval: u64, steps: Span<Move<GoAction>>) -> Span<u64> {
    every_from(1000, interval, steps)
}

/// One stamp per step, `interval` ms apart from the first at `start` ms.
pub fn every_from(start: u64, interval: u64, steps: Span<Move<GoAction>>) -> Span<u64> {
    let mut stamps = array![];
    let mut t = start;
    for _ in steps {
        stamps.append(t);
        t += interval;
    }
    stamps.span()
}

pub fn approvals(message: felt252) -> Span<Signature> {
    approvals_by(session_keys(0), message)
}

/// Both seats' approvals of `message` on the session keys `keys`.
pub fn approvals_by(keys: SessionKeys, message: felt252) -> Span<Signature> {
    array![sign(message, keys.black), sign(message, keys.white)].span()
}

pub fn no_approvals() -> Span<Signature> {
    array![Signature { r: 0, s: 0 }, Signature { r: 0, s: 0 }].span()
}

fn settle_recorded(fixture: ReplayFixture) {
    let (api, id) = started(config(@fixture));
    let terms = api.terms(id);
    let steps = game_steps(@fixture);
    let (batch, end) = sign_game(@terms, steps);
    let context = context_hash::<GoRules>(@terms);
    let acks = approvals(checkpoint_hash::<GoRules>(context, 0, state_hash::<GoRules>(@end)));
    caller(keeper());
    api.submit_history(id, 0, opening(@terms), opening_history(@terms.config), batch, acks);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    assert_eq!(channel.anchor.hash, state_hash::<GoRules>(@end));
    assert_eq!(channel.result.reason, AGREEMENT);
    // Untimed: no stamp dates it.
    assert_eq!(channel.started, 0);
    let winner = if fixture.margin_half > 0 {
        BLACK
    } else {
        WHITE
    };
    assert_eq!(channel.result.winner, winner);
}

/// Dispute from the opening anchor and resolve into forced play (epoch 1).
fn forced_play() -> (IChannelDispatcher, felt252) {
    let (api, id) = started(GoConfig { size: 9, komi_half: 13, ticket: 0 });
    caller(black());
    api.open_dispute(id, 0);
    set_block_timestamp(WINDOW.into());
    api.resolve_dispute(id, 0);
    (api, id)
}

#[test]
#[available_gas(100000000000)]
fn opening_fixes_terms_context_and_anchor() {
    let api = trusting();
    let terms = terms_for(api, GoConfig { size: 19, komi_half: 13, ticket: 0 }, ranked());
    let id = terms.game_id;
    open_terms(api, terms);
    // Play starts at once, on exactly the terms both wallets signed.
    assert_eq!(api.terms(id), terms);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, ACTIVE);
    assert_eq!((channel.player_0, channel.player_1), (black(), white()));
    assert_eq!((channel.key_0, channel.key_1), (public_key(PK_BLACK), public_key(PK_WHITE)));
    assert_eq!((channel.tip_0, channel.tip_1), (public_key(PK_BLACK), public_key(PK_WHITE)));
    assert_eq!(channel.context, context_hash::<GoRules>(@terms));
    assert_eq!(channel.anchor.hash, state_hash::<GoRules>(@opening(@terms)));
    assert_eq!(channel.anchor.due, 0);
    // No stamp yet: the game hasn't started.
    assert_eq!(channel.started, 0);
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Game already open', 'ENTRYPOINT_FAILED'))]
fn a_game_opens_once() {
    let api = trusting();
    let terms = terms_for(api, GoConfig { size: 9, komi_half: 13, ticket: 0 }, Option::None);
    open_terms(api, terms);
    open_terms(api, terms);
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Game already open', 'ENTRYPOINT_FAILED'))]
fn a_second_game_needs_fresh_session_keys() {
    let api = trusting();
    let terms = terms_for(api, GoConfig { size: 9, komi_half: 13, ticket: 0 }, Option::None);
    open_terms(api, terms);
    // Another game between the same wallets, on the same session keys, has the
    // same id.
    open_terms(api, Terms { config: GoConfig { komi_half: 15, ..terms.config }, ..terms });
}

#[test]
#[available_gas(100000000000)]
fn the_same_wallets_play_side_by_side_on_fresh_keys() {
    let api = trusting();
    let config = GoConfig { size: 9, komi_half: 13, ticket: 0 };
    let first = terms_for(api, config, Option::None);
    let keys = session_keys(1);
    let second = rekeyed(first, keys);
    open_terms(api, first);
    open_terms(api, second);
    assert!(second.game_id != first.game_id);
    // White resigns the second game on its session key, and both approve; the
    // first plays on.
    let steps = array![stone(40), Move::Resign(1)].span();
    let (batch, end) = stamp_game_by(
        keys, @second, opening(@second), opening_history(@config), steps, array![].span(),
    );
    let context = context_hash::<GoRules>(@second);
    let acks = approvals_by(
        keys, checkpoint_hash::<GoRules>(context, 0, state_hash::<GoRules>(@end)),
    );
    api.submit_history(second.game_id, 0, opening(@second), opening_history(@config), batch, acks);
    let channel = api.get_channel(second.game_id);
    assert_eq!(
        (channel.status, channel.result.winner, channel.result.reason),
        (SETTLED, BLACK, REASON_RESIGN),
    );
    assert_eq!(api.get_channel(first.game_id).status, ACTIVE);
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Invalid game id', 'ENTRYPOINT_FAILED'))]
fn a_game_opens_only_under_its_seats_id() {
    let api = trusting();
    let terms = terms_for(api, GoConfig { size: 9, komi_half: 13, ticket: 0 }, Option::None);
    // Both wallets sign the game under an id of their choosing, as clients once
    // chose ids.
    open_terms(api, Terms { game_id: 0x6a3e, ..terms });
}

/// A wallet white keeps apart from the one it plays with.
const WALLET_SHADOW: felt252 = 0x5ad0;

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Invalid game id', 'ENTRYPOINT_FAILED'))]
fn other_wallets_cannot_take_a_games_id() {
    // White, losing black's and white's game, opens another under its id first,
    // with a wallet of its own in black's seat and even black's session key, so
    // the real game could never open and settle. Both wallets sign, but the id
    // is black's wallet's too.
    let api = trusting();
    let game = terms_for(api, GoConfig { size: 9, komi_half: 13, ticket: 0 }, Option::None);
    deploy_wallet('SHADOW', WALLET_SHADOW);
    let players = array![wallet('SHADOW', WALLET_SHADOW).into(), white().into()].span();
    let terms = Terms { players, ..game };
    let signatures = array![
        wallet_signature(@terms, 0, WALLET_SHADOW), wallet_signature(@terms, 1, WALLET_WHITE),
    ];
    caller(white());
    api.open_game(terms, signatures.span(), no_tip());
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Invalid wallet signature', 'ENTRYPOINT_FAILED'))]
fn both_wallets_sign_the_terms() {
    let api = trusting();
    let terms = terms_for(api, GoConfig { size: 9, komi_half: 13, ticket: 0 }, Option::None);
    // White signed the same game with another komi.
    let other = Terms { config: GoConfig { komi_half: 15, ..terms.config }, ..terms };
    let signatures = array![
        wallet_signature(@terms, 0, WALLET_BLACK), wallet_signature(@other, 1, WALLET_WHITE),
    ];
    caller(keeper());
    api.open_game(terms, signatures.span(), no_tip());
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Invalid wallet signature', 'ENTRYPOINT_FAILED'))]
fn a_seats_session_key_is_not_its_wallet() {
    let api = trusting();
    let terms = terms_for(api, GoConfig { size: 9, komi_half: 13, ticket: 0 }, Option::None);
    // Black signs with its session key instead of its wallet's key.
    let signatures = array![
        wallet_signature(@terms, 0, PK_BLACK), wallet_signature(@terms, 1, WALLET_WHITE),
    ];
    caller(keeper());
    api.open_game(terms, signatures.span(), no_tip());
}

#[test]
#[available_gas(100000000000)]
fn recorded_9x9_game_settles_in_one_transaction() {
    settle_recorded(fixtures::cgos_9_1682827());
}

#[test]
#[available_gas(1000000000000)]
fn recorded_13x13_game_settles_in_one_transaction() {
    settle_recorded(fixtures::cgos_13_277988());
}

#[test]
#[available_gas(100000000000)]
fn unapproved_result_settles_after_the_window() {
    let fixture = fixtures::cgos_9_1682833();
    let (api, id) = started(config(@fixture));
    let terms = api.terms(id);
    let (batch, _) = sign_game(@terms, game_steps(@fixture));
    caller(white());
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
    assert_eq!(api.get_channel(id).status, DISPUTE);
    set_block_timestamp(WINDOW.into());
    api.resolve_dispute(id, 0);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    assert_eq!(channel.result.winner, WHITE);
}

#[test]
#[available_gas(100000000000)]
fn forced_move_then_timeout() {
    let (api, id) = forced_play();
    let terms = api.terms(id);
    assert_eq!(api.get_channel(id).status, FORCED);
    caller(black());
    api
        .force_steps(
            id, 1, opening(@terms), opening_history(@terms.config), array![stone(40)].span(),
        );
    let channel = api.get_channel(id);
    assert_eq!(channel.anchor.due, 1);
    set_block_timestamp(channel.deadline);
    api.claim_timeout(id, 2);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    assert_eq!(channel.result.winner, BLACK);
    // The chain judged it, not a referee.
    assert_eq!(channel.result.reason, REASON_ABANDON);
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Wrong position history', 'ENTRYPOINT_FAILED'))]
fn forced_move_cannot_erase_superko_history() {
    let (api, id) = forced_play();
    let terms = api.terms(id);
    caller(black());
    api.force_steps(id, 1, opening(@terms), array![999].span(), array![stone(40)].span());
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Not your step', 'ENTRYPOINT_FAILED'))]
fn white_cannot_play_blacks_forced_move() {
    let (api, id) = forced_play();
    let terms = api.terms(id);
    caller(white());
    api
        .force_steps(
            id, 1, opening(@terms), opening_history(@terms.config), array![stone(40)].span(),
        );
}

#[test]
#[available_gas(100000000000)]
fn both_players_can_resume_offchain_play() {
    let (api, id) = forced_play();
    let terms = api.terms(id);
    let anchor = api.get_channel(id).anchor.hash;
    let context = context_hash::<GoRules>(@terms);
    api.resume_channel(id, 1, approvals(reopen_hash::<GoRules>(context, 1, anchor)));
    assert_eq!(api.get_channel(id).status, ACTIVE);
}

#[test]
#[available_gas(100000000000)]
fn wallet_resignation_needs_no_prover() {
    let (api, id) = started(GoConfig { size: 9, komi_half: 13, ticket: 0 });
    caller(black());
    api.resign_channel(id);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    assert_eq!(channel.result.winner, WHITE);
    assert_eq!(channel.result.reason, REASON_RESIGN);
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Untrusted prover class', 'ENTRYPOINT_FAILED'))]
fn untrusted_prover_rejected() {
    let api = setup();
    open_terms(api, terms_for(api, GoConfig { size: 9, komi_half: 13, ticket: 0 }, Option::None));
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Unsupported board size', 'ENTRYPOINT_FAILED'))]
fn unsupported_board_size_rejected() {
    let api = trusting();
    open_terms(api, terms_for(api, GoConfig { size: 10, komi_half: 13, ticket: 0 }, Option::None));
}

#[test]
#[available_gas(100000000000)]
fn ranked_terms_carry_the_clock() {
    let (api, id) = started_with(GoConfig { size: 19, komi_half: 13, ticket: 0 }, ranked());
    let terms = api.terms(id);
    assert_eq!(terms.clock, ranked());
    let channel = api.get_channel(id);
    assert_eq!(channel.referee, public_key(PK_REF));
    assert_eq!(decode::<Standard>(channel.clock_settings).turn_ms, TURN);
    assert_eq!(channel.context, context_hash::<GoRules>(@terms));
    assert_eq!(channel.anchor.hash, state_hash::<GoRules>(@opening(@terms)));
    assert_eq!(
        opening(@terms).clock,
        Option::Some(Clock { seats: no_bank(), used: 0, stamp: 0, started: 0 }),
    );
    assert_eq!(channel.started, 0);
}

#[test]
#[available_gas(1000000000000)]
fn stamped_recorded_game_settles_in_one_transaction() {
    let fixture = fixtures::cgos_9_1682827();
    let (api, id) = started_with(config(@fixture), ranked());
    let terms = api.terms(id);
    let steps = game_steps(@fixture);
    // Every answer, scoring included, inside its 60 s turn, from the first
    // stamp at 2026-09-24 12:00:00.5 UTC.
    let (batch, end) = stamp_game(
        @terms,
        opening(@terms),
        opening_history(@terms.config),
        steps,
        every_from(1790251200500, 59000, steps),
    );
    assert_eq!(end.clock.unwrap().started, 1790251200500);
    let context = context_hash::<GoRules>(@terms);
    let acks = approvals(checkpoint_hash::<GoRules>(context, 0, state_hash::<GoRules>(@end)));
    caller(keeper());
    api.submit_history(id, 0, opening(@terms), opening_history(@terms.config), batch, acks);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    assert_eq!(channel.anchor.hash, state_hash::<GoRules>(@end));
    assert_eq!(channel.result.winner, BLACK);
    assert_eq!(channel.result.reason, AGREEMENT);
    // The first stamp dates the game, in seconds.
    assert_eq!(channel.started, 1790251200);
}

#[test]
#[available_gas(100000000000)]
fn flag_settles_as_a_timeout() {
    let (api, id) = started_with(GoConfig { size: 9, komi_half: 13, ticket: 0 }, ranked());
    let terms = api.terms(id);
    // Black plays; white lets its 60 s run out and the referee flags it.
    let steps = array![stone(40), Move::Flag].span();
    let (batch, end) = stamp_game(
        @terms, opening(@terms), opening_history(@terms.config), steps, array![1000, 61001].span(),
    );
    assert_eq!(end.outcome.reason, REASON_TIMEOUT);
    // The flagged seat will not approve it; the winner's submission waits out
    // the dispute window.
    caller(black());
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
    assert_eq!(api.get_channel(id).status, DISPUTE);
    set_block_timestamp(WINDOW.into());
    api.resolve_dispute(id, 0);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    assert_eq!(channel.result.winner, BLACK);
    assert_eq!(channel.result.reason, REASON_TIMEOUT);
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Clock not expired', 'ENTRYPOINT_FAILED'))]
fn no_flag_inside_the_turn() {
    let (api, id) = started_with(GoConfig { size: 9, komi_half: 13, ticket: 0 }, ranked());
    let terms = api.terms(id);
    let steps = array![stone(40), Move::Flag].span();
    let (batch, _) = stamp_game(
        @terms, opening(@terms), opening_history(@terms.config), steps, array![1000, 61001].span(),
    );
    // The same flag a millisecond earlier, while white still had time.
    let batch = Batch { stamps: array![1000, 61000].span(), ..batch };
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Invalid session signature', 'ENTRYPOINT_FAILED'))]
fn stamps_need_the_referees_attestation() {
    let (api, id) = started_with(GoConfig { size: 9, komi_half: 13, ticket: 0 }, ranked());
    let terms = api.terms(id);
    let steps = array![stone(40), stone(41)].span();
    let (batch, end) = stamp_game(
        @terms, opening(@terms), opening_history(@terms.config), steps, array![1000, 2000].span(),
    );
    // The same attestation, signed by a seat instead of the referee.
    let context = context_hash::<GoRules>(@terms);
    let clock = end.clock.unwrap();
    let forged = sign(stamp_hash::<GoRules>(context, end.seq, end.transcript, @clock), PK_BLACK);
    let batch = Batch { attestation: forged, ..batch };
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Wrong stamp count', 'ENTRYPOINT_FAILED'))]
fn ranked_steps_need_their_stamps() {
    let (api, id) = started_with(GoConfig { size: 9, komi_half: 13, ticket: 0 }, ranked());
    let terms = api.terms(id);
    let (batch, _) = sign_game(@terms, array![stone(40)].span());
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
}

#[test]
#[available_gas(100000000000)]
fn forced_play_pauses_the_clock() {
    let config = GoConfig { size: 9, komi_half: 13, ticket: 0 };
    let (api, id) = started_with(config, ranked());
    let terms = api.terms(id);
    let context = context_hash::<GoRules>(@terms);
    // The referee is down: black disputes and the window resolves into forced
    // play on the channel's windows.
    caller(black());
    api.open_dispute(id, 0);
    set_block_timestamp(WINDOW.into());
    api.resolve_dispute(id, 0);
    api.force_steps(id, 1, opening(@terms), opening_history(@config), array![stone(40)].span());
    let forced = force::<
        GoRules,
    >(context, @terms, opening(@terms), opening_history(@config), 0, array![stone(40)].span());
    assert_eq!(forced.clock.unwrap(), Clock { seats: no_bank(), used: 0, stamp: 0, started: 0 });
    let channel = api.get_channel(id);
    let anchor = channel.anchor.hash;
    assert_eq!(anchor, state_hash::<GoRules>(@forced));
    // Unstamped forced steps don't start the game.
    assert_eq!(channel.started, 0);
    // Back offchain, the next stamp restarts the clock without charging
    // white for the hours spent onchain.
    api.resume_channel(id, 2, approvals(reopen_hash::<GoRules>(context, 2, anchor)));
    let mut history: Array<felt252> = opening_history(@config).into();
    history.append(rules::position_hash(forced.game.board, 9));
    let steps = array![stone(41), stone(42)].span();
    let (batch, end) = stamp_game(
        @terms, forced, history.span(), steps, array![10000000, 10030000].span(),
    );
    assert_eq!(
        end.clock.unwrap(), Clock { seats: no_bank(), used: 0, stamp: 10030000, started: 10000000 },
    );
    let acks = approvals(checkpoint_hash::<GoRules>(context, 3, state_hash::<GoRules>(@end)));
    api.submit_history(id, 3, forced, history.span(), batch, acks);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, ACTIVE);
    assert_eq!(channel.anchor.hash, state_hash::<GoRules>(@end));
    // The first stamp the channel received dates the game.
    assert_eq!(channel.started, 10000);
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Referee is a seat', 'ENTRYPOINT_FAILED'))]
fn a_seat_cannot_referee() {
    let api = trusting();
    let clock = TimeControl { referee: public_key(PK_BLACK), ..ranked().unwrap() };
    let config = GoConfig { size: 9, komi_half: 13, ticket: 0 };
    open_terms(api, terms_for(api, config, Option::Some(clock)));
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Go takes no randomness', 'ENTRYPOINT_FAILED'))]
fn a_clock_cannot_ask_for_rolls() {
    // Go never rolls: the game would wait for a referee's tip nobody has.
    let api = trusting();
    let clock = TimeControl { rng_tip: 1, ..ranked().unwrap() };
    let config = GoConfig { size: 9, komi_half: 13, ticket: 0 };
    open_terms(api, terms_for(api, config, Option::Some(clock)));
}

#[test]
#[available_gas(100000000000)]
fn byoyomi_game_loses_a_period_then_flags() {
    let (api, id) = started_with(GoConfig { size: 9, komi_half: 13, ticket: 0 }, byoyomi());
    let terms = api.terms(id);
    assert_eq!(terms.clock, byoyomi());
    let channel = api.get_channel(id);
    let settings: Standard = decode(channel.clock_settings);
    assert_eq!(settings.byoyomi, Option::Some(Byoyomi { periods: 3, period_ms: 10000 }));
    // White spends its main time and 15 s: one period lost. Then, with 20 s
    // of periods left, it stalls and the referee flags it.
    let steps = array![stone(40), stone(41), stone(42), Move::Flag].span();
    let (batch, end) = stamp_game(
        @terms,
        opening(@terms),
        opening_history(@terms.config),
        steps,
        array![1000, 76000, 77000, 97001].span(),
    );
    let seats: StandardClock = decode(end.clock.unwrap().seats);
    assert_eq!(seats.periods, array![3, 2].span());
    caller(black());
    api
        .submit_history(
            id, 0, opening(@terms), opening_history(@terms.config), batch, no_approvals(),
        );
    set_block_timestamp(WINDOW.into());
    api.resolve_dispute(id, 0);
    let channel = api.get_channel(id);
    assert_eq!(channel.status, SETTLED);
    assert_eq!(channel.result.winner, BLACK);
    assert_eq!(channel.result.reason, REASON_TIMEOUT);
}

#[test]
#[available_gas(100000000000)]
#[should_panic(expected: ('Invalid byo-yomi', 'ENTRYPOINT_FAILED'))]
fn byoyomi_needs_a_period() {
    let api = trusting();
    let clock = refereed(
        Standard {
            turn_ms: 0,
            bank_ms: 60000,
            increment_ms: 0,
            byoyomi: Option::Some(Byoyomi { periods: 0, period_ms: 10000 }),
        },
    );
    open_terms(api, terms_for(api, GoConfig { size: 9, komi_half: 13, ticket: 0 }, clock));
}
