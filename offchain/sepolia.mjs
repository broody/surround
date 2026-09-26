// Reproducible, fee-capped Sepolia validation of Surround on referee. Public
// fixtures use test keys 0x1/0x2 (seat 0 black, seat 1 white).
// The funded wallet key stays in process memory and child environment only.
import { readFile,writeFile,mkdir,stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Account,RpcProvider,hash,ec } from './sdk/node_modules/starknet/dist/index.mjs';
import * as p from './sdk/src/index.mjs';
import * as c from './sdk/src/client.mjs';
// Re-sign a fixture step with the public test key of its seat for this channel.
// Steps carry no seat (referee v2): the due seat plays, except a resignation.
const replay=(session,step)=>{
  const testKeys=[0x1n,0x2n];
  if(step.kind===p.MOVE_RESIGN)return session.move(p.resignStep(step.seat),testKeys[step.seat]);
  const {kind,point,dead}=step.action;
  session.move(p.goStep(kind,point,dead),testKeys[session.due()]);
};
async function main(){
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const RPC=process.env.SURROUND_SEPOLIA_RPC??'https://starknet-sepolia-rpc.publicnode.com';
const PROVER=process.env.SURROUND_SEPOLIA_PROVER??'https://transaction-prover.alpha-sepolia.sw-dev.io';
const STRK='0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const CHAIN=0x534e5f5345504f4c4941n;
// The pre-referee deployment's record stays in results/sepolia.json and the
// referee protocol v1 record in results/sepolia-referee.json.
const resultFile=resolve(root,'offchain/results/sepolia-referee-v2.json');
const previousFile=resolve(root,'offchain/results/sepolia-referee.json');
const raw=resolve(root,'offchain/results/raw/sepolia');
const node=new RpcProvider({nodeUrl:RPC,resourceBoundsOverhead:Object.fromEntries(
  ['l1_gas','l1_data_gas','l2_gas'].map(k=>[k,{max_amount:15,max_price_per_unit:15}]))});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const cap=40n*10n**18n, declarationCap=80n*10n**18n, migrationCap=120n*10n**18n;
const keys=[0x1n,0x2n];
assert.equal(BigInt(await node.getChainId()),CHAIN,'Sepolia only');
const accountFile=process.env.SURROUND_ACCOUNT_FILE??resolve(homedir(),'.starknet_accounts/starknet_open_zeppelin_accounts.json');
assert.equal((await stat(accountFile)).mode&0o777,0o600,'Signer file must be owner-only');
// The funded signer: an alpha-sepolia entry (SURROUND_SEPOLIA_ACCOUNT, default
// account-1). Optionally pin its address with SURROUND_SEPOLIA_ADDRESS.
const accountName=process.env.SURROUND_SEPOLIA_ACCOUNT??'account-1';
const stored=JSON.parse(await readFile(accountFile,'utf8'))['alpha-sepolia']?.[accountName];
assert(stored,`No alpha-sepolia account ${accountName}`);
if(process.env.SURROUND_SEPOLIA_ADDRESS)assert.equal(BigInt(stored.address),BigInt(process.env.SURROUND_SEPOLIA_ADDRESS),'Unexpected funded test signer');
const SIGNER=stored.address;
let onchainKey;
for(const entry of ['get_public_key','getPublicKey','get_owner']){
  try{onchainKey=BigInt((await node.callContract(c.channelCall(SIGNER,entry)))[0]);break;}catch{}
}
assert.equal(onchainKey,BigInt(ec.starkCurve.getStarkKey(stored.private_key)),'Signer key does not match the deployed account');
const account=new Account({provider:node,address:stored.address,signer:stored.private_key});
const artifact=JSON.parse(await readFile(resolve(root,'offchain/cairo/target/dev/surround_offchain_ChannelProver.contract_class.json'),'utf8'));
const classHash=hash.computeContractClassHash(artifact);
let state;
try {state=JSON.parse(await readFile(resultFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
state??={network:'SN_SEPOLIA',protocol:'referee',signer:SIGNER,rpc_url:RPC,prover_url:PROVER,class_hash:classHash,created_at:new Date().toISOString(),transactions:{},records:{},
  test_players:'Both test seats controlled by the harness; public session keys 1 and 2 carry no real assets.'};
assert.equal(BigInt(state.class_hash),BigInt(classHash),'Preserve the previous deployment if the protocol changes');
// The white test wallet does not depend on the protocol: reuse the v1 one
// (redeploying it with the same salt would collide).
if(!state.white){
  try{
    const previous=JSON.parse(await readFile(previousFile,'utf8'));
    if(previous.white){state.white=previous.white;state.transactions.deploy_white=previous.transactions.deploy_white;}
  }catch(e){if(e.code!=='ENOENT')throw e;}
}
await mkdir(raw,{recursive:true});
const save=()=>writeFile(resultFile,p.json(state));
await save();
async function balance(){const n=await node.callContract(c.channelCall(STRK,'balance_of',[SIGNER]));return BigInt(n[0])+(BigInt(n[1])<<128n);}
const initialBalance=await balance();
console.log(`Verified Sepolia: ${Number(initialBalance)/1e18} test STRK, native prover ${await c.rpc(PROVER,'starknet_specVersion')}`);
const command=process.argv[2]??'preflight';
if(command==='preflight')process.exit(0);
assert(['deploy','run','batch'].includes(command),'Use preflight, deploy, run or batch');

async function receipt(txHash,allowRevert=false){
  for(let i=0;i<200;i++){
    let r;try{r=await node.getTransactionReceipt(txHash);}catch(e){if(e.baseError?.code!==29)throw e;}
    if(r?.execution_status==='REVERTED' && !allowRevert)throw Error(`Reverted ${txHash}: ${r.revert_reason}`);
    if(r?.block_hash && ['ACCEPTED_ON_L2','ACCEPTED_ON_L1'].includes(r.finality_status))return {transaction_hash:txHash,block_number:r.block_number,block_hash:r.block_hash,
      execution_status:r.execution_status,finality_status:r.finality_status,execution_resources:r.execution_resources,actual_fee:r.actual_fee,
      ...(r.revert_reason?{revert_reason:r.revert_reason}:{})};
    await pause(1500);
  }
  throw Error(`Receipt pending; rerun with saved transaction ${txHash}`);
}
function bounds(estimate,limit=cap){
  const rb=structuredClone(estimate.resourceBounds);
  // Small invokes need room for account validation omitted by SKIP_VALIDATE.
  if(limit===cap)for(const r of Object.values(rb))r.max_amount=(r.max_amount*150n+114n)/115n;
  const maximum=Object.values(rb).reduce((s,r)=>s+BigInt(r.max_amount)*BigInt(r.max_price_per_unit),0n);
  assert(maximum<=limit,`Transaction exceeds ${Number(limit)/1e18} test STRK cap: ${Number(maximum)/1e18}`);return rb;
}
async function freshBlock(){
  const minimum=Math.max(0,...Object.values(state.transactions).map(r=>r.block_number??0));
  for(let i=0;i<30;i++){const n=await node.getBlockNumber();if(n>=minimum)return n;await pause(1500);}
  throw Error('RPC is behind confirmed transactions');
}
async function execute(label,calls,options={}){
  let r=state.transactions[label];
  if(!r){
    const blockIdentifier=await freshBlock();
    // Include account validation: some account classes validate expensively.
    const estimate=await account.estimateInvokeFee(calls,{tip:0n,blockIdentifier,skipValidate:false,...options});
    r=await account.execute(calls,{tip:0n,...options,resourceBounds:bounds(estimate)});
    state.transactions[label]={transaction_hash:r.transaction_hash};await save();
  }
  if(!state.transactions[label].block_number){state.transactions[label]=await receipt(r.transaction_hash);await save();}
  console.log(`${label}: ${r.transaction_hash}`);return state.transactions[label];
}
async function declare(label,directory,name){
  const contract=JSON.parse(await readFile(resolve(root,directory,`${name}.contract_class.json`),'utf8'));
  const casm=JSON.parse(await readFile(resolve(root,directory,`${name}.compiled_contract_class.json`),'utf8'));
  const classHash=hash.computeContractClassHash(contract);
  try {await node.getClassByHash(classHash);}
  catch(e){
    if(e.baseError?.code!==28)throw e;
    const id=`declare_${label}`;
    if(!state.transactions[id]){
      const estimate=await account.estimateDeclareFee({contract,casm},{tip:0n});
      console.log(`${label} declaration maximum ${Number(estimate.overall_fee)/1e18} test STRK including 15% gas/price margins`);
      const tx=await account.declare({contract,casm},{tip:0n,resourceBounds:bounds(estimate,declarationCap)});
      state.transactions[id]={transaction_hash:tx.transaction_hash};await save();
    }
    state.transactions[id]=await receipt(state.transactions[id].transaction_hash);await save();
  }
  return classHash;
}
async function deploy(label,directory,name,constructorCalldata=[]){
  const classHash=await declare(label,directory,name);
  const id=`deploy_${label}`;
  if(state.transactions[id]&&!state.transactions[id].block_hash){
    const r=await receipt(state.transactions[id].transaction_hash,true);
    if(r.execution_status==='REVERTED'){
      assert(r.revert_reason.includes('Insufficient max L2Gas'),'Deployment reverted for another reason');
      state.transactions[`${id}_reverted_${r.transaction_hash}`]=r;delete state.transactions[id];delete state[label];await save();
    }else{state.transactions[id]=r;await save();}
  }
  if(!state[label]){
    const payload={classHash,salt:'0x537572726f756e64',constructorCalldata};
    const estimate=await account.estimateDeployFee(payload,{tip:0n,blockIdentifier:await freshBlock(),skipValidate:false});
    const tx=await account.deploy(payload,{tip:0n,resourceBounds:bounds(estimate)});
    state[label]=tx.contract_address[0];state.transactions[id]={transaction_hash:tx.transaction_hash};await save();
  }
  if(!state.transactions[id].block_number){state.transactions[id]=await receipt(state.transactions[id].transaction_hash);await save();}
  assert.equal(BigInt(await node.getClassHashAt(state[label],await freshBlock())),BigInt(classHash));
  console.log(`${label}: ${state[label]}`);
}
async function child(args,env){
  await new Promise((resolve,reject)=>{
    const task=spawn('sozo',args,{cwd:root,env,stdio:['ignore','pipe','pipe']});
    let output='';task.stdout.on('data',d=>output+=d);task.stderr.on('data',d=>output+=d);
    task.on('error',reject);task.on('exit',code=>code===0?resolve():reject(Error(output.slice(-6000))));
  });
}
if(command==='deploy'){
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('DOJO_')));
  await child(['build','--profile','sepolia'],env);
  await declare('channel','target/sepolia','surround_channel');
  if(!state.channel){
  // On resume, replace old maximum-fee reservations with confirmed actual fees.
  // Never release an uncertain broadcast until its recorded hash is resolved.
  let spent=0n;
  for(const [label,r] of Object.entries(state.transactions))if(label.startsWith('migration_')||label==='declare_channel'){
    const confirmed=r.block_number?r:await receipt(r.transaction_hash);
    state.transactions[label]=confirmed;spent+=BigInt(confirmed.actual_fee.amount);
  }
  state.migration_reserved=p.hex(spent);await save();
  // Sozo's version gate expects RPC 0.9. Forward actual requests unchanged and
  // enforce a cumulative maximum-fee budget before any broadcast.
  const bridge=createServer(async(req,res)=>{
    try{
      let requestBody='';for await(const chunk of req)requestBody+=chunk;
      const q=JSON.parse(requestBody);
      let body,reservation=0n;
      if(q.method==='starknet_specVersion')body={jsonrpc:'2.0',id:q.id,result:'0.9.0'};
      else{
        if(q.method.startsWith('starknet_add')){
          const tx=Object.values(q.params).find(t=>t?.resource_bounds);
          assert(tx,'Expected a V3 bounded transaction');
          assert.equal(BigInt(tx.sender_address??SIGNER),BigInt(SIGNER));
          const maximum=Object.values(tx.resource_bounds).reduce((s,r)=>s+BigInt(r.max_amount)*BigInt(r.max_price_per_unit),0n);
          const reserved=BigInt(state.migration_reserved??'0x0');
          if(maximum>cap || reserved+maximum>migrationCap){
            await writeFile(resolve(raw,'blocked-declaration.json'),JSON.stringify(tx));
          }
          assert(maximum<=cap && reserved+maximum<=migrationCap,
            `Migration fee budget exceeded: transaction maximum ${Number(maximum)/1e18}, reserved ${Number(reserved)/1e18} test STRK`);
          reservation=maximum;
          state.migration_reserved=p.hex(reserved+maximum);await save();
        }
        const r=await fetch(RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:requestBody,signal:AbortSignal.timeout(120000)});
        body=await r.json();
        if(reservation && body.error?.code===51){
          // CLASS_ALREADY_DECLARED is a definite rejection before broadcasting.
          state.migration_reserved=p.hex(BigInt(state.migration_reserved)-reservation);await save();
        }
        if(q.method.startsWith('starknet_add') && body.result?.transaction_hash){
          state.transactions[`migration_${body.result.transaction_hash}`]={transaction_hash:body.result.transaction_hash};await save();
        }
      }
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(body));
    }catch(e){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32000,message:e.message}}));}
  });
  await new Promise(r=>bridge.listen(0,'127.0.0.1',r));
  try{
    await child(['migrate','--profile','sepolia','--wait','--use-blake2s-casm-class-hash','--rpc-url',`http://127.0.0.1:${bridge.address().port}`],
      {...env,DOJO_ACCOUNT_ADDRESS:stored.address,DOJO_PRIVATE_KEY:stored.private_key});
  }finally{await new Promise(r=>bridge.close(r));}
  const manifest=JSON.parse(await readFile(resolve(root,'manifest_sepolia.json'),'utf8'));
  state.channel=manifest.contracts.find(c=>c.tag==='surround-channel').address;state.world=manifest.world.address;await save();
  for(const [label,r] of Object.entries(state.transactions))if(label.startsWith('migration_')&&!r.block_hash){state.transactions[label]=await receipt(r.transaction_hash);await save();}
  }
  const channelArtifact=JSON.parse(await readFile(resolve(root,'target/sepolia/surround_channel.contract_class.json'),'utf8'));
  assert.equal(BigInt(await node.getClassHashAt(state.channel,await freshBlock())),BigInt(hash.computeContractClassHash(channelArtifact)),
    'Existing channel class differs; preserve it and deploy a new protocol version');
  await deploy('prover','offchain/cairo/target/dev','surround_offchain_ChannelProver',[c.VIRTUAL_OS_PROGRAM]);
  // The migrating account owns the namespace and allowlists the adapter class.
  await execute('allow_prover',c.allowProverCall(state.channel,classHash));
  await deploy('white','offchain/testing/target/dev','surround_test_player_TestPlayer',[SIGNER]);
  state.balance_after_deploy=p.hex(await balance());await save();
  console.log('Dojo channel and immutable native adapter deployed on Sepolia');
  process.exit(0);
}
assert(state.channel && state.prover && state.white,'Deploy first');
if(command==='batch'){
  const name=process.argv[3]??'kgs_2019_04_10_39', chunk=Number(process.argv[4]??64);
  assert(Number.isInteger(chunk)&&chunk>0&&chunk<=1000,'Use 1–1000 steps per checkpoint');
  const record=state.records[name]??={};
  if(record.completed_at){console.log(`${name}: already settled`);return;}
  const fixture=JSON.parse(await readFile(resolve(root,`offchain/fixtures/${name}.json`),'utf8'));
  const created=await execute(`${name}_create`,c.createChannelCall({channel:state.channel,size:fixture.terms.config.size,komi_half:fixture.terms.config.komi_half,
    invited_white:state.white,session_key:p.publicKey(keys[0]),prover:state.prover}));
  if(!record.game_id){
    const trace=await c.rpc(RPC,'starknet_traceTransaction',{transaction_hash:created.transaction_hash});
    record.game_id=trace.execute_invocation.calls.find(x=>BigInt(x.contract_address)===BigInt(state.channel)).result[0];await save();
  }
  await execute(`${name}_join`,c.channelCall(state.white,'join',[state.channel,record.game_id,p.publicKey(keys[1])]));
  let whole;
  try{whole=p.importSession(JSON.parse(await readFile(resolve(raw,`${name}-session.json`),'utf8')));}
  catch(e){
    if(e.code!=='ENOENT')throw e;
    const snapshot=await c.getSnapshot(node,state.channel,record.game_id,await freshBlock());
    whole=p.goSession(snapshot.terms);
    for(const {step} of fixture.steps)replay(whole,step);
    await writeFile(resolve(raw,`${name}-session.json`),p.json(whole.export()));
  }
  const prefix=p.goSession(whole.terms,{start:whole.start,witness:whole.startWitness});
  record.full_game_prover_limit??=record.proving_error;delete record.proving_error;
  record.mode='All moves played offchain; native proofs settle consecutive cooperative checkpoints';
  record.batches??=[];await save();
  while(prefix.env.seq<whole.env.seq){
    const current=await c.getChannel(node,state.channel,record.game_id,await freshBlock());
    while(prefix.env.seq<current.anchor.seq)prefix.receive(whole.steps[prefix.env.seq]);
    assert.equal(prefix.stateHash(),current.anchor.hash,'Checkpoint is on another transcript branch');
    if(current.status===4)break;
    assert.equal(current.status,1,'Expected an active cooperative channel');
    const part=p.goSession(whole.terms,{start:prefix.env,witness:prefix.witness()});
    const end=Math.min(current.anchor.seq+chunk,whole.env.seq);
    while(prefix.env.seq<end){const signed=whole.steps[prefix.env.seq];part.receive(signed);prefix.receive(signed);}
    console.log(`${name}: proving steps ${current.anchor.seq+1}–${end}`);
    const proved=await c.proveSession({rpcUrl:RPC,proverUrl:PROVER,session:part,epoch:current.epoch,expectedClassHash:classHash});
    const row={from:current.anchor.seq+1,to:end,epoch:current.epoch,proof_wall_seconds:proved.wall_seconds,proof_facts:proved.response.proof_facts,
      base_block:proved.block.block_number,proof_base64_sha256:createHash('sha256').update(proved.response.proof).digest('hex')};
    await writeFile(resolve(raw,`${name}-checkpoint-${end}.json`),p.json(proved.response));
    const call=proved.call(keys.map(k=>part.checkpointSignature(current.epoch,k)));
    const settled=await execute(`${name}_checkpoint_${end}`,call,proved.options);
    const accepted=await c.getChannel(node,state.channel,record.game_id,await freshBlock());
    assert.equal(accepted.anchor.hash,part.stateHash());assert.equal(accepted.epoch,current.epoch+1);
    const transaction=await c.rpc(RPC,'starknet_getTransactionByHash',{transaction_hash:settled.transaction_hash,response_flags:['INCLUDE_PROOF_FACTS']});
    assert.deepEqual(transaction.proof_facts.map(BigInt),proved.response.proof_facts.map(BigInt));
    row.settlement=settled;record.batches.push(row);await save();
    console.log(`${name}: checkpoint ${end} verified and committed`);
  }
  const final=await c.getChannel(node,state.channel,record.game_id,await freshBlock());
  assert.equal(final.status,4);assert.equal(final.anchor.hash,whole.stateHash());
  const last=record.batches.at(-1).settlement;
  const independent=await c.rpc('https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10','starknet_getTransactionReceipt',{transaction_hash:last.transaction_hash});
  assert.equal(independent.execution_status,'SUCCEEDED');
  record.result=fixture.result;record.steps=whole.steps.length;record.independently_confirmed=true;
  record.completed_at=new Date().toISOString();record.balance_after=p.hex(await balance());await save();
  console.log(`${name}: all ${whole.steps.length} signed steps and ${record.result} settled in ${record.batches.length} native proofs`);
  return;
}
for(const name of process.argv.slice(3).length?process.argv.slice(3):['cgos_9_1682833']){
  const fixture=JSON.parse(await readFile(resolve(root,`offchain/fixtures/${name}.json`),'utf8'));
  const record=state.records[name]??={};await save();
  if(record.completed_at){console.log(`${name}: already settled`);continue;}
  const created=await execute(`${name}_create`,c.createChannelCall({channel:state.channel,size:fixture.terms.config.size,komi_half:fixture.terms.config.komi_half,
    invited_white:state.white,session_key:p.publicKey(keys[0]),prover:state.prover}));
  if(!record.game_id){
    const trace=await c.rpc(RPC,'starknet_traceTransaction',{transaction_hash:created.transaction_hash});
    record.game_id=trace.execute_invocation.calls.find(x=>BigInt(x.contract_address)===BigInt(state.channel)).result[0];await save();
  }
  await execute(`${name}_join`,c.channelCall(state.white,'join',[state.channel,record.game_id,p.publicKey(keys[1])]));
  const snapshot=await c.getSnapshot(node,state.channel,record.game_id,await freshBlock());
  const session=p.goSession(snapshot.terms);
  assert.equal(p.stateHash(p.go,session.start),snapshot.anchor_hash,'Unexpected opening anchor');
  for(const {step} of fixture.steps)replay(session,step);
  await writeFile(resolve(raw,`${name}-session.json`),p.json(session.export()));
  console.log(`${name}: requesting native proof for ${session.steps.length} signed steps`);
  let proved;
  try{proved=await c.proveSession({rpcUrl:RPC,proverUrl:PROVER,session,epoch:snapshot.epoch,expectedClassHash:classHash});}
  catch(e){record.proving_error={message:e.message,rpc:e.rpcError};await save();throw e;}
  await writeFile(resolve(raw,`${name}-proof.json`),p.json(proved.response));
  delete record.proving_error;
  record.proof={prover_url:PROVER,prover_version:await c.rpc(PROVER,'starknet_specVersion'),wall_seconds:proved.wall_seconds,base_block:proved.block.block_number,base64_characters:proved.response.proof.length,
    compressed_bytes:Buffer.from(proved.response.proof,'base64').length,
    proof_base64_sha256:createHash('sha256').update(proved.response.proof).digest('hex'),facts:proved.response.proof_facts};await save();
  const acks=keys.map(k=>session.checkpointSignature(snapshot.epoch,k));
  const call=proved.call(acks);
  const changed=structuredClone(session.env);changed.game.black_half+=1;
  const changedScore=c.settlementCall(state.prover,state.channel,record.game_id,snapshot.epoch,changed,acks);
  const hasReason=(e,reason)=>{
    const text=p.json(e.baseError??e.rpcError??{message:e.message});
    return text.includes(reason)||text.toLowerCase().includes(`0x${Buffer.from(reason).toString('hex')}`);
  };
  await assert.rejects(account.estimateInvokeFee(changedScore,{tip:0n,...proved.options}),e=>hasReason(e,'Wrong proved transition'));
  await assert.rejects(account.estimateInvokeFee(call,{tip:0n}),e=>hasReason(e,'Missing proof facts'));
  record.changed_score_rejected=true;record.missing_proof_rejected=true;await save();
  const settled=await execute(`${name}_settle`,call,proved.options);
  const current=await c.getChannel(node,state.channel,record.game_id,await freshBlock());
  assert.equal(current.status,4);assert.equal(current.anchor.hash,session.stateHash());
  const transaction=await c.rpc(RPC,'starknet_getTransactionByHash',{transaction_hash:settled.transaction_hash,response_flags:['INCLUDE_PROOF_FACTS']});
  assert.deepEqual(transaction.proof_facts.map(BigInt),proved.response.proof_facts.map(BigInt));
  const independent=await c.rpc('https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10','starknet_getTransactionReceipt',{transaction_hash:settled.transaction_hash});
  assert.equal(independent.execution_status,'SUCCEEDED');
  record.result=fixture.result;record.steps=session.steps.length;record.settlement=settled;record.independently_confirmed=true;
  record.completed_at=new Date().toISOString();record.balance_after=p.hex(await balance());await save();
  console.log(`${name}: native proof accepted and Dojo result settled (${fixture.result})`);
}
}
main().catch(e=>{console.error(p.json(e.baseError??e.rpcError??e.actual?.baseError??{message:e.message}).slice(0,3000));process.exitCode=1;});
