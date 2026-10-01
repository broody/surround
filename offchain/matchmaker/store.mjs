// Where the matchmaker keeps what the chain can't give back after a restart:
// its pairings in play (tickets, terms, signatures, keepers), the games it
// still has to rate, cooldowns, and the request replay guard. A store is
// `{ load() -> state | null, save(state) }`.
import { readFile, rename, writeFile } from 'node:fs/promises';

/** One JSON file, replaced whole on each save; null until the first save. */
export function fileStore(path) {
  return {
    async load() {
      try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    async save(state) {
      await writeFile(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    },
  };
}

/** A store in memory, starting from `state` (null: nothing stored). */
export function memoryStore(state = null) {
  let saved = state === null ? null : JSON.stringify(state);
  return {
    async load() { return saved === null ? null : JSON.parse(saved); },
    async save(next) { saved = JSON.stringify(next); },
  };
}
