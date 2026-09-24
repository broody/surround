import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as p from '../src/index.mjs';
const keys = { 1:'0x1', 2:'0x2' };
const terms = { chain_id:1n,channel:2n,game_id:3n,black:4n,white:5n,black_key:p.publicKey(keys[1]),white_key:p.publicKey(keys[2]),prover:6n,size:9,komi_half:13,response_seconds:3600 };
const move = (s,kind,point=p.NO_POINT,dead=0n) => s.move(p.action(kind,s.state.next_player,point,dead),keys[s.state.next_player]);

test('two independent clients exchange signed moves and reject replay',()=>{
  const a=new p.Session(terms), b=new p.Session(terms);
  const first=move(a,p.PLAY,40); b.receive(first);
  const next=move(b,p.PLAY,41); a.receive(next);
  assert.deepEqual(a.state,b.state);
  assert.throws(()=>b.receive(first),/signature/);
  assert.deepEqual(p.Session.import(JSON.parse(p.json(a.export()))).state,a.state);
  assert(!p.json(a.export()).includes('private'));
});

test('signatures bind game, chain, rules, previous state and action',()=>{
  const session=new p.Session(terms), signed=p.signAction(terms,session.state,p.action(p.PLAY,1,40),keys[1]);
  for (const modified of [{...terms,game_id:4n},{...terms,chain_id:2n},{...terms,komi_half:15},{...terms,prover:7n}])
    assert.throws(()=>new p.Session(modified).receive(signed),/signature/);
  assert.throws(()=>session.receive({...signed,action:{...signed.action,point:41}}),/signature/);
  assert.throws(()=>session.receive({...signed,signature:{...signed.signature,s:0n}}),/signature/);
  const state={...session.state,sequence:1};
  assert.throws(()=>p.applyAction(terms,state,session.history,signed),/signature/);
});

test('signed illegal actions, occupation, turn and padding are rejected',()=>{
  const s=new p.Session(terms); move(s,p.PLAY,40);
  assert.throws(()=>move(s,p.PLAY,40),/occupied/);
  assert.throws(()=>s.move(p.action(p.PLAY,1,41),keys[1]),/turn/);
  assert.throws(()=>move(s,p.PLAY,81),/bounds/);
  assert.throws(()=>s.move(p.action(p.PASS,2,40),keys[2]),/Noncanonical/);
});

test('scoring needs complete groups and both turns; disagreement resumes play',()=>{
  const s=new p.Session(terms);
  for(const point of [2,0,10,1,18,80])move(s,p.PLAY,point);
  move(s,p.PASS);move(s,p.PASS);
  const original=p.stateHash(s.state), history=[...s.history];
  assert.throws(()=>move(s,p.ACCEPT),/proposal/);
  assert.throws(()=>move(s,p.PROPOSE,p.NO_POINT,p.bits([0])),/Partial dead group/);
  assert.equal(p.stateHash(s.state),original);
  move(s,p.PROPOSE,p.NO_POINT,p.bits([0,1]));move(s,p.RESUME);
  assert.deepEqual(s.history,history);assert.equal(s.state.next_player,1);
  move(s,p.PLAY,9);assert.equal(s.state.black_captures,2);
  move(s,p.PASS);move(s,p.PASS);move(s,p.PROPOSE);move(s,p.ACCEPT);
  assert.equal(s.state.black_half-s.state.white_half,-3);
  assert.throws(()=>move(s,p.PLAY,20),/finished/);
});

test('missing history cannot remove a superko commitment',()=>{
  const s=new p.Session(terms);move(s,p.PLAY,40);
  const next=p.signAction(terms,s.state,p.action(p.PLAY,2,41),keys[2]);
  assert.throws(()=>p.applyAction(terms,s.state,s.history.slice(1),next),/history/);
});

test('checkpoint approvals bind the epoch and cannot reopen a channel',()=>{
  const s=new p.Session(terms);move(s,p.PLAY,40);
  const ack=s.checkpointSignature(7,keys[1]);
  assert(p.verifySignature(p.checkpointHash(terms,7,s.state),ack,terms.black_key));
  assert(!p.verifySignature(p.checkpointHash(terms,8,s.state),ack,terms.black_key));
  assert(!p.verifySignature(p.reopenHash(terms,7,s.state),ack,terms.black_key));
});

test('either player can sign a resignation, ending the match',()=>{
  const s=new p.Session(terms);s.move(p.action(p.RESIGN,2),keys[2]);
  assert.equal(s.state.winner,1);assert.equal(s.state.finish_reason,2);
  assert.throws(()=>move(s,p.PASS),/finished/);
});

test('resume-then-play cannot outrank an opponent-acknowledged scoring branch',()=>{
  const prefix=new p.Session(terms);move(prefix,p.PASS);move(prefix,p.PASS);
  const agreed=p.Session.import(prefix.export()),fork=p.Session.import(prefix.export());
  move(agreed,p.PROPOSE);move(agreed,p.ACCEPT);
  move(fork,p.RESUME);move(fork,p.PLAY,40);
  assert.equal(agreed.state.sequence,fork.state.sequence);
  assert(agreed.state.support_turn>fork.state.support_turn);
  assert.equal(fork.state.last_actor,1);
});

test('every signed recorded game matches its published result',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../../fixtures/manifest.json',import.meta.url),'utf8'));
  for(const row of manifest){
    const f=JSON.parse(await readFile(new URL(`../../fixtures/${row.id}.json`,import.meta.url),'utf8'));
    const session=p.Session.import(f);
    assert.deepEqual(session.state,p.normalizeState(f.expected));
    assert.equal(session.state.move_number,row.moves);
  }
});
