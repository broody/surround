// Surround's matchmaker service: pairs players for rated games, signs their
// tickets, registers each game both wallets signed with a keeper, and rates
// settled games. See README.md.
//
//   MATCHMAKER_KEY=0x… MATCHMAKER_ACCOUNT_KEY=0x… node offchain/matchmaker/server.mjs CONFIG_JSON
//
// HTTP API (JSON; felts as hex strings). Lobby requests carry `at` (Unix
// seconds), a fresh random `nonce` and `signature`, the player's wallet
// signature over `matchmakerRequest(...)` (SDK client), which is checked
// through the account, or a browser key's (`signRequest`) the wallet
// delegated, named as `delegate`; `key` is the session public key the player
// will play the game with.
//   GET  /info                     chain, channel, ratings, keys, boards, clocks, keepers, starting bands, and
//                                  casual: { channel, clocks } (casual games' channel value and clocks, `untimed` too)
//   POST /queue                    { player, key, size, clock, band?, rated?, at, nonce, signature }: `rated: false`
//                                  queues for a casual game, which may be `untimed`
//   POST /queue/leave              { player, at, nonce, signature }
//   GET  /queue/:player            { status: none | waiting | paired, and once paired: ticket, game (what the
//                                    ticket names by hash: { ratings, size, komi_half, settings }), signature,
//                                    color, digest, game_id, terms, keeper, sign_by, signed: { black, white }, ready }
//   POST /games/:digest/sign       { player, signature }: the wallet's signature over the game's terms, or
//                                  { player, approval: { key, signature } }: a signed-in browser key's -> the status;
//                                  on an AI game's offer, it makes the offer the player's pairing
//   POST /games/:digest/mood       { moves, mood, signature }: an AI game's mood, `excited` or `frustrated`, about
//                                  the position after `moves`, signed by the AI's session key for it (client.mjs
//                                  `signMood`) -> { moves, mood }; cosmetic, for its portrait
//   GET  /games/:digest/mood       { moves, mood }: the AI game's newest mood, both null before one
//   GET  /census                   { waiting, tables, playing }: players in a queue, open tables, games in play
//   GET  /tables                   open tables, rated or not (`rated`), private ones left out
//   POST /tables                   { player, key, size, clock, band?, rated?, private?, at, nonce, signature } -> { table }:
//                                  a private table (casual only) is listed nowhere; its id is the invite
//   POST /tables/:id/join          { player, key, band?, at, nonce, signature } -> the joiner's status
//   POST /tables/:id/close         { player, at, nonce, signature }
//   POST /ai                       { player, key, size, clock, band?, rated?, anchor, color?, handicap? }, unsigned: play an AI anchor now
//                                  (casual only: `color`, 'black' or 'white', the player's; `handicap`, true for no komi) ->
//                                  an offer (status `offer`, as paired otherwise), the player's to sign by `sign_by`
//   GET  /anchors                  each AI anchor: { player, id, shown (its pin's rank in tenths), keys }
//   GET  /anchors/:anchor          its pairings in play (each a status, with its session `key`) and keys left
//   POST /anchors/:anchor/keys     { player: the anchor, key, at, nonce, signature }: a session key for a next game
//   POST /delegates                { player, key, expires_at, signature }: sign in, the wallet's signature over
//                                  `delegationTypedData` -> { player, delegates: [{ key, expires_at }] }
//   POST /delegates/revoke         { player, key, at, nonce, signature, delegate? }: revoke browser key `key`, signed
//                                  by the wallet or that key; `key` 0: every one, by the wallet -> { player, delegates }
//   GET  /delegates/:player        { player, delegates }: the browser keys the player is signed in with
//   GET  /players/:player          { player, deployed, rated, anchor, shown (rank in tenths), rank, provisional, established,
//                                    games, wins, losses, draws, band, profile: { handle, band } | null }: a player's
//                                    account, rating and profile
//   POST /profiles                 { player, handle, band, at, signature }: a profile, the wallet's signature over
//                                  `profileTypedData` (sdk/src/profile.mjs) -> the claim (offchain/db/profiles.mjs)
//   GET  /profiles[?players=a,b]   { chain_id, profiles: [{ player, handle, band, at, signature, version }] }: every
//                                  claim, or those players', each with the signature that makes it checkable
//   GET  /handles/check?player=&handle=  { ok: true }, or the error a claim of that handle would get now: before the
//                                  wallet signs
//   GET  /profiles/:id             { profile: { player, handle, band }, account (as GET /players/:player) }: `id` a
//                                  player's address or handle
//   GET  /profiles/:id/games       { games }: its games, rated and casual, newest first (?before=UNIX_SECONDS&limit=N),
//                                  each rated one with `moved`, how its rank moved with it, in tenths
//   GET  /profiles/:id/ranks       { total, ranks }: how its rank moved, oldest first, over its newest `last` rated
//                                  games (all by default) in at most `points` entries (200; 1000 at most), each one
//                                  game or a run of them (History.ranks): a chart of any length, in one small answer
// With profiles, a player without one is refused a game (queue, tables, AI).
//   POST /accounts                 { player, class_hash, salt, calldata }: deploy the player's Outis account from the
//                                  matchmaker's (sponsor.mjs; the Outis window's `wallet_deploymentData`), within
//                                  the day's limits -> { player, deployed: true, transaction_hash? }
//   GET  /health                   { ok, pairing, stuck }
// With a kifu contract configured (`kifu.address`), it also mints each rated game's kifu to its
// winner (kifu.mjs), from its own account, on a loop of its own; with a rank card contract
// (`rank_card.address`), each rated player their soulbound rank card (rank-card.mjs), likewise.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as p from '../sdk/src/index.mjs';
import { starknetChain } from './chain.mjs';
import { openDatabase } from '../db/db.mjs';
import { History } from '../db/history.mjs';
import { Kifus } from '../db/kifus.mjs';
import { Profiles } from '../db/profiles.mjs';
import { RankCards } from '../db/rank-cards.mjs';
import { KifuMinter } from './kifu.mjs';
import { Matchmaker } from './matchmaker.mjs';
import { RankCardMinter } from './rank-card.mjs';
import { Sponsor } from './sponsor.mjs';
import { fileStore } from './store.mjs';

const MAX_BODY = 64 * 1024;

/**
 * Resolve a config (see config.example.json), reading keys from the
 * environment. `store` resolves from `base`, the config file's directory.
 * `keepers` (or the older `keeper_url` and `referee`) is read by the
 * matchmaker (`keepersOf`); `clocks` are time control settings. `db` is the
 * Surround database (offchain/db), also from `base`; `profiles` configures
 * players' profiles: `rename_seconds`, `hold_seconds` and `reserved` names.
 * `kifu`, `{ address, max_fee_fri?, max_attempts?, retry_seconds?, per_round? }`, mints each
 * rated game's kifu (kifu.mjs); without it, none is. `rank_card`, `{ address, max_fee_fri?,
 * max_attempts?, retry_seconds?, per_round? }`, mints each rated player's rank card (rank-card.mjs).
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
    db: resolve(base, raw.db ?? 'surround.sqlite'),
    profiles: raw.profiles ?? {},
    kifu: raw.kifu?.address ? { ...raw.kifu, address: BigInt(raw.kifu.address) } : null,
    rank_card: raw.rank_card?.address ? { ...raw.rank_card, address: BigInt(raw.rank_card.address) } : null,
  };
}

/**
 * Serve `matchmaker` over HTTP, and players' `profiles` and game `history`
 * (offchain/db) if given; `poll_ms` runs its chain work in the background (0:
 * never), and a `minter`'s (kifu.mjs) and a `carder`'s (rank-card.mjs) each on a loop of its own.
 */
export function serve(matchmaker, { profiles = null, history = null, sponsor = null, minter = null, carder = null, from_header = null, host = '127.0.0.1', port = 0, poll_ms = 5000, cors_origin = '*', log = () => {} } = {}) {
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
  // Where a request came from, for the sponsor's limit per address: the connection's, or, behind a
  // proxy, the last address in the header that proxy sets (`from_header`: the one entry it wrote,
  // after whatever the client sent in it).
  const sender = req => {
    const named = from_header && req.headers[from_header.toLowerCase()];
    const last = named && String(Array.isArray(named) ? named.at(-1) : named).split(',').at(-1).trim();
    return last || req.socket.remoteAddress || '';
  };
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, {});
      const url = new URL(req.url, 'http://matchmaker');
      const [area, id, action, extra] = url.pathname.split('/').filter(Boolean);
      const get = req.method === 'GET', post = req.method === 'POST';
      if (extra === undefined) {
        if (get && area === 'health' && !id) return send(res, 200, matchmaker.health());
        if (get && area === 'census' && !id) return send(res, 200, matchmaker.census());
        // `sponsored`: whether an Outis account that can't deploy itself is deployed here (POST /accounts).
        if (get && area === 'info' && !id) return send(res, 200, { ...(await matchmaker.info()), sponsored: Boolean(sponsor?.open) });
        if (post && area === 'accounts' && !id) {
          if (!sponsor) return send(res, 403, { error: 'Accounts are not set up here' });
          return send(res, 200, await sponsor.deploy(await read(req), sender(req)));
        }
        if (get && area === 'players' && id && !action) {
          const player = await matchmaker.player(id);
          const profile = profiles?.get(player.player);
          return send(res, 200, { ...player, profile: profile ? { handle: profile.handle, band: profile.band } : null });
        }
        if (profiles && area === 'profiles' && !id) {
          if (post) return send(res, 200, await profiles.claim(await read(req)));
          if (get) {
            const players = url.searchParams.get('players');
            return send(res, 200, { chain_id: p.hex(profiles.chainId),
              profiles: players === null ? profiles.all() : profiles.many(players.split(',').filter(Boolean)) });
          }
        }
        if (profiles && get && area === 'profiles' && id) {
          const profile = profiles.find(decodeURIComponent(id));
          if (!profile) return send(res, 404, { error: 'No such player' });
          if (!action) return send(res, 200, { profile: { player: profile.player, handle: profile.handle, band: profile.band },
            account: await matchmaker.player(profile.player) });
          if (history && action === 'games') return send(res, 200, { games: history.games(profile.player, {
            before: url.searchParams.get('before') ?? undefined, limit: url.searchParams.get('limit') ?? undefined }) });
          if (history && action === 'ranks') return send(res, 200, history.ranks(profile.player, {
            points: url.searchParams.get('points') ?? undefined, last: url.searchParams.get('last') ?? undefined }));
        }
        if (profiles && get && area === 'handles' && id === 'check' && !action) {
          profiles.check(url.searchParams.get('player'), url.searchParams.get('handle'));
          return send(res, 200, { ok: true });
        }
        if (area === 'queue' && !action) {
          if (post && !id) return send(res, 200, await matchmaker.enqueue(await read(req)));
          if (post && id === 'leave') return send(res, 200, await matchmaker.leave(await read(req)));
          if (get && id) return send(res, 200, matchmaker.status(id));
        }
        if (area === 'games' && id && post && action === 'sign') return send(res, 200, await matchmaker.sign(id, await read(req)));
        if (area === 'games' && id && action === 'mood') {
          if (post) return send(res, 200, matchmaker.setMood(id, await read(req)));
          if (get) return send(res, 200, matchmaker.mood(id));
        }
        if (area === 'ai' && post && !id) return send(res, 200, await matchmaker.play(await read(req)));
        if (area === 'anchors') {
          if (get && !id) return send(res, 200, await matchmaker.anchorList());
          if (get && id && !action) return send(res, 200, matchmaker.anchorGames(id));
          if (post && id && action === 'keys') return send(res, 200, await matchmaker.offerKey(id, await read(req)));
        }
        if (area === 'delegates' && !action) {
          if (post && !id) return send(res, 200, await matchmaker.delegate(await read(req)));
          if (post && id === 'revoke') return send(res, 200, await matchmaker.revoke(await read(req)));
          if (get && id) return send(res, 200, matchmaker.delegatesOf(id));
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
  // Each loop runs one round at a time; the minter's apart, so a slow mint never holds up pairing.
  const loop = (work, what) => {
    let running = false;
    return async () => {
      if (running) return;
      running = true;
      try { await work(); } catch (e) { log(`${what} failed: ${e.message}`); } finally { running = false; }
    };
  };
  const timers = [];
  if (poll_ms > 0) {
    timers.push(setInterval(loop(() => matchmaker.tick(), 'tick'), poll_ms));
    if (minter) timers.push(setInterval(loop(() => minter.tick(), 'kifu round'), poll_ms));
    if (carder) timers.push(setInterval(loop(() => carder.tick(), 'rank card round'), poll_ms));
  }
  return new Promise(resolve => server.listen(port, host, () => resolve({
    url: `http://${host}:${server.address().port}`,
    close: () => { for (const t of timers) clearInterval(t); return new Promise(r => server.close(r)); },
  })));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = resolve(process.argv[2]);
  const config = loadConfig(JSON.parse(await readFile(file, 'utf8')), process.env, dirname(file));
  const chain = starknetChain({ rpc_url: config.rpc_url, channel: config.channel, ratings: config.ratings, account: config.account,
    kifu: config.kifu?.address, card: config.rank_card?.address });
  const log = message => console.log(`${new Date().toISOString()} ${message}`);
  const db = openDatabase(config.db);
  const profiles = new Profiles(db, { ...config.profiles, chain, chain_id: config.chain_id });
  const history = new History(db);
  const matchmaker = await Matchmaker.open(config, chain, { log, store: fileStore(config.store),
    admit: player => profiles.admit(player), record: game => history.recordCasual(game) });
  const sponsor = config.sponsor ? new Sponsor({ max_fee_fri: config.max_fee_fri, ...config.sponsor }, chain,
    { log, store: fileStore(resolve(dirname(file), config.sponsor.store ?? 'sponsor-state.json')) }) : null;
  const minter = config.kifu ? new KifuMinter({ max_fee_fri: config.max_fee_fri, ...config.kifu }, chain, new Kifus(db),
    { channel: config.channel, keepers: matchmaker.keepers, log }) : null;
  const carder = config.rank_card ? new RankCardMinter({ max_fee_fri: config.max_fee_fri, ...config.rank_card }, chain,
    new RankCards(db), { log }) : null;
  const { url } = await serve(matchmaker, { profiles, history, sponsor, minter, carder, from_header: config.sponsor?.from_header, host: config.host, port: config.port, poll_ms: (config.poll_seconds ?? 5) * 1000,
    cors_origin: config.cors_origin, log });
  log(`matchmaker ${p.hex(p.publicKey(config.matchmakerKey))} for channel ${p.hex(config.channel)} at ${url}`);
}
