// Replay SurroundRatings' own events with the SDK's replay.mjs: runs the
// `events_for_replay` Cairo test, which plays a mixed season through the
// contract and prints every raw event, then decodes and verifies them.
//
//   node offchain/ratings/audit/replay-check.mjs
import { execFileSync } from 'node:child_process';
import { decodeEvent, verifyRatings } from '../../sdk/src/replay.mjs';

const out = execFileSync('scarb', ['test', '-f', 'events_for_replay'], {
  cwd: new URL('../../../ratings/', import.meta.url), encoding: 'utf8',
  env: { ...process.env, SCARB_IGNORE_CAIRO_VERSION: 'true' }, maxBuffer: 64 << 20,
});
const events = out.split('\n').filter(l => l.startsWith('EVENT ')).map(line => {
  const [keys, data] = line.slice(6).split(' |');
  return decodeEvent({ keys: keys.trim().split(' '), data: data.trim() ? data.trim().split(' ') : [] });
}).filter(Boolean);
const { ok, errors, games, players } = verifyRatings(events);
const voided = events.filter(e => e.type === 'GameVoided').length;
console.log(`${events.length} events: ${games} games rated, ${voided} voided, ${players.size} players`);
if (!ok) { console.error(errors); process.exit(1); }
console.log('every rating replays from its events');
