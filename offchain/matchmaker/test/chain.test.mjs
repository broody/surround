// Reading SurroundRatings' events and the channel's `RatedGame`, and the
// keeper hooks built on them.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';
import { GAME_VOIDED, TICKET_USED, decodeTicket, ratedGame, ratingEvent } from '../chain.mjs';
import * as hooks from '../keeper-hooks.mjs';

const RATINGS = 0x4a7n;
const ticketFor = (channel, clock = p.rankedClock(p.publicKey(0x7e7e7en))) => ({
  chain_id: p.tag('SN_SEPOLIA'), channel, black: 0xb1n, white: 0xa1n, size: 19, komi_half: 15, clock, prover: 0x555n,
  response_seconds: 3600, source: c.QUEUE, black_band: 2, white_band: 1, matchmaker: 0x3a7c4n,
  issued_at: 1_700_000_000n, expires_at: 1_700_000_300n, nonce: 0x1234n,
});
/** SurroundRatings' TicketUsed event as RPC returns it. */
const ticketUsed = (ticket, gameId, block) => ({ block_number: block,
  keys: [TICKET_USED, c.ticketDigest(ticket), ticket.channel].map(p.hex), data: [gameId, ...c.encodeTicket(ticket)].map(p.hex) });

test('tickets decode from their Serde encoding, byo-yomi clocks too', () => {
  for (const clock of [p.rankedClock(7n), p.byoyomiClock(7n, { main_ms: 600_000, periods: 5, period_ms: 30_000 })]) {
    const ticket = ticketFor(0x111n, clock);
    const decoded = decodeTicket(c.encodeTicket(ticket));
    assert.deepEqual(decoded, ticket);
    assert.equal(c.ticketDigest(decoded), c.ticketDigest(ticket));
  }
});

test('TicketUsed and GameVoided events decode; others are skipped', () => {
  const ticket = ticketFor(0x111n);
  assert.deepEqual(ratingEvent(ticketUsed(ticket, 9n, 5)),
    { type: 'TicketUsed', digest: c.ticketDigest(ticket), channel: 0x111n, game_id: 9n, ticket, block: 5 });
  assert.deepEqual(ratingEvent({ keys: [p.hex(GAME_VOIDED), '0xd'], data: ['0x111', '0x9', '0x4'], block_number: 6 }),
    { type: 'GameVoided', digest: 0xdn, channel: 0x111n, game_id: 9n, reason: 4, block: 6 });
  assert.equal(ratingEvent({ keys: ['0x1234'], data: [] }), null);
});

test('RatedGame reads by field name, times unpacked', () => {
  assert.deepEqual(ratedGame([9n, 0xdn, 1_700_000_300n + (1_700_000_050n << 64n)]),
    { game_id: 9n, ticket: 0xdn, times: 1_700_000_300n + (1_700_000_050n << 64n), expires_at: 1_700_000_300, played_at: 1_700_000_050 });
  assert.deepEqual([ratedGame([9n, 0n, 0n]).ticket, ratedGame([9n, 0n, 0n]).played_at], [0n, 0]);
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
      const game = rated.get(BigInt(calldata[0]));
      return [calldata[0], p.hex(game?.digest ?? 0n), p.hex(game?.times ?? 0n)];
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

test('keeper hooks: rated games first, and rate sent with the settling resolve', async () => {
  const channel = 0x222n, ticket = ticketFor(channel), digest = c.ticketDigest(ticket);
  const provider = fakeProvider(channel, new Map([[9n, { digest, times: 1n }]]), [ticketUsed(ticketFor(0x999n), 3n, 1), ticketUsed(ticket, 9n, 2)]);
  assert.equal(await hooks.admit({ channel, game_id: 9n }, null, { provider }), 1);
  assert.equal(await hooks.admit({ channel, game_id: 8n }, null, { provider }), 0);
  assert.deepEqual(await hooks.afterSettle({ channel, game_id: 8n }, {}, { provider }), []);
  const calls = await hooks.afterSettle({ channel, game_id: 9n }, {}, { provider });
  assert.deepEqual(calls, [c.rateCall(channel, 9n, ticket)]);
  // A resolve that failed is tried again: the ticket is found again.
  assert.deepEqual(await hooks.afterSettle({ channel, game_id: 9n }, {}, { provider }), calls);
});

// What referee's keeper requires of a game entry's module (`loadConfig`, whose
// own tests load hooks): the named export a v4 codec, and the hooks functions.
test('keeper hooks: the module is a keeper game entry', () => {
  assert.equal(hooks.go, p.go);
  assert.ok(hooks.go.tag);
  assert.equal(typeof hooks.go.maxSteps, 'function');
  assert.equal(typeof hooks.admit, 'function');
  assert.equal(typeof hooks.afterSettle, 'function');
});
