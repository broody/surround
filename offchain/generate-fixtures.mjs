// Deterministic PUBLIC test identities 1 and 2, never production session keys.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as p from './sdk/src/index.mjs';
const root = new URL('../',import.meta.url);
const records = JSON.parse(await readFile(new URL('benchmarks/results/move-fixtures.json',root),'utf8'));
const keys = { 1: '0x1', 2: '0x2' };
const baseTerms = { chain_id: 1n, channel: 2n, game_id: 3n, black: 4n, white: 5n,
  black_key: p.publicKey(keys[1]), white_key: p.publicKey(keys[2]), prover: 6n,
  size: 9, komi_half: 13, response_seconds: 3600 };
const move = (session, kind, point = p.NO_POINT, dead = 0n) => session.move(p.action(kind,session.state.next_player,point,dead),keys[session.state.next_player]);
await mkdir(new URL('fixtures/',import.meta.url),{recursive:true});
const corpus = [];
for (const [i,f] of records.entries()) {
  const session = new p.Session({ ...baseTerms, game_id: BigInt(i+10), size:f.size, komi_half:f.komi });
  for (const point of f.moves) move(session,point === p.NO_POINT ? p.PASS : p.PLAY,point);
  let dead = 0n; for (const point of f.representatives) dead = p.markGroup(session.state.board,f.size,dead,point);
  move(session,p.PROPOSE,p.NO_POINT,dead); move(session,p.ACCEPT);
  if (session.state.black_half-session.state.white_half !== f.margin) throw Error(`SGF mismatch: ${f.id}`);
  const fixture = { id:f.id, result:f.result, ...session.export(), expected:session.state,
    proof_input:p.encodeProofInput(session.terms,session.start,session.initialHistory,session.actions) };
  await writeFile(new URL(`fixtures/${f.id}.json`,import.meta.url),p.json(fixture));
  corpus.push({ id:f.id, result:f.result, size:f.size, moves:f.moves.length, actions:session.actions.length });
  console.log(`${f.id}: signed ${session.actions.length} actions; ${f.result} checked`);
}
const corner = new p.Session(baseTerms);
for (const point of [2,0,10,1,18,80]) move(corner,p.PLAY,point);
move(corner,p.PASS); move(corner,p.PASS);
move(corner,p.PROPOSE,p.NO_POINT,p.bits([0,1])); move(corner,p.RESUME);
move(corner,p.PLAY,9); move(corner,p.PASS); move(corner,p.PASS);
move(corner,p.PROPOSE); move(corner,p.ACCEPT);
const fixture = { id:'corner_dispute', ...corner.export(), expected:corner.state,
  proof_input:p.encodeProofInput(corner.terms,corner.start,corner.initialHistory,corner.actions) };
await writeFile(new URL('fixtures/corner_dispute.json',import.meta.url),p.json(fixture));
await writeFile(new URL('fixtures/manifest.json',import.meta.url),p.json(corpus));
const arr = xs => `array![${xs.map(p.hex).join(', ')}]`;
const source = `// Generated public cryptographic vectors. Test keys 1 and 2 have no assets.\nuse crate::channel_protocol::{Terms, ChannelState, SignedAction};\npub fn corner() -> (Terms, ChannelState, Span<felt252>, Span<SignedAction>, ChannelState) {\n let mut input = ${arr(fixture.proof_input)}.span();\n let terms = Serde::<Terms>::deserialize(ref input).unwrap();\n let start = Serde::<ChannelState>::deserialize(ref input).unwrap();\n let history = Serde::<Span<felt252>>::deserialize(ref input).unwrap();\n let actions = Serde::<Span<SignedAction>>::deserialize(ref input).unwrap();\n assert!(input.is_empty());\n let mut output = ${arr(p.encodeState(corner.state))}.span();\n let expected = Serde::<ChannelState>::deserialize(ref output).unwrap();\n (terms, start, history, actions, expected)\n}\n`;
await writeFile(new URL('src/tests/channel_vectors.cairo',root),source);
console.log('Generated shared Cairo/JS corner-dispute vector');
