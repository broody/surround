// Writes a virtual-OS job (os-job.json) for a recorded fixture replayed against a
// game already registered onchain, e.g. a historical Sepolia game at its epoch-0
// base block. Used for capacity and proving measurements; nothing is broadcast.
//
// node offchain/server/tools/os-job.mjs --rpc URL --channel ADDR --game ID --block N \
//   (--fixture kgs_2019_04_10_39 [--steps 128] | --session FILE) --out DIR
// Fixture steps are re-signed with the PUBLIC test keys 0x1 and 0x2, which must
// be the game's registered session keys. `--session` takes a saved transcript
// instead (`json(session.export())`, e.g. results/raw/sepolia/NAME-session.json),
// which a ranked game needs: its steps carry the referee's stamps.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { RpcProvider } from '../../sdk/node_modules/starknet/dist/index.mjs';
import * as p from '../../sdk/src/index.mjs';
import * as c from '../../sdk/src/client.mjs';

const { values: a } = parseArgs({ options: {
  rpc: { type: 'string' }, channel: { type: 'string' }, game: { type: 'string' }, block: { type: 'string' },
  fixture: { type: 'string' }, steps: { type: 'string' }, session: { type: 'string' }, out: { type: 'string' },
} });
for (const k of ['rpc', 'channel', 'game', 'block', 'out']) if (!a[k]) throw Error(`--${k} is required`);
if (!a.fixture === !a.session) throw Error('Pass --fixture or --session');
const keys = [0x1n, 0x2n];
const here = dirname(fileURLToPath(import.meta.url));
const provider = new RpcProvider({ nodeUrl: a.rpc });
const block = await provider.getBlockWithTxHashes(Number(a.block));
const snapshot = await c.getSnapshot(provider, a.channel, a.game, block.block_hash);
if (snapshot.terms.keys.join() !== keys.map(p.publicKey).join())
  throw Error('The game does not use the public test session keys');
const session = a.session ? p.importSession(JSON.parse(await readFile(a.session, 'utf8'))) : p.goSession(snapshot.terms);
if (session.context !== p.contextHash(p.go, snapshot.terms)) throw Error('The session has other terms than the game');
if (p.stateHash(p.go, session.start) !== snapshot.anchor_hash) throw Error('Expected the game at its opening anchor');

const nonce = await provider.getNonceForAddress(p.hex(snapshot.terms.prover), block.block_hash);
const classHash = await provider.getClassHashAt(p.hex(snapshot.terms.prover), block.block_hash);
const chainId = await provider.getChainId();
if (a.fixture) {
  const fixture = JSON.parse(await readFile(resolve(here, `../../fixtures/${a.fixture}.json`), 'utf8'));
  const limit = a.steps ? Number(a.steps) : fixture.steps.length;
  for (const { step } of fixture.steps.slice(0, limit)) {
    const { kind, point, dead } = step.action;
    session.move(p.goStep(kind, point, dead), keys[session.due()]);
  }
}
const transaction = c.provingTransaction({ session, epoch: snapshot.epoch, nonce });
const chain = Buffer.from(BigInt(chainId).toString(16), 'hex').toString();
const payload = p.proofPayload(p.go, { classHash, prover: snapshot.terms.prover, terms: snapshot.terms, context: session.context,
  epoch: snapshot.epoch, startHash: snapshot.anchor_hash, endHash: session.stateHash() });

await mkdir(a.out, { recursive: true });
await writeFile(resolve(a.out, 'os-job.json'), p.json({ rpc_url: a.rpc, chain_id: chain, block_number: block.block_number, transaction }));
await writeFile(resolve(a.out, 'expected.json'), p.json({
  fixture: a.fixture ?? a.session, steps: session.steps.length, timed: session.timed, epoch: snapshot.epoch, base_block: block.block_number,
  base_block_hash: block.block_hash, from_address: snapshot.terms.prover, payload, end: session.env,
}));
console.log(`${a.fixture ?? a.session}: ${session.steps.length} steps at block ${block.block_number} -> ${a.out}`);
