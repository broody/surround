// Surround's matchmaker service: pairs players for rated games, signs their
// tickets, registers each game both wallets signed with a keeper, and rates
// settled games. See README.md.
//
//   MATCHMAKER_KEY=0x… MATCHMAKER_ACCOUNT_KEY=0x… node offchain/matchmaker/server.mjs CONFIG_JSON
//
// HTTP API (JSON; felts as hex strings). Lobby requests carry `at` (Unix
// seconds), a fresh random `nonce` and `signature`, the player's wallet
// signature over `matchmakerRequest(...)` (SDK client), which is checked
// through the account; `key` is the session public key the player will play
// the game with.
//   GET  /info                     chain, channel, keys, boards, clocks, keepers, starting bands
//   POST /queue                    { player, key, size, clock, band?, at, nonce, signature }
//   POST /queue/leave              { player, at, nonce, signature }
//   GET  /queue/:player            { status: none | waiting | paired, and once paired: ticket, signature, color,
//                                    digest, game_id, terms, keeper, sign_by, signed: { black, white }, ready }
//   POST /games/:digest/sign       { player, signature }: the wallet's signature over the game's terms -> the status;
//                                  on an AI game's offer, it makes the offer the player's pairing
//   GET  /tables                   open tables
//   POST /tables                   { player, key, size, clock, band?, at, nonce, signature } -> { table }
//   POST /tables/:id/join          { player, key, band?, at, nonce, signature } -> the joiner's status
//   POST /tables/:id/close         { player, at, nonce, signature }
//   POST /ai                       { player, key, size, clock, band?, anchor }, unsigned: play an AI anchor now ->
//                                  an offer (status `offer`, as paired otherwise), the player's to sign by `sign_by`
//   GET  /anchors                  each AI anchor: { player, rank_tenths, keys }
//   GET  /anchors/:anchor          its pairings in play (each a status, with its session `key`) and keys left
//   POST /anchors/:anchor/keys     { player: the anchor, key, at, nonce, signature }: a session key for a next game
//   GET  /players/:player          { player, deployed, rated, anchor, rank_tenths, rank, provisional, established,
//                                    games, wins, losses, draws, band }: a player's account and rating
//   GET  /health                   { ok, pairing, stuck }
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as p from '../sdk/src/index.mjs';
import { starknetChain } from './chain.mjs';
import { Matchmaker } from './matchmaker.mjs';
import { fileStore } from './store.mjs';

const MAX_BODY = 64 * 1024;

/**
 * Resolve a config (see config.example.json), reading keys from the
 * environment. `store` resolves from `base`, the config file's directory.
 * `keepers` (or the older `keeper_url` and `referee`) is read by the
 * matchmaker (`keepersOf`); `clocks` are time control settings.
 */
export function loadConfig(raw, env = process.env, base = process.cwd()) {
  const key = name => {
    if (!env[name]) throw Error(`Set ${name}`);
    return BigInt(env[name]);
  };
  return {
    ...raw,
    chain_id: /^0x/i.test(raw.chain_id) ? BigInt(raw.chain_id) : p.tag(raw.chain_id),
    channel: BigInt(raw.channel), prover: BigInt(raw.prover), ratings: BigInt(raw.ratings),
    matchmakerKey: key(raw.matchmaker_key_env ?? 'MATCHMAKER_KEY'),
    account: raw.account && { address: raw.account.address, privateKey: p.hex(key(raw.account.private_key_env ?? 'MATCHMAKER_ACCOUNT_KEY')) },
    max_fee_fri: raw.max_fee_fri == null ? null : BigInt(raw.max_fee_fri),
    store: resolve(base, raw.store ?? 'matchmaker-state.json'),
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
        if (get && area === 'health' && !id) return send(res, 200, matchmaker.health());
        if (get && area === 'info' && !id) return send(res, 200, await matchmaker.info());
        if (get && area === 'players' && id && !action) return send(res, 200, await matchmaker.player(id));
        if (area === 'queue' && !action) {
          if (post && !id) return send(res, 200, await matchmaker.enqueue(await read(req)));
          if (post && id === 'leave') return send(res, 200, await matchmaker.leave(await read(req)));
          if (get && id) return send(res, 200, matchmaker.status(id));
        }
        if (area === 'games' && id && post && action === 'sign') return send(res, 200, await matchmaker.sign(id, await read(req)));
        if (area === 'ai' && post && !id) return send(res, 200, await matchmaker.play(await read(req)));
        if (area === 'anchors') {
          if (get && !id) return send(res, 200, await matchmaker.anchorList());
          if (get && id && !action) return send(res, 200, matchmaker.anchorGames(id));
          if (post && id && action === 'keys') return send(res, 200, await matchmaker.offerKey(id, await read(req)));
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
  const file = resolve(process.argv[2]);
  const config = loadConfig(JSON.parse(await readFile(file, 'utf8')), process.env, dirname(file));
  const chain = starknetChain({ rpc_url: config.rpc_url, channel: config.channel, ratings: config.ratings, account: config.account });
  const log = message => console.log(`${new Date().toISOString()} ${message}`);
  const matchmaker = await Matchmaker.open(config, chain, { log, store: fileStore(config.store) });
  const { url } = await serve(matchmaker, { host: config.host, port: config.port, poll_ms: (config.poll_seconds ?? 5) * 1000,
    cors_origin: config.cors_origin, log });
  log(`matchmaker ${p.hex(p.publicKey(config.matchmakerKey))} for channel ${p.hex(config.channel)} at ${url}`);
}
