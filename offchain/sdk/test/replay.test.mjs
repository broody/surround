// replay.mjs: every rating checks against its pre-game states and the chain of
// them, under the contract's rule for short games. The events here come from
// a small model of `SurroundRatings::rate_game` (arbiter's `RatingsComponent`
// with Go's rules); `events_for_replay` (ratings/src/tests/test_surround.cairo,
// run by offchain/ratings/audit/replay-check.mjs) and the Devnet run
// (`offchain/local.py`) check the replay against the contract itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tag } from '../src/index.mjs';
import * as r from '../src/rating.mjs';
import { MIN_RATED_STEPS, verifyRatings } from '../src/replay.mjs';

const T0 = 1_700_000_000n;
const zero = { mu: 0n, phi: 0n, last: 0n };
const GO = tag('go'), CHANNEL = 0xc4a77e1n;

/** A model of the contract: events for each game, as it emits them. */
function contract() {
  const state = new Map(), events = [], pins = new Map();
  const get = p => state.get(p) ?? { rating: zero, games: 0 };
  let n = 0;
  return {
    events,
    pin(player, mu) {
      pins.set(player, mu);
      events.push({ type: 'PolicySet', kind: ANCHOR, pool: GO, value: player, extra: mu + (1n << 39n), allowed: true });
    },
    rate(black, white, score, { t, steps = 60, bands = [2, 2], source = 1 } = {}) {
      const digest = BigInt(++n), game_id = 0x9000n + digest;
      const ticket = { player_0: black, player_1: white, pool: GO, source, band_0: bands[0], band_1: bands[1] };
      events.push({ type: 'TicketUsed', digest, channel: CHANNEL, pool: GO, game_id, ticket });
      const sides = [black, white].map((p, i) => {
        if (pins.has(p)) return { p, anchor: true, s: { rating: r.anchorRating(pins.get(p), t) }, start: r.anchorRating(pins.get(p), t) };
        const s = get(p), isNew = s.rating.phi === 0n;
        return { p, s, isNew, start: isNew ? r.start(bands[i]) : s.rating };
      });
      const short = steps < MIN_RATED_STEPS;
      const apply = [!sides[0].anchor && (!short || score === 0), !sides[1].anchor && (!short || score === 2)];
      const out = r.update(sides[0].start, sides[1].start, score, t);
      [out.black, out.white].forEach((after, i) => {
        const x = sides[i];
        const end = x.anchor ? x.s.rating : apply[i] ? after : x.isNew ? x.s.rating : r.age(x.s.rating, t);
        if (!x.anchor) state.set(x.p, { rating: end, games: x.s.games + (apply[i] ? 1 : 0) });
        events.push({ type: 'RatingUpdated', player: x.p, digest, pool: GO, channel: CHANNEL, game_id, opponent: sides[1 - i].p,
          score: i ? 2 - score : score, source, steps, played_at: t, params: r.PARAMS, band: x.isNew && apply[i] ? bands[i] : 0,
          applied: apply[i], pre_mu: x.s.rating.mu, pre_phi: x.s.rating.phi, pre_last: x.s.rating.last, mu: end.mu, phi: end.phi,
          last_played: end.last, shown: end.phi === 0n ? 0 : r.shownTenths(end.mu), anchor: Boolean(x.anchor) });
      });
    },
  };
}

const ANCHOR = tag('anchor');
const MU_5K = r.MU_T[25];

/** An anchor at 5k, met by a newcomer and by players settled on each other. */
function anchored() {
  const c = contract();
  c.pin(7n, MU_5K);
  let t = T0;
  for (let i = 0; i < 24; i++) c.rate(1n + BigInt(i % 2), 2n - BigInt(i % 2), i % 2 ? 2 : 0, { t: (t += 3600n) });
  c.rate(9n, 7n, 0, { t: (t += 3600n), bands: [3, 0] });
  c.rate(7n, 1n, 2, { t: (t += 3600n), bands: [0, 2] });
  c.rate(2n, 7n, 2, { t: (t += 86400n * 400n), bands: [2, 0] });
  return c.events;
}

/** A season: five players, one of whom settles and then meets newcomers. */
function season() {
  const c = contract();
  let t = T0;
  for (let i = 0; i < 24; i++) c.rate(1n + BigInt(i % 3), 1n + BigInt((i + 1) % 3), i % 2 ? 2 : 0, { t: (t += 3600n) });
  c.rate(1n, 9n, 2, { t: (t += 3600n) }); // a settled player beats a newcomer
  c.rate(2n, 3n, 0, { t: (t += 3600n), steps: 3 }); // a short onchain forfeit
  c.rate(4n, 5n, 1, { t: (t += 86400n * 400n), bands: [1, 2] });
  return c.events;
}

test('a genuine season replays', () => {
  const { ok, errors, games, players } = verifyRatings(season());
  assert.deepEqual(errors, []);
  assert.ok(ok);
  assert.equal(games, 27);
  assert.equal(players.size, 6);
});

test('newcomers against established players are the drift signal', () => {
  const { newcomers } = verifyRatings(season());
  // Player 9's first game, lost to player 1, who has 16 games.
  assert.equal(newcomers.games, 1);
  assert.equal(newcomers.won, 0);
  assert.ok(newcomers.expected > 0 && newcomers.expected < 1);
});

test('a changed update is caught', () => {
  const events = season();
  const i = events.findIndex(e => e.type === 'RatingUpdated' && e.player === 9n);
  events[i] = { ...events[i], mu: events[i].mu + 1n };
  const { ok, errors } = verifyRatings(events);
  assert.ok(!ok);
  assert.match(errors[0].what, /post-game state/);
});

test('a broken chain is caught', () => {
  const events = season();
  const i = events.findLastIndex(e => e.type === 'RatingUpdated' && e.player === 1n);
  events[i] = { ...events[i], pre_phi: events[i].pre_phi + 1n };
  assert.ok(verifyRatings(events).errors.some(e => /previous post-game/.test(e.what)));
});

test("a short forfeit's winner reported as gaining is caught", () => {
  const events = season();
  const i = events.findIndex(e => e.type === 'RatingUpdated' && e.digest === 26n && e.score === 2);
  assert.equal(events[i].applied, false);
  events[i] = { ...events[i], applied: true };
  assert.ok(verifyRatings(events).errors.some(e => /applied/.test(e.what)));
});

test('a rating without its ticket or its other side is caught', () => {
  const events = season().filter(e => !(e.type === 'TicketUsed' && e.digest === 3n));
  assert.ok(verifyRatings(events).errors.some(e => /no TicketUsed/.test(e.what)));
  const cut = season();
  cut.pop();
  assert.ok(verifyRatings(cut).errors.some(e => /no opposite side/.test(e.what)));
});

test('anchored games replay, and report how each anchor scores against established players', () => {
  const { ok, errors, games, players, anchors } = verifyRatings(anchored());
  assert.deepEqual(errors, []);
  assert.ok(ok);
  assert.equal(games, 27);
  assert.equal(players.has(7n), false);
  // Two of its three games were against established players: it won one, lost one.
  const signal = anchors.get(7n);
  assert.equal(signal.games, 2);
  assert.equal(signal.won, 1);
  assert.ok(signal.expected > 0 && signal.expected < 2);
});

test('an anchor whose state moves, or that is rated as a player, is caught', () => {
  const moved = anchored();
  const side = moved.find(e => e.type === 'RatingUpdated' && e.player === 7n);
  side.mu += 1n;
  assert.ok(verifyRatings(moved).errors.some(e => /anchor's state changed/.test(e.what)));
  const unflagged = anchored();
  unflagged.find(e => e.type === 'RatingUpdated' && e.player === 7n).anchor = false;
  assert.ok(!verifyRatings(unflagged).ok);
});

test('a rating that names another pool, players or band than its ticket is caught', () => {
  const pool = season();
  const i = pool.findIndex(e => e.type === 'RatingUpdated' && e.player === 9n);
  pool[i] = { ...pool[i], pool: tag('blitz') };
  assert.ok(verifyRatings(pool).errors.some(e => /another pool/.test(e.what)));
  const players = season();
  players.find(e => e.type === 'TicketUsed' && e.digest === 25n).ticket.player_1 = 8n;
  assert.ok(verifyRatings(players).errors.some(e => /other players/.test(e.what)));
  const band = season();
  band.find(e => e.type === 'RatingUpdated' && e.player === 9n).band = 3;
  assert.ok(verifyRatings(band).errors.some(e => /band 3, expected 2/.test(e.what)));
});

test('events of a version with no rules are caught, and replay under rules given by version', () => {
  const events = season();
  assert.deepEqual(verifyRatings(events, { 3: r.GO_RULES }).errors[0].what, 'no rules for params 2');
  assert.ok(verifyRatings(events, new Map([[2, r.GO_RULES]])).ok);
});
