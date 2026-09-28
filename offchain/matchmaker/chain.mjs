// The matchmaker's view of Starknet: players' ranks from SurroundRatings, the
// rated games the channel created (from the world's StoreSetRecord events),
// their status, and `rate` calls sent from the matchmaker's own account. Any
// object with the same methods can stand in for it (the tests use a fake).
import { Account, RpcProvider, hash } from '../sdk/node_modules/starknet/dist/index.mjs';
import * as p from '../sdk/src/index.mjs';
import * as c from '../sdk/src/client.mjs';

const STORE_SET_RECORD = BigInt(hash.getSelectorFromName('StoreSetRecord'));

/** Dojo's `bytearray_hash`: Poseidon over a ByteArray's Serde encoding. */
function bytearrayHash(text) {
  const bytes = Buffer.from(text), words = [];
  let i = 0;
  for (; i + 31 <= bytes.length; i += 31) words.push(BigInt(`0x${bytes.subarray(i, i + 31).toString('hex')}`));
  const rest = bytes.subarray(i);
  return p.poseidon([BigInt(words.length), ...words, rest.length ? BigInt(`0x${rest.toString('hex')}`) : 0n, BigInt(rest.length)]);
}
/** Dojo's selector for a namespace's model, as `selector_from_tag!`. */
export const dojoSelector = (namespace, name) => p.poseidon([bytearrayHash(namespace), bytearrayHash(name)]);

/** A `RatedGame` record from a StoreSetRecord event's data. */
export function ratedGameRecord(data) {
  const d = data.map(BigInt);
  const keys = d.slice(1, 1 + Number(d[0])), values = d.slice(2 + Number(d[0]));
  const [black, white, size, source, black_band, white_band, matchmaker, ticket, expires_at, played_at] = values;
  return { game_id: keys[0], black, white, size: Number(size), source: Number(source), black_band: Number(black_band),
    white_band: Number(white_band), matchmaker, ticket, expires_at: Number(expires_at), played_at: Number(played_at) };
}

export function starknetChain({ rpc_url, world, channel, ratings, namespace = 'surround', account = null, max_fee_fri = null }) {
  const provider = new RpcProvider({ nodeUrl: rpc_url });
  const signer = account && new Account({ provider, address: account.address, signer: account.privateKey });
  const ratedSelector = dojoSelector(namespace, 'RatedGame');
  const call = (entrypoint, calldata = [], contract = channel) => provider.callContract(c.channelCall(contract, entrypoint, calldata));
  return {
    provider,
    /** Unix seconds at the chain's head. */
    async now() { return BigInt((await provider.getBlockWithTxHashes('latest')).timestamp); },
    /** player -> { rank_tenths, provisional, rated } */
    async ranks(players) {
      const r = (await call('ranks', [players.length, ...players], ratings)).map(BigInt);
      return new Map(players.map((x, i) => [x, { rank_tenths: Number(r[1 + 3 * i]), provisional: r[2 + 3 * i] === 1n, rated: r[3 + 3 * i] === 1n }]));
    },
    /** The rated games created from `from` on, and the block scanned to. */
    async ratedGames(from) {
      const to = await provider.getBlockNumber();
      const games = [];
      let continuation_token;
      do {
        const page = await provider.getEvents({ address: p.hex(world), from_block: { block_number: from }, to_block: { block_number: to },
          keys: [[p.hex(STORE_SET_RECORD)], [p.hex(ratedSelector)]], chunk_size: 100, continuation_token });
        for (const event of page.events) games.push(ratedGameRecord(event.data));
        continuation_token = page.continuation_token;
      } while (continuation_token);
      return { games, to };
    },
    /** The channel's status for a game (4 settled, 5 cancelled). */
    async status(gameId) { return (await c.getChannel(provider, channel, gameId)).status; },
    /** When white joined a rated game (0 until then). */
    async playedAt(gameId) { return Number(BigInt((await call('rated_game', [gameId]))[10])); },
    /** SurroundRatings' record of a game: 0 none, 1 rated, 2 void. */
    async rated(gameId) { return Number(BigInt((await call('game_status', [channel, gameId], ratings))[0])); },
    /** Report settled games, in one transaction. */
    async rate(gameIds) {
      if (!signer) throw Error('The matchmaker needs an account to send rate');
      const calls = gameIds.map(id => c.rateCall(channel, id));
      const estimate = await signer.estimateInvokeFee(calls, { tip: 0n });
      if (max_fee_fri != null && estimate.overall_fee > max_fee_fri) throw Error(`rate fee ${estimate.overall_fee} exceeds ${max_fee_fri}`);
      const tx = await signer.execute(calls, { tip: 0n, resourceBounds: estimate.resourceBounds });
      const receipt = await provider.waitForTransaction(tx.transaction_hash, { retryInterval: 1000 });
      if (receipt.execution_status !== 'SUCCEEDED') throw Error(`rate reverted: ${receipt.revert_reason}`);
      return tx.transaction_hash;
    },
    /** Whether `player`'s account signed `typedData` (SNIP-12, through the account contract). */
    verify(player, typedData, signature) { return provider.verifyMessageInStarknet(typedData, signature, player); },
  };
}
