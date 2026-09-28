// Surround's matchmaker service: pairs players for rated games, signs their
// tickets and rates settled games. See README.md.
//
//   MATCHMAKER_KEY=0x… MATCHMAKER_ACCOUNT_KEY=0x… node offchain/matchmaker/server.mjs CONFIG_JSON
//
// HTTP API (JSON; felts as hex strings). Requests that change state carry
// `at` (Unix seconds) and `signature`, the player's wallet signature over
// `matchmakerRequest(...)` (SDK client), which is checked through the account.
//   GET  /info                     chain, channel, keys, boards, clocks, bands
//   POST /queue                    { player, size, clock, band, at, signature }
//   POST /queue/leave              { player, at, signature }
//   GET  /queue/:player            { status: none | waiting | paired, ticket?, signature?, color? }
//   GET  /tables                   open tables
//   POST /tables                   { player, size, clock, band, at, signature } -> { table }
//   POST /tables/:id/join          { player, band, at, signature } -> the joiner's ticket
//   POST /tables/:id/close         { player, at, signature }
//   GET  /health
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as p from '../sdk/src/index.mjs';
import { starknetChain } from './chain.mjs';
import { Matchmaker } from './matchmaker.mjs';

const MAX_BODY = 64 * 1024;

/** Resolve a config (see config.example.json), reading keys from the environment. */
export function loadConfig(raw, env = process.env) {
  const key = name => {
    if (!env[name]) throw Error(`Set ${name}`);
    return BigInt(env[name]);
  };
  const referee = BigInt(raw.referee);
  const clocks = {};
  for (const [name, settings] of Object.entries(raw.clocks)) clocks[name] = { referee, settings };
  return {
    ...raw,
    chain_id: /^0x/i.test(raw.chain_id) ? BigInt(raw.chain_id) : p.tag(raw.chain_id),
    channel: BigInt(raw.channel), prover: BigInt(raw.prover), ratings: BigInt(raw.ratings), world: BigInt(raw.world),
    matchmakerKey: key(raw.matchmaker_key_env ?? 'MATCHMAKER_KEY'),
    account: raw.account && { address: raw.account.address, privateKey: p.hex(key(raw.account.private_key_env ?? 'MATCHMAKER_ACCOUNT_KEY')) },
    clocks,
  };
}

/** Serve `matchmaker` over HTTP; `poll_ms` runs its chain work in the background (0: never). */
export function serve(matchmaker, { host = '127.0.0.1', port = 0, poll_ms = 5000, cors_origin = '*', log = () => {} } = {}) {
  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': cors_origin,
      'Access-Control-Allow-Headers': 'Content-Type' });
    res.end(JSON.stringify(body));
  };
  const read = async req => {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY) throw Object.assign(Error('Request too large'), { status: 413 });
    }
    try { return JSON.parse(body || '{}'); } catch { throw Object.assign(Error('Invalid JSON'), { status: 400 }); }
  };
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, {});
      const [area, id, action, extra] = new URL(req.url, 'http://matchmaker').pathname.split('/').filter(Boolean);
      const get = req.method === 'GET', post = req.method === 'POST';
      if (extra === undefined) {
        if (get && area === 'health' && !id) return send(res, 200, { ok: true });
        if (get && area === 'info' && !id) return send(res, 200, matchmaker.info());
        if (area === 'queue' && !action) {
          if (post && !id) return send(res, 200, await matchmaker.enqueue(await read(req)));
          if (post && id === 'leave') return send(res, 200, await matchmaker.leave(await read(req)));
          if (get && id) return send(res, 200, matchmaker.status(id));
        }
        if (area === 'tables') {
          if (get && !id) return send(res, 200, matchmaker.tables());
          if (post && !id) return send(res, 200, await matchmaker.host(await read(req)));
          if (post && action === 'join') return send(res, 200, await matchmaker.join(id, await read(req)));
          if (post && action === 'close') return send(res, 200, await matchmaker.close(id, await read(req)));
        }
      }
      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      send(res, e.status ?? 500, { error: e.status ? e.message : 'Internal error' });
      if (!e.status) log(`error: ${e.stack ?? e}`);
    }
  });
  let timer = null, running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try { await matchmaker.tick(); } catch (e) { log(`tick failed: ${e.message}`); } finally { running = false; }
  };
  if (poll_ms > 0) timer = setInterval(poll, poll_ms);
  return new Promise(resolve => server.listen(port, host, () => resolve({
    url: `http://${host}:${server.address().port}`,
    close: () => { clearInterval(timer); return new Promise(r => server.close(r)); },
  })));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = loadConfig(JSON.parse(await readFile(process.argv[2], 'utf8')));
  const chain = starknetChain({ rpc_url: config.rpc_url, world: config.world, channel: config.channel, ratings: config.ratings,
    account: config.account, max_fee_fri: config.max_fee_fri == null ? null : BigInt(config.max_fee_fri) });
  const log = message => console.log(`${new Date().toISOString()} ${message}`);
  const matchmaker = new Matchmaker(config, chain, { log });
  const { url } = await serve(matchmaker, { host: config.host, port: config.port, poll_ms: (config.poll_seconds ?? 5) * 1000,
    cors_origin: config.cors_origin, log });
  log(`matchmaker ${p.hex(p.publicKey(config.matchmakerKey))} for channel ${p.hex(config.channel)} at ${url}`);
}
