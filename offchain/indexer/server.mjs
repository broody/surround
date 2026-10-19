// The indexer as a process of its own, beside the matchmaker: it reads the
// matchmaker's config (its `rpc_url`, `ratings`, `channel`, `from_block`,
// `boards`, `clocks` and `db`) and writes the same Surround database.
//
//   node offchain/indexer/server.mjs CONFIG_JSON [--rebuild]
//
// `--rebuild` empties the indexer's tables first, to read them all again from
// `from_block`. Optional config: `indexer: { poll_seconds (5), confirmations
// (2), rewind (20) }`.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RpcProvider } from '../sdk/node_modules/starknet/dist/index.mjs';
import { openDatabase } from '../db/db.mjs';
import { Indexer, chainSource } from './indexer.mjs';

/** An indexer for the matchmaker config `raw` (its file in `base`), on `provider`. */
export function indexerFor(raw, base, { provider = new RpcProvider({ nodeUrl: raw.rpc_url }), log = () => {} } = {}) {
  const db = openDatabase(resolve(base, raw.db ?? 'surround.sqlite'));
  const options = raw.indexer ?? {};
  return new Indexer(db, { source: chainSource(provider, raw.ratings), channel: raw.channel, from_block: raw.from_block ?? 0,
    boards: raw.boards, clocks: raw.clocks, confirmations: options.confirmations, rewind: options.rewind, log });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = resolve(process.argv[2] ?? '');
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const log = message => console.log(`${new Date().toISOString()} ${message}`);
  const indexer = indexerFor(raw, dirname(file), { log });
  if (process.argv.includes('--rebuild')) {
    indexer.rebuild();
    log('emptied the indexer\'s tables: reading again from the deploy block');
  }
  const pollMs = (raw.indexer?.poll_seconds ?? 5) * 1000;
  for (;;) {
    try { await indexer.tick(); } catch (e) { log(`round failed: ${e.message}`); }
    await new Promise(r => setTimeout(r, pollMs));
  }
}
