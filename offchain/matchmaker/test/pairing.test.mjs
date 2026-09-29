import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby, QUEUE, TABLE } from '../pairing.mjs';

const entry = (player, rank, extra = {}) => ({ player, size: 19, clock: 'turn', band: 3, rank, ...extra });
const id = name => `0x${Buffer.from(name).toString('hex')}`;

test('pairs the closest ranks, the weaker taking black', () => {
  const lobby = new Lobby();
  lobby.enqueue(entry('a', 200), 0);
  lobby.enqueue(entry('b', 230), 1);
  lobby.enqueue(entry('c', 210), 2);
  const [p] = lobby.pair(3);
  assert.deepEqual([p.black, p.white, p.source], ['a', 'c', QUEUE]);
  assert.deepEqual([...lobby.queue.keys()], ['b']);
});

test('only pairs the same board and clock', () => {
  const lobby = new Lobby();
  lobby.enqueue(entry('a', 200), 0);
  lobby.enqueue(entry('b', 200, { size: 9 }), 0);
  lobby.enqueue(entry('c', 200, { clock: 'byoyomi' }), 0);
  assert.deepEqual(lobby.pair(1), []);
});

test('the allowed gap widens with waiting, up to the maximum', () => {
  const lobby = new Lobby();
  lobby.enqueue(entry('a', 100), 0);
  lobby.enqueue(entry('b', 160), 0);
  assert.equal(lobby.pair(1_000).length, 0);          // 6 ranks apart, 3 allowed
  assert.equal(lobby.pair(90_000).length, 1);         // after 90 s, 6 allowed
  const far = new Lobby();
  far.enqueue(entry('a', 0), 0);
  far.enqueue(entry('b', 100), 0);
  assert.equal(far.pair(3_600_000).length, 0);        // never beyond 9 ranks
});

test('limits repeat pairings and open games', () => {
  const lobby = new Lobby({ max_open: 1 });
  for (let i = 0; i < 2; i++) {
    lobby.enqueue(entry('a', 200), i * 10);
    lobby.enqueue(entry('b', 200), i * 10);
    const [p] = lobby.pair(i * 10 + 1);
    assert.throws(() => lobby.enqueue(entry('a', 200), i * 10 + 2), /Finish your rated game/);
    lobby.finished(p);
  }
  lobby.enqueue(entry('a', 200), 100);
  lobby.enqueue(entry('b', 200), 100);
  assert.equal(lobby.pair(101).length, 0);             // twice today already
  assert.equal(lobby.pair(24 * 3600_000 + 101).length, 1);
});

test('a missed game cools a player down', () => {
  const lobby = new Lobby({ cooldown_ms: 1000 });
  lobby.missed('a', 0);
  assert.throws(() => lobby.enqueue(entry('a', 200), 500), /Cooling down/);
  lobby.enqueue(entry('a', 200), 1000);
});

test('tables: the host plays black, within the rules', () => {
  const lobby = new Lobby();
  const id = lobby.host(entry('h', 250), 0);
  assert.throws(() => lobby.enqueue(entry('h', 250), 1), /Close your table/);
  assert.throws(() => lobby.join(id, entry('far', 100), 1), /too far apart/);
  assert.throws(() => lobby.join(id, entry('h', 250), 1), /your table/);
  const p = lobby.join(id, entry('j', 200), 2);
  assert.deepEqual([p.black, p.white, p.source, p.size, p.clock], ['h', 'j', TABLE, 19, 'turn']);
  assert.equal(lobby.tables.size, 0);
  assert.throws(() => lobby.join(id, entry('k', 200), 3), /No such table/);
});

test('only the host closes a table', () => {
  const lobby = new Lobby();
  const id = lobby.host(entry('h', 250), 0);
  assert.throws(() => lobby.close(id, 'x'), /Not your table/);
  lobby.close(id, 'h');
  assert.equal(lobby.tables.size, 0);
});

test('banned players get no rated games', () => {
  const lobby = new Lobby({ banned: [id('cheat')] });
  assert.throws(() => lobby.enqueue(entry(id('cheat'), 200), 0), /Not allowed/);
  assert.throws(() => lobby.host(entry(id('cheat'), 200), 0), /Not allowed/);
  const table = lobby.host(entry(id('h'), 200), 0);
  assert.throws(() => lobby.join(table, entry(id('cheat'), 200), 1), /Not allowed/);
});

test('a pairing finishes once, however many times it is reported', () => {
  const lobby = new Lobby({ max_open: 2, max_repeats: 5 });
  lobby.enqueue(entry('a', 200), 0);
  lobby.enqueue(entry('b', 200), 0);
  const [first] = lobby.pair(1);
  lobby.enqueue(entry('a', 200), 2);
  lobby.enqueue(entry('c', 200), 2);
  lobby.pair(3);
  assert.equal(lobby.open.get('a'), 2);
  first.digest = '0x1';
  assert.equal(lobby.finished(first), true);
  assert.equal(lobby.finished(first), false);
  assert.equal(lobby.open.get('a'), 1);
  // A game the lobby lost counts again until it ends, unless it already ended.
  lobby.adopt({ black: 'a', white: 'd', digest: '0x2' });
  lobby.adopt({ black: 'a', white: 'b', digest: '0x1' });
  assert.deepEqual([lobby.open.get('a'), lobby.open.get('d'), lobby.open.get('b')], [2, 1, undefined]);
});

test('repeated aborts within the window cool a player down', () => {
  const lobby = new Lobby({ abort_limit: 3, abort_window_ms: 1000, abort_cooldown_ms: 5000 });
  assert.equal(lobby.aborted('a', 0), false);
  assert.equal(lobby.aborted('a', 500), false);
  assert.equal(lobby.aborted('a', 1600), false);   // both fell out of the window
  assert.equal(lobby.aborted('a', 1700), false);
  assert.equal(lobby.aborted('a', 1800), true);
  assert.throws(() => lobby.enqueue(entry('a', 200), 6000), /Cooling down after a missed or aborted game/);
  lobby.enqueue(entry('a', 200), 6800);
});

test('pairs at most `limit` games, and drops queued players who became busy', () => {
  const lobby = new Lobby({ cooldown_ms: 1000 });
  for (const name of ['a', 'b', 'c', 'd', 'e']) lobby.enqueue(entry(name, 200), 0);
  lobby.missed('e', 1);
  assert.equal(lobby.pair(2, 1).length, 1);
  assert.equal(lobby.queue.has('e'), false);
  assert.equal(lobby.pair(3, 0).length, 0);
  assert.equal(lobby.pair(4).length, 1);
});

test('table ids are random', () => {
  const ids = new Set(['h', 'i', 'j'].map(name => new Lobby().host(entry(name, 200), 0)));
  assert.equal(ids.size, 3);
  for (const id of ids) assert.match(id, /^[0-9a-f]{16}$/);
});

test('open games, finished pairings, cooldowns, aborts and history survive a snapshot', () => {
  const lobby = new Lobby();
  lobby.enqueue(entry('a', 200), 0);
  lobby.enqueue(entry('b', 200), 0);
  const [p] = lobby.pair(1);
  lobby.finished({ ...p, digest: '0x9' });
  lobby.adopt({ black: 'a', white: 'c', digest: '0x8' });
  lobby.missed('d', 1);
  lobby.aborted('e', 1);
  const copy = new Lobby();
  copy.restore(JSON.parse(JSON.stringify(lobby.snapshot())));
  assert.deepEqual(copy.snapshot(), lobby.snapshot());
  assert.equal(copy.finished({ ...p, digest: '0x9' }), false);
  assert.throws(() => copy.enqueue(entry('a', 200), 2), /Finish your rated game/);
  assert.throws(() => copy.enqueue(entry('d', 200), 2), /Cooling down/);
});
