// Two disposable local wallets. No native proof acceptance is simulated here.
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { Account,RpcProvider,hash } from './sdk/node_modules/starknet/dist/index.mjs';
import * as p from './sdk/src/index.mjs';
import * as c from './sdk/src/client.mjs';
import assert from 'node:assert/strict';
const url=process.argv[2], parsed=new URL(url);
assert(parsed.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(parsed.hostname));
assert.equal(BigInt(await c.rpc(url,'starknet_chainId')),0x4b4154414e41n);
const provider=new RpcProvider({nodeUrl:url});
const stored=await c.rpc(url,'devnet_getPredeployedAccounts',{with_balance:false});
const accounts=stored.slice(0,2).map(a=>new Account({provider,address:a.address,signer:a.private_key}));
const manifest=JSON.parse(await readFile(new URL('../manifest_dev.json',import.meta.url),'utf8'));
const channel=BigInt(manifest.contracts.find(c=>c.tag==='surround-channel').address);
const artifact=JSON.parse(await readFile(new URL('./cairo/target/dev/surround_offchain_ChannelProver.contract_class.json',import.meta.url),'utf8'));
const casm=JSON.parse(await readFile(new URL('./cairo/target/dev/surround_offchain_ChannelProver.compiled_contract_class.json',import.meta.url),'utf8'));
const bounds=Object.fromEntries(['l1_gas','l1_data_gas','l2_gas'].map(k=>[k,{max_amount:10_000_000_000n,max_price_per_unit:1n}]));
const options={resourceBounds:bounds,tip:0n};
const report={network:'local Devnet 0.8.0',proof_verification:'No proof fields submitted; direct replay and negative native checks only',transactions:[],checks:[]};
async function receipt(tx){
  const r=await provider.waitForTransaction(tx.transaction_hash,{retryInterval:20});
  assert.equal(r.execution_status,'SUCCEEDED',p.json(r));
  return r;
}
const declared=await accounts[0].declare({contract:artifact,casm},options);await receipt(declared);
const deployed=await accounts[0].deployContract({classHash:declared.class_hash},options);await receipt(deployed);
const prover=BigInt(deployed.contract_address);
assert.equal(BigInt(await provider.getClassHashAt(p.hex(prover))),BigInt(hash.computeContractClassHash(artifact)));
report.prover=p.hex(prover);report.channel=p.hex(channel);
const testKeys={1:'0x1',2:'0x2'}; // Explicit public test keys; no production keys.
const invoke=async(player,call,label)=>{
  const tx=await accounts[player].execute(call,options),r=await receipt(tx);
  report.transactions.push({label,hash:tx.transaction_hash,resources:r.execution_resources});return r;
};
const expectFailure=async(player,call,reason)=>{
  await assert.rejects(accounts[player].estimateInvokeFee(call,{tip:0n}),e=>p.json(e).includes(reason)||String(e).includes(reason));
  report.checks.push(`Rejected ${reason}`);
};
const game=async id=>c.decodeChannel(await provider.callContract(c.channelCall(channel,'get_channel',[id])));
async function create(size=9,komi_half=13){
  const r=await invoke(0,c.createChannelCall({channel,size,komi_half,session_key:p.publicKey(testKeys[1]),prover,response_seconds:300}),'create');
  const trace=await c.rpc(url,'starknet_traceTransaction',{transaction_hash:r.transaction_hash});
  const id=BigInt(trace.execute_invocation.calls.find(x=>BigInt(x.contract_address)===channel).result[0]);
  await invoke(1,c.joinChannelCall(channel,id,p.publicKey(testKeys[2])),'join');
  return {id,snapshot:await c.getSnapshot(provider,channel,id)};
}
const move=(session,kind,point=p.NO_POINT,dead=0n)=>session.move(p.action(kind,session.state.next_player,point,dead),testKeys[session.state.next_player]);
const advance=async time=>c.rpc(url,'devnet_setTime',{time,generate_block:true});

// Complete recorded game: hundreds of session signatures can be checked by the
// same direct replay path used when the external prover is unavailable.
const first=await create(9,14),session=new p.Session(first.snapshot.terms);
const fixture=JSON.parse(await readFile(new URL('./fixtures/cgos_9_1682833.json',import.meta.url),'utf8'));
for(const signed of fixture.actions)move(session,signed.action.kind,signed.action.point,BigInt(signed.action.dead));
const blackAck=session.checkpointSignature(0,testKeys[1]),whiteAck=session.checkpointSignature(0,testKeys[2]);
await expectFailure(0,c.settlementCall(prover,channel,first.id,0,session.state,blackAck,whiteAck),'Missing proof facts');
await expectFailure(0,c.channelCall(channel,'accept_verified',[first.id,0,p.stateHash(session.start),...p.encodeState(session.state),blackAck.r,blackAck.s,whiteAck.r,whiteAck.s]),'Only pinned prover');
const badAck={...whiteAck,s:whiteAck.s^1n};
await expectFailure(0,c.directHistoryCall(channel,first.id,0,session.initialHistory,session.actions,blackAck,badAck),'Invalid session signature');
await invoke(0,c.directHistoryCall(channel,first.id,0,session.initialHistory,session.actions,blackAck,whiteAck),'agreed full-game direct settlement');
assert.deepEqual((await game(first.id)).anchor,session.state);assert.equal((await game(first.id)).status,4);
report.checks.push('All 68 recorded actions, signatures and W+2 result matched in actual Dojo contract');

// A partial cooperative checkpoint followed by normal offchain continuation.
const checkpoint=await create(),part=new p.Session(checkpoint.snapshot.terms);
move(part,p.PLAY,40);move(part,p.PLAY,41);
await invoke(0,c.directHistoryCall(channel,checkpoint.id,0,part.initialHistory,part.actions,
  part.checkpointSignature(0,testKeys[1]),part.checkpointSignature(0,testKeys[2])),'cooperative checkpoint');
const anchored=await c.getSnapshot(provider,channel,checkpoint.id);
assert.equal(anchored.epoch,1);assert.deepEqual(anchored.state,part.state);
const tail=new p.Session(anchored.terms,anchored.state,part.history);
move(tail,p.PASS);move(tail,p.PASS);move(tail,p.PROPOSE);move(tail,p.ACCEPT);
await expectFailure(0,c.directHistoryCall(channel,checkpoint.id,0,tail.initialHistory,tail.actions),'Stale channel epoch');
await invoke(1,c.directHistoryCall(channel,checkpoint.id,1,tail.initialHistory,tail.actions,
  tail.checkpointSignature(1,testKeys[1]),tail.checkpointSignature(1,testKeys[2])),'checkpoint continuation settled');
assert.equal((await game(checkpoint.id)).status,4);

// Freeze an anchor, submit newer signed candidates without moving that anchor,
// resolve to a fresh response window, force a legal move, then resume offchain.
const dispute=await create(),prefix=new p.Session(dispute.snapshot.terms);
move(prefix,p.PLAY,40);move(prefix,p.PLAY,41);
await invoke(1,c.disputeCall(channel,dispute.id,0),'open dispute');
const deadline=(await game(dispute.id)).deadline;
await invoke(0,c.directHistoryCall(channel,dispute.id,0,prefix.initialHistory,prefix.actions),'candidate 2');
move(prefix,p.PLAY,30);move(prefix,p.PLAY,31);
await invoke(1,c.directHistoryCall(channel,dispute.id,0,prefix.initialHistory,prefix.actions),'candidate 4');
let pending=await game(dispute.id);
assert.equal(pending.deadline,deadline);assert.equal(pending.anchor.sequence,0);assert.equal(pending.candidate.sequence,4);
await advance(deadline);await invoke(0,c.resolveCall(channel,dispute.id,0),'resolve to forced play');
let forced=await game(dispute.id);assert.equal(forced.epoch,1);assert(forced.deadline>deadline);
await expectFailure(1,c.timeoutCall(channel,dispute.id,1),'Turn window open');
const a=p.action(p.PLAY,1,20);prefix.move(a,testKeys[1]);
await invoke(0,c.forceActionCall(channel,dispute.id,1,prefix.history.slice(0,-1),a),'forced move');
forced=await game(dispute.id);assert.deepEqual(forced.anchor,prefix.state);
const message=p.reopenHash(dispute.snapshot.terms,forced.epoch,forced.anchor);
await invoke(0,c.resumeCall(channel,dispute.id,forced.epoch,p.sign(message,testKeys[1]),p.sign(message,testKeys[2])),'mutual return to offchain play');
assert.equal((await game(dispute.id)).status,1);
report.checks.push('Frozen dispute anchor, newer histories, fresh deadline, forced move and mutual offchain resumption verified');

const timed=await create();await invoke(1,c.disputeCall(channel,timed.id,0),'timeout dispute');
await advance((await game(timed.id)).deadline);await invoke(1,c.resolveCall(channel,timed.id,0),'timeout forced phase');
await advance((await game(timed.id)).deadline);await invoke(1,c.timeoutCall(channel,timed.id,1),'timeout claimed');
assert.equal((await game(timed.id)).anchor.winner,2);assert.equal((await game(timed.id)).anchor.finish_reason,3);
report.checks.push('Only the onchain response deadline determines timeout');
report.completed_at=new Date().toISOString();
await mkdir(new URL('./results/',import.meta.url),{recursive:true});
await writeFile(new URL('./results/local-integration.json',import.meta.url),p.json(report));
console.log(`Local integration passed: ${report.transactions.length} signed transactions, ${report.checks.length} checks`);
