// Reading SurroundRatings' events and the channel's `RatedGame`, and the
// keeper hooks built on them.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import { GAME_VOIDED, TICKET_USED, decodeTicket, ratedGame, ratingEvent } from '../chain.mjs';
import * as hooks from '../keeper-hooks.mjs';

const RATINGS = 0x4a7n, REFEREE = p.publicKey(0x7e7e7en);
/** A ticket for 19×19 at komi 7.5 on `clock`'s settings, refereed by REFEREE. */
const ticketFor = (channel, clock = p.rankedClock(REFEREE)) => ({
  chain_id: p.tag('SN_SEPOLIA'), channel, player_0: 0xb1n, player_1: 0xa1n, pool: c.GO_POOL, config: c.goConfigHash(19, 15),
  referee: clock.referee, clock: c.clockHash(clock.settings), prover: 0x555n, response_seconds: 3600, source: c.QUEUE,
  band_0: 2, band_1: 1, matchmaker: 0x3a7c4n, issued_at: 1_700_000_000n, expires_at: 1_700_000_300n, nonce: 0x1234n,
});
/** What `ticketFor` names by hash. */
const gameFor = (clock = p.rankedClock(REFEREE)) => ({ ratings: RATINGS, size: 19, komi_half: 15, settings: clock.settings });
/** SurroundRatings' TicketUsed event as RPC returns it: keyed by digest, channel and pool. */
const ticketUsed = (ticket, gameId, block) => ({ block_number: block,
  keys: [TICKET_USED, c.ticketDigest(ticket, RATINGS), ticket.channel, ticket.pool].map(p.hex),
  data: [gameId, ...c.encodeTicket(ticket)].map(p.hex) });

test('tickets decode from their Serde encoding, byo-yomi clocks too', () => {
  for (const clock of [p.rankedClock(7n), p.byoyomiClock(7n, { main_ms: 600_000, periods: 5, period_ms: 30_000 })]) {
    const ticket = ticketFor(0x111n, clock);
    const decoded = decodeTicket(c.encodeTicket(ticket));
    assert.deepEqual(decoded, ticket);
    assert.equal(c.ticketDigest(decoded, RATINGS), c.ticketDigest(ticket, RATINGS));
    // The clock's settings travel beside the ticket, which names them by hash.
    assert.deepEqual(c.ratedTerms(decoded, [0x777n, 0x888n], gameFor(clock)).clock.settings, clock.settings);
  }
});

test('TicketUsed and GameVoided events decode; others are skipped', () => {
  const ticket = ticketFor(0x111n);
  assert.deepEqual(ratingEvent(ticketUsed(ticket, 9n, 5)),
    { type: 'TicketUsed', digest: c.ticketDigest(ticket, RATINGS), channel: 0x111n, pool: c.GO_POOL, game_id: 9n, ticket, block: 5 });
  assert.deepEqual(ratingEvent({ keys: [p.hex(GAME_VOIDED), '0xd'], data: ['0x111', '0x9', '0x4'], block_number: 6 }),
    { type: 'GameVoided', digest: 0xdn, channel: 0x111n, game_id: 9n, reason: 4, block: 6 });
  assert.equal(ratingEvent({ keys: ['0x1234'], data: [] }), null);
});

test('RatedGame reads by field name', () => {
  assert.deepEqual(ratedGame([9n, 0xdn]), { game_id: 9n, ticket: 0xdn });
  assert.equal(ratedGame([9n, 0n]).ticket, 0n);
});

/** A provider for the hooks: a channel's rated games and SurroundRatings' events. */
function fakeProvider(channel, rated, events) {
  const calls = [];
  return {
    calls,
    async callContract({ contractAddress, entrypoint, calldata }) {
      calls.push(entrypoint);
      assert.equal(BigInt(contractAddress), channel);
      if (entrypoint === 'ratings') return [p.hex(RATINGS)];
      assert.equal(entrypoint, 'rated_game');
      return [calldata[0], p.hex(rated.get(BigInt(calldata[0])) ?? 0n)];
    },
    async getBlockNumber() { return 10; },
    async getEvents({ address, keys, from_block, to_block }) {
      assert.equal(BigInt(address), RATINGS);
      const to = to_block === 'latest' ? Infinity : to_block.block_number;
      return { events: events.filter(e => e.block_number >= from_block.block_number && e.block_number <= to
        && keys.every((allowed, i) => allowed.length === 0 || allowed.map(BigInt).includes(BigInt(e.keys[i])))) };
    },
  };
}

test('keeper hooks: rated games first, opened on their tickets, and rate sent with the settling resolve', async () => {
  const channel = 0x222n, ticket = ticketFor(channel), digest = c.ticketDigest(ticket, RATINGS);
  const provider = fakeProvider(channel, new Map([[9n, digest]]), [ticketUsed(ticketFor(0x999n), 3n, 1), ticketUsed(ticket, 9n, 2)]);
  // Rated terms carry the ticket's digest; unrated ones 0.
  const rated = c.ratedTerms(ticket, [0x777n, 0x888n], gameFor());
  const unrated = p.goTerms({ ...rated, ...rated.config, ticket: 0n });
  assert.equal(await hooks.admit({ channel, game_id: rated.game_id }, rated, { provider }), 1);
  assert.equal(await hooks.admit({ channel, game_id: 8n }, unrated, { provider }), 0);
  // A game nobody opened opens on its wallets' signatures, a rated one with
  // the ticket and the matchmaker's signature it registered with.
  const signatures = [[1n, 2n], [3n, 4n]], signature = c.signTicket(ticket, RATINGS, 0x3a7c4n);
  const extras = { ticket: c.ticketJson(ticket), signature: { r: p.hex(signature.r), s: p.hex(signature.s) } };
  assert.deepEqual(await hooks.openCall({ channel, game_id: rated.game_id }, rated, { signatures, extras, provider }),
    c.openRatedGameCall(rated, signatures, ticket, signature));
  assert.deepEqual(await hooks.openCall({ channel, game_id: 8n }, unrated, { signatures, provider }), c.openGameCall(unrated, signatures));
  // A seat signed in agreed with a delegated key: only the delegable entrypoint takes it, and only for a rated game.
  const approvals = [{ key: 5n, expires_at: 2000n, delegation: [6n, 7n], signature: { r: 8n, s: 9n } }, [3n, 4n]];
  assert.deepEqual(await hooks.openCall({ channel, game_id: rated.game_id }, rated,
    { signatures: null, approvals, extras, provider }), c.openRatedGameDelegableCall(rated, approvals, ticket, signature));
  await assert.rejects(hooks.openCall({ channel, game_id: 8n }, unrated, { signatures: null, approvals, provider }),
    /wallets' signatures only/);
  await assert.rejects(hooks.openCall({ channel, game_id: rated.game_id }, rated, { signatures, provider }), /registered without its ticket/);
  const other = c.ticketJson({ ...ticket, nonce: 0x99n });
  await assert.rejects(hooks.openCall({ channel, game_id: rated.game_id }, rated, { signatures, extras: { ...extras, ticket: other }, provider }),
    /is not its terms'/);
  // The ticket's digest in the terms, but another board or clock than it names, or for another ratings contract.
  for (const changed of [{ size: 13 }, { komi_half: 13 }, { clock: p.rankedClock(p.publicKey(0x7e7e7fn)) },
    { clock: p.byoyomiClock(REFEREE, { main_ms: 60_000, periods: 3, period_ms: 10_000 }) }]) {
    const terms = p.goTerms({ ...rated, ...rated.config, ...changed });
    await assert.rejects(hooks.openCall({ channel, game_id: terms.game_id }, terms, { signatures, extras, provider }),
      /not its ticket's game/);
  }
  const elsewhere = { ...rated, config: { ...rated.config, ticket: c.ticketDigest(ticket, RATINGS + 1n) } };
  await assert.rejects(hooks.openCall({ channel, game_id: rated.game_id }, elsewhere, { signatures, extras, provider }),
    /is not its terms'/);
  assert.deepEqual(await hooks.afterSettle({ channel, game_id: 8n }, {}, { provider }), []);
  const calls = await hooks.afterSettle({ channel, game_id: 9n }, {}, { provider });
  assert.deepEqual(calls, [c.rateCall(channel, 9n, ticket)]);
  // A resolve that failed is tried again: the ticket is found again.
  assert.deepEqual(await hooks.afterSettle({ channel, game_id: 9n }, {}, { provider }), calls);
});

// What arbiter's keeper requires of a game entry's module (`loadConfig`, whose
// own tests load hooks): the named export a codec, and the hooks functions.
test('keeper hooks: the module is a keeper game entry', () => {
  assert.equal(hooks.go, p.go);
  assert.ok(hooks.go.tag);
  assert.equal(typeof hooks.go.maxSteps, 'function');
  for (const hook of ['admit', 'openCall', 'afterSettle']) assert.equal(typeof hooks[hook], 'function');
});
