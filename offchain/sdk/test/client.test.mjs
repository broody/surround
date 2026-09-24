import test from 'node:test';
import assert from 'node:assert/strict';
import { shortString } from 'starknet';
import * as p from '../src/index.mjs';
import * as c from '../src/client.mjs';
const tag=s=>BigInt(shortString.encodeShortString(s));
const terms={chain_id:1n,channel:2n,game_id:3n,black:4n,white:5n,black_key:p.publicKey('0x1'),white_key:p.publicKey('0x2'),prover:6n,size:9,komi_half:13,response_seconds:3600};
const session=new p.Session(terms);
session.move(p.action(p.PLAY,1,40),'0x1');
const expected={classHash:7n,terms,epoch:0,start:session.start,end:session.state,block:{block_number:123,block_hash:'0x456'},osProgram:8n};
test('native bases are ten blocks deep and never predate the channel anchor',()=>{
  assert.equal(c.nativeProofBlock(100,90),90);
  assert.equal(c.nativeProofBlock(100,91),null);
  assert.equal(c.nativeProofBlock(9,0),null);
  assert.equal(c.nativeProofBlock(101,90),91);
  assert.throws(()=>c.nativeProofBlock(100,-1));
});
function response(){
  const payload=c.proofPayload(expected.classHash,terms,0,session.start,session.state);
  return {proof:'opaque-test-response-not-a-real-proof',l2_to_l1_messages:[{from_address:'0x6',to_address:'0x0',payload:payload.map(p.hex)}],
    proof_facts:[tag('PROOF1'),tag('VIRTUAL_SNOS'),8n,tag('VIRTUAL_SNOS0'),123n,0x456n,9n,1n,p.poseidon([terms.prover,0,payload.length,...payload])].map(p.hex)};
}
test('Cairo state decoding rejects noncanonical flags and limbs',()=>{
  assert.deepEqual(c.decodeState(p.encodeState(session.state)),session.state);
  for(const [index,value] of [[15,2n],[2,1n<<128n],[25,1n<<32n]]){
    const encoded=p.encodeState(session.state);encoded[index]=value;
    assert.throws(()=>c.decodeState(encoded));
  }
});
test('native response checks bind the exact message and base block',()=>{
  assert.equal(c.validateNativeProof(response(),expected).proof,response().proof);
  const large=response();large.proof_facts[0]=p.hex(tag('PROOF2'));
  assert.equal(c.validateNativeProof(large,expected).proof,large.proof);
  assert.throws(()=>c.validateNativeProof(response(),{...expected,osProgram:9n}));
  assert.throws(()=>c.validateNativeProof(response(),{...expected,osProgram:undefined}));
  for(const mutate of [r=>r.proof='',r=>r.l2_to_l1_messages.push(r.l2_to_l1_messages[0]),
    r=>r.l2_to_l1_messages[0].from_address='0x7',r=>r.l2_to_l1_messages[0].to_address='0x1',
    r=>r.l2_to_l1_messages[0].payload[9]='0x1',r=>r.proof_facts[4]='0x7a',
    r=>r.proof_facts[0]=p.hex(tag('PROOF3')),r=>r.proof_facts[2]='0x9',r=>r.proof_facts[5]='0x457',r=>r.proof_facts[8]='0x1',r=>r.proof_facts.push('0x0')]){
    const r=response();mutate(r);assert.throws(()=>c.validateNativeProof(r,expected));
  }
});
test('native responses cannot cross games, epochs or output states',()=>{
  for(const changed of [{terms:{...terms,game_id:4n}},{epoch:1},{classHash:8n},
    {end:{...session.state,history_root:1n}},{end:{...session.state,winner:2}},
    {end:{...session.state,black_half:100}}])
    assert.throws(()=>c.validateNativeProof(response(),{...expected,...changed}));
});
