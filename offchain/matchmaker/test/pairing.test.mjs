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
