// Reproducible, fee-capped Sepolia validation of Surround on arbiter. Each
// game's session keys (seat 0 black, seat 1 white) are public, derived from its
// record's label: fresh for every game, since with the wallets they make its id.
// The funded wallet key stays in process memory and child environment only.
// A game reaches the chain only when it first needs it: both seats' wallets
// sign its terms offchain (black is the funded account, white a test player
// that checks a per-world test key), and the transaction that settles it
// opens it too. Ranked (timed) games are refereed by the keeper at
// SURROUND_KEEPER_URL: each seat signs its step, the keeper stamps it, and
// both seats pull it back. A ranked game that isn't rated mints no kifu. Rated
// games start from a matchmaker-signed ticket whose digest both wallets sign,
// are refereed in process with a test key, and open, settle by onchain replay
// and are rated through SurroundRatings in one transaction; then their kifu is
// minted to the winner.
import { readFile,writeFile,mkdir,stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Account,RpcProvider,hash,ec,stark } from './sdk/node_modules/starknet/dist/index.mjs';
import * as p from './sdk/src/index.mjs';
import * as c from './sdk/src/client.mjs';
import * as rating from './sdk/src/rating.mjs';
// Re-sign a fixture step with the game's public session key `keys` of its seat.
// Steps carry no seat: the due seat plays, except a resignation.
const replay=(session,step,keys)=>{
  if(step.kind===p.MOVE_RESIGN)return session.move(p.resignStep(step.seat),keys[step.seat]);
  const {kind,point,dead}=step.action;
  session.move(p.goStep(kind,point,dead),keys[session.due()]);
};
// A game's public session private keys, from its record's label.
// The lobby's AI anchors (shared/lobby.ts): each pinned at its rank's μ.
const ANCHORS=[{id:'aiko',rank:'20k',index:10},{id:'malik',rank:'10k',index:20},{id:'priya',rank:'5k',index:25},
  {id:'koji',rank:'1d',index:30},{id:'ryo',rank:'9d',index:38}];
const FELT_PRIME=(1n<<251n)+17n*(1n<<192n)+1n;
const i64=x=>(x<0n?FELT_PRIME+x:x);
const keysFor=label=>[0,1].map(seat=>
  BigInt(`0x${createHash('sha256').update(`surround-sepolia:${label}:${seat}`).digest('hex')}`)%(ec.starkCurve.CURVE.n-1n)+1n);
async function main(){
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Publicnode accepts the prover's current proof facts but refuses large class
// declarations; Cartridge's RPC declares them but rejects current proof facts.
// Deploy with SURROUND_SEPOLIA_RPC set to Cartridge's; prove with the default.
const RPC=process.env.SURROUND_SEPOLIA_RPC??'https://starknet-sepolia-rpc.publicnode.com';
const PROVER=process.env.SURROUND_SEPOLIA_PROVER??'https://transaction-prover.alpha-sepolia.sw-dev.io';
const STRK='0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const KEEPER=process.env.SURROUND_KEEPER_URL;
const CHAIN=0x534e5f5345504f4c4941n;
// The pre-referee deployment's record stays in results/sepolia.json, the
// referee protocol v1 and v2 records in results/sepolia-referee{,-v2}.json, the
// first v3 deployment (referee f407755) in sepolia-referee-v3-f407755.json and
// the v3 deployment before Kifu in sepolia-referee-v3.json, the Kifu
// deployment before ratings in sepolia-kifu.json, the first ratings
// deployment (referee v3, SurroundRatings v1) in sepolia-ratings.json, and the
// referee v4 deployment (SurroundRatings v2) in sepolia-ratings-v2.json, the
// referee v5 deployment in sepolia-v5.json, and the arbiter v6 deployment
// before AI anchors in sepolia-arbiter-v6.json.
const resultFile=resolve(root,'offchain/results/sepolia-arbiter-v7.json');
const previousFile=resolve(root,'offchain/results/sepolia-arbiter-v6.json');
const raw=resolve(root,'offchain/results/raw/sepolia-arbiter-v7');
const node=new RpcProvider({nodeUrl:RPC,resourceBoundsOverhead:Object.fromEntries(
  ['l1_gas','l1_data_gas','l2_gas'].map(k=>[k,{max_amount:15,max_price_per_unit:15}]))});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
// The channel class (1.44 MB) estimates at up to about 89 test STRK to declare,
// the Kifu class (1.69 MB) at more.
// A new world's migration declares a dozen classes; the ratings world's channel
// declaration alone cost 74 test STRK.
const cap=40n*10n**18n, declarationCap=150n*10n**18n, migrationCap=250n*10n**18n;
// Each game's session keys, by game id (see keysFor).
const sessionKeys=new Map();
const keysOf=session=>sessionKeys.get(p.hex(session.terms.game_id));
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
state??={network:'SN_SEPOLIA',protocol:'arbiter v6 (efcd918), SurroundRatings v3 (AI anchors)',signer:SIGNER,rpc_url:RPC,prover_url:PROVER,class_hash:classHash,created_at:new Date().toISOString(),transactions:{},records:{},
  test_players:'Both test seats controlled by the harness; public per-game session keys (derived from each record label) carry no real assets.'};
assert.equal(BigInt(state.class_hash),BigInt(classHash),'Preserve the previous deployment if the protocol changes');
// The immutable adapter settles any channel that allowlists its class: reuse
// the previous one when its class is unchanged (redeploying it with the same
// salt would collide). The white test player signs terms with a per-world key
// since arbiter v6, so each world deploys its own.
if(!state.prover){
  try{
    const previous=JSON.parse(await readFile(previousFile,'utf8'));
    if(previous.prover&&BigInt(previous.class_hash)===BigInt(classHash)){
      state.prover=previous.prover;state.transactions.deploy_prover=previous.transactions.deploy_prover;
    }
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
assert(['deploy','run','ranked','batch','rated'].includes(command),'Use preflight, deploy, run, ranked, batch or rated');

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
// Per-deployment test keys for the matchmaker, the referee, the white test
// player's wallet, the lobby keeper's referee and each AI anchor's wallet,
// kept out of git (results/raw): anyone holding them could sign tickets,
// stamps, white's terms or an anchor's for this test world.
const KEY_NAMES=['matchmaker','referee','white','keeper',...ANCHORS.map(a=>`anchor_${a.id}`)];
async function testKeys(){
  const file=resolve(raw,'keys.json');
  let k={};
  try{k=Object.fromEntries(Object.entries(JSON.parse(await readFile(file,'utf8'))).map(([n,v])=>[n,BigInt(v)]));}
  catch(e){if(e.code!=='ENOENT')throw e;}
  if(KEY_NAMES.every(n=>k[n]!=null))return k;
  const fresh=()=>BigInt(`0x${Buffer.from(ec.starkCurve.utils.randomPrivateKey()).toString('hex')}`);
  for(const n of KEY_NAMES)k[n]??=fresh();
  await writeFile(file,JSON.stringify(Object.fromEntries(Object.entries(k).map(([n,v])=>[n,p.hex(v)]))),{mode:0o600});
  return k;
}
// An account like the signer's (its class: Argent's, whose constructor takes a
// Starknet owner and no guardian), owned by `key`, deployed through the UDC.
// Anchors only sign, so they hold no fees.
async function deployAccount(label,key){
  const id=`deploy_${label}`;
  if(!state[label]){
    const payload={classHash:await node.getClassHashAt(SIGNER),salt:'0x537572726f756e64',constructorCalldata:[0,p.publicKey(key),1]};
    const estimate=await account.estimateDeployFee(payload,{tip:0n,blockIdentifier:await freshBlock(),skipValidate:false});
    const tx=await account.deploy(payload,{tip:0n,resourceBounds:bounds(estimate)});
    state[label]=tx.contract_address[0];state.transactions[id]={transaction_hash:tx.transaction_hash};await save();
  }
  if(!state.transactions[id].block_number){state.transactions[id]=await receipt(state.transactions[id].transaction_hash);await save();}
  console.log(`${label}: ${state[label]}`);
}
// Both seats agree to a game: the funded account signs its terms as black
// (SNIP-12, checked by the account), and the harness signs them as white with
// the test player's key, which that account checks. Returns both signatures.
async function agree(terms,k){
  const black=stark.formatSignature(await account.signMessage(c.goTermsTypedData(terms))).map(BigInt);
  const white=p.sign(c.goTermsMessageHash(terms,state.white),k.white);
  return [black,[white.r,white.s]];
}
// The terms of game `label` for `fixture`, timed by `clock` if given; its id
// (the seats', from the wallets and the label's session keys) goes in `record`.
async function termsFor(label,fixture,record,clock=null){
  const keys=keysFor(label);
  const terms=p.goTerms({chain_id:CHAIN,channel:state.channel,prover:state.prover,response_seconds:3600,clock,
    players:[SIGNER,state.white],keys:keys.map(p.publicKey),size:fixture.terms.config.size,komi_half:fixture.terms.config.komi_half});
  sessionKeys.set(p.hex(terms.game_id),keys);
  if(record.game_id!==p.hex(terms.game_id)){record.game_id=p.hex(terms.game_id);await save();}
  return terms;
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
  // Both classes exceed a migration transaction's cap: declare them first.
  await declare('channel','target/sepolia','surround_channel');
  await declare('kifu','target/sepolia','surround_kifu');
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
  state.channel=manifest.contracts.find(c=>c.tag==='surround-channel').address;state.world=manifest.world.address;
  state.kifu=manifest.contracts.find(c=>c.tag==='surround-kifu').address;await save();
  for(const [label,r] of Object.entries(state.transactions))if(label.startsWith('migration_')&&!r.block_hash){state.transactions[label]=await receipt(r.transaction_hash);await save();}
  }
  const channelArtifact=JSON.parse(await readFile(resolve(root,'target/sepolia/surround_channel.contract_class.json'),'utf8'));
  assert.equal(BigInt(await node.getClassHashAt(state.channel,await freshBlock())),BigInt(hash.computeContractClassHash(channelArtifact)),
    'Existing channel class differs; preserve it and deploy a new protocol version');
  await deploy('prover','offchain/cairo/target/dev','surround_offchain_ChannelProver',[c.VIRTUAL_OS_PROGRAM]);
  // The migrating account owns the namespace and allowlists the adapter class.
  await execute('allow_prover',c.allowProverCall(state.channel,classHash));
  await deploy('white','offchain/testing/target/dev','surround_test_player_TestPlayer',[p.publicKey((await testKeys()).white)]);
  // SurroundRatings, owned by the signer, accepting this channel, the test
  // matchmaker key and two referee keys (the harness's and the lobby keeper's),
  // for rated games on every board. New players start at 23k, 17k or 6k (the
  // default start bands). The five AI anchors are pinned at their ranks. The
  // owner seals the policy only with SURROUND_SEAL=1: until then anchors can
  // be re-pinned at once while they are calibrated.
  await deploy('ratings','target/sepolia','surround_SurroundRatings',[SIGNER]);
  const k=await testKeys();
  for(const a of ANCHORS)await deployAccount(`anchor_${a.id}`,k[`anchor_${a.id}`]);
  // A preset is the settings alone: a time control without its referee and randomness tip.
  const R=state.ratings, settings=p.encodeTimeControl(p.go,p.rankedClock(p.publicKey(k.referee))).slice(1,-1);
  const seal=process.env.SURROUND_SEAL==='1';
  await execute('ratings_policy',[
    c.channelCall(R,'set_channel',[state.channel,1]),
    c.channelCall(R,'set_matchmaker',[p.publicKey(k.matchmaker)]),
    c.channelCall(R,'set_referee',[p.publicKey(k.referee)]),
    c.channelCall(R,'set_referee',[p.publicKey(k.keeper)]),
    c.channelCall(R,'set_clock_preset',[...settings,1]),
    c.channelCall(R,'set_prover',[state.prover,1]),
    ...[[9,14],[13,15],[19,15]].map(([size,komi])=>c.channelCall(R,'set_board',[size,komi,1])),
    c.channelCall(R,'set_response_window',[300,3600]),
    ...ANCHORS.map(a=>c.channelCall(R,'set_anchor',[state[`anchor_${a.id}`],i64(rating.MU_T[a.index])])),
    ...(seal?[c.channelCall(R,'seal')]:[]),
  ]);
  const block=await freshBlock();
  assert.equal(BigInt((await node.callContract(c.channelCall(R,'sealed'),block))[0]),seal?1n:0n,'SurroundRatings seal state');
  for(const a of ANCHORS)assert.equal(await c.getAnchor(node,R,state[`anchor_${a.id}`],block),rating.MU_T[a.index],`${a.id} not pinned`);
  state.anchors=Object.fromEntries(ANCHORS.map(a=>[a.id,{address:state[`anchor_${a.id}`],rank:a.rank,mu_q32:String(rating.MU_T[a.index])}]));
  state.sealed=seal;await save();
  // A world's ratings contract is set once.
  await execute('set_ratings',c.channelCall(state.channel,'set_ratings',[R]));
  state.balance_after_deploy=p.hex(await balance());await save();
  console.log('Dojo channel, SurroundRatings and immutable native adapter deployed on Sepolia');
  process.exit(0);
}
assert(state.channel && state.prover && state.white && state.kifu,'Deploy first');
if(command==='rated'){
  assert(state.ratings,'Deploy SurroundRatings first');
  const k=await testKeys();
  const referee=p.publicKey(k.referee), matchmaker=p.publicKey(k.matchmaker);
  for(const name of process.argv.slice(3).length?process.argv.slice(3):['cgos_9_1682833','cgos_9_1682827']){
    const fixture=JSON.parse(await readFile(resolve(root,`offchain/fixtures/${name}.json`),'utf8'));
    const label=`${name}_rated`;
    const record=state.records[label]??={};
    if(record.completed_at){console.log(`${label}: already rated`);continue;}
    if(!record.ticket_times){
      const now=BigInt((await node.getBlockWithTxHashes('latest')).timestamp);
      record.ticket_times={issued_at:p.hex(now-30n),expires_at:p.hex(now+840n),nonce:p.hex(BigInt(Date.now()))};await save();
    }
    const ticket={chain_id:CHAIN,channel:BigInt(state.channel),black:BigInt(SIGNER),white:BigInt(state.white),
      size:fixture.terms.config.size,komi_half:fixture.terms.config.komi_half,clock:p.rankedClock(referee),prover:BigInt(state.prover),
      response_seconds:3600,source:c.QUEUE,black_band:2,white_band:1,matchmaker,
      issued_at:BigInt(record.ticket_times.issued_at),expires_at:BigInt(record.ticket_times.expires_at),nonce:BigInt(record.ticket_times.nonce)};
    const digest=c.ticketDigest(ticket);
    record.ticket_digest=p.hex(digest);
    // The game's start, chosen once so a run that stops resumes the same game.
    if(!record.started_ms){
      record.started_ms=Number(BigInt((await node.getBlockWithTxHashes('latest')).timestamp))*1000;await save();
    }
    // Both wallets sign the ticket's terms, its digest in the config; the id is the seats'.
    const keys=keysFor(label);
    const terms=c.ratedTerms(ticket,keys.map(p.publicKey));
    record.game_id=p.hex(terms.game_id);await save();
    const signatures=await agree(terms,k);
    // Both seats sign; a Referee with the test key stamps each step a second
    // apart from now, which is when the game starts for rating.
    const session=p.goSession(terms), judge=new p.Referee(session,k.referee,{now:record.started_ms});
    let t=record.started_ms;
    for(const {step} of fixture.steps){
      const seat=step.kind===p.MOVE_RESIGN?Number(step.seat):session.due();
      const move=step.kind===p.MOVE_RESIGN?p.resignStep(seat):p.goStep(step.action.kind,step.action.point,step.action.dead);
      judge.stamp(session.sign(move,keys[seat]),t+=1000);
    }
    const ratingsAt=async()=>{const block=await freshBlock();return Promise.all([SIGNER,state.white].map(x=>c.getPlayerRating(node,state.ratings,x,block)));};
    // Saved before settling, so a run that stops after rating resumes from the
    // states the update started from.
    if(!record.before){
      record.before=(await ratingsAt()).map(r=>({mu:String(r.mu),phi:String(r.phi),last_played:String(r.last_played),games:r.games}));await save();
    }
    const before=record.before.map(r=>({mu:BigInt(r.mu),phi:BigInt(r.phi),last_played:BigInt(r.last_played),games:r.games}));
    // Rated with its ticket; the fixtures are long enough (20 steps or more) to rate.
    assert(session.steps.length>=20,'Too short to rate');
    // One transaction: the game opens with its ticket, settles by replay with
    // both approvals, and is rated.
    const acks=keys.map(key=>session.checkpointSignature(0,key));
    await execute(`${label}_open_settle_rate`,[
      c.openRatedGameCall(terms,signatures,ticket,c.signTicket(ticket,k.matchmaker)),
      c.directHistoryCall(state.channel,record.game_id,0,session.start,session.startWitness,session.steps,acks),
      c.rateCall(state.channel,record.game_id,ticket),
    ]);
    const settled=await c.getChannel(node,state.channel,record.game_id,await freshBlock());
    assert.equal(settled.status,4,'Expected a settled game');
    // The game's time for rating: its first stamp, kept by the channel in seconds.
    const playedAt=BigInt(settled.started);
    assert.equal(playedAt,BigInt(Math.floor((record.started_ms+1000)/1000)),'The channel keeps another start');
    const status=await node.callContract(c.channelCall(state.ratings,'ticket_status',[record.ticket_digest]),await freshBlock());
    assert.equal(Number(BigInt(status[0])),2,'Ticket not rated');
    const after=await ratingsAt();
    // The onchain ratings equal the SDK's integer update from the states before.
    const start=(r,band)=>r.games?{mu:r.mu,phi:r.phi,last:r.last_played}:rating.start(band);
    const result=settled.result.winner===1?2:settled.result.winner===2?0:1;
    const expected=rating.update(start(before[0],2),start(before[1],1),result,playedAt);
    for(const [got,want] of [[after[0],expected.black],[after[1],expected.white]]){
      assert.equal(got.mu,want.mu,'Onchain rating differs from the SDK');assert.equal(got.phi,want.phi);
    }
    await execute(`${label}_sync`,c.syncCall(state.channel,SIGNER));
    await mintKifu(label,record,session,fixture.result.startsWith('B')?SIGNER:state.white);
    record.result=fixture.result;record.steps=session.steps.length;record.played_at=Number(playedAt);
    record.ratings=after.map((r,i)=>({player:i?state.white:SIGNER,mu_q32:String(r.mu),phi_q32:String(r.phi),rank:rating.rankLabel(r.rank_tenths),
      rank_tenths:r.rank_tenths,provisional:r.provisional,games:r.games,wins:r.wins,losses:r.losses}));
    record.matches_sdk=true;record.completed_at=new Date().toISOString();record.balance_after=p.hex(await balance());await save();
    console.log(`${label}: settled (${fixture.result}) and rated; ${record.ratings.map(r=>`${r.rank}${r.provisional?'?':''}`).join(' vs ')}`);
  }
  return;
}
// Settle a game in chained checkpoint proofs of STEPS steps. Only to exercise
// checkpoints: every proof costs a whole settlement's fee (about 85M L2 gas),
// and `run` settles a whole 19×19 game in one. Recorded under `NAME_batch`.
if(command==='batch'){
  const fixtureName=process.argv[3], chunk=Number(process.argv[4]);
  assert(fixtureName&&Number.isInteger(chunk)&&chunk>0&&chunk<=1000,'Use batch NAME STEPS, with 1–1000 steps per checkpoint; run NAME settles in one proof');
  const name=`${fixtureName}_batch`;
  const record=state.records[name]??={};
  if(record.completed_at){console.log(`${name}: already settled`);return;}
  const fixture=JSON.parse(await readFile(resolve(root,`offchain/fixtures/${fixtureName}.json`),'utf8'));
  const terms=await termsFor(name,fixture,record), open=c.openGameCall(terms,await agree(terms,await testKeys()));
  let whole;
  try{whole=p.importSession(JSON.parse(await readFile(resolve(raw,`${name}-session.json`),'utf8')));}
  catch(e){
    if(e.code!=='ENOENT')throw e;
    whole=p.goSession(terms);
    for(const {step} of fixture.steps)replay(whole,step,keysOf(whole));
    await writeFile(resolve(raw,`${name}-session.json`),p.json(whole.export()));
  }
  const prefix=p.goSession(whole.terms,{start:whole.start,witness:whole.startWitness});
  record.full_game_prover_limit??=record.proving_error;delete record.proving_error;
  record.mode='All moves played offchain; native proofs settle consecutive cooperative checkpoints';
  record.batches??=[];await save();
  while(prefix.env.seq<whole.env.seq){
    // Until the first checkpoint opens it, the game is epoch 0 at its opening.
    const current=await openedChannel(record.game_id)??{status:1,epoch:0,anchor:{seq:0,hash:prefix.stateHash()}};
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
    const call=proved.call(keysOf(part).map(k=>part.checkpointSignature(current.epoch,k)));
    const settled=await execute(`${name}_checkpoint_${end}`,proved.opening?[open,call]:call,proved.options);
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
// A game's channel, or null before anyone opens it.
async function openedChannel(id){
  try{return await c.getChannel(node,state.channel,id,await freshBlock());}
  catch(e){if(c.reverted(e,'Unknown channel'))return null;throw e;}
}
// Play a fixture through the keeper that referees the game: each seat signs
// and marks its step (store.move), the keeper stamps it, and both seats pull.
async function playRanked(terms,fixture,signatures){
  const keeper=new c.KeeperClient(KEEPER);
  const stores=[0,1].map(()=>new c.SessionStore(c.memoryBackend()));
  const seats=await Promise.all(stores.map(store=>store.open(p.go,terms)));
  // Nothing is onchain yet: the keeper takes the game on its wallets' signatures.
  await keeper.register(seats[0],{authorizations:signatures.map(s=>s.map(p.hex))});
  for(const {step} of fixture.steps){
    const seat=step.kind===p.MOVE_RESIGN?Number(step.seat):seats[0].due();
    const move=step.kind===p.MOVE_RESIGN?p.resignStep(seat):p.goStep(step.action.kind,step.action.point,step.action.dead);
    await stores[seat].move(seats[seat],move,keysOf(seats[seat])[seat]);
    await keeper.submit(seats[seat],{store:stores[seat]});
    await keeper.pull(seats[1-seat],{store:stores[1-seat]});
  }
  assert.equal(seats[0].stateHash(),seats[1].stateHash(),'Seats disagree');
  return seats[0];
}
// Prove the whole game in one native proof, check that a changed score and a
// missing proof are rejected onchain, then open and settle it with both
// approvals in one transaction.
async function proveAndSettle(label,record,session,open){
  console.log(`${label}: requesting native proof for ${session.steps.length} signed steps${session.timed?' and their stamps':''}`);
  let proved;
  try{proved=await c.proveSession({rpcUrl:RPC,proverUrl:PROVER,session,epoch:0,expectedClassHash:classHash});}
  catch(e){record.proving_error={message:e.message,rpc:e.rpcError};await save();throw e;}
  await writeFile(resolve(raw,`${label}-proof.json`),p.json(proved.response));
  delete record.proving_error;
  record.proof={prover_url:PROVER,prover_version:await c.rpc(PROVER,'starknet_specVersion'),wall_seconds:proved.wall_seconds,base_block:proved.block.block_number,base64_characters:proved.response.proof.length,
    compressed_bytes:Buffer.from(proved.response.proof,'base64').length,
    proof_base64_sha256:createHash('sha256').update(proved.response.proof).digest('hex'),facts:proved.response.proof_facts};
  assert(proved.opening,'Expected a game nobody opened yet');
  record.calldata_felts=c.provingCalldata(session,0,{opening:true}).length;await save();
  const acks=keysOf(session).map(k=>session.checkpointSignature(0,k));
  const call=proved.call(acks);
  const changed=structuredClone(session.env);changed.game.black_half+=1;
  const changedScore=c.settlementCall(state.prover,state.channel,record.game_id,0,p.stateHash(p.go,session.start),changed,acks);
  await assert.rejects(account.estimateInvokeFee([open,changedScore],{tip:0n,...proved.options}),e=>hasReason(e,'Wrong proved transition'));
  await assert.rejects(account.estimateInvokeFee([open,call],{tip:0n}),e=>hasReason(e,'Missing proof facts'));
  record.changed_score_rejected=true;record.missing_proof_rejected=true;await save();
  const settled=await execute(`${label}_open_settle`,[open,call],proved.options);
  await confirmSettlement(record,session,settled);
}
// Whether a rejected estimate failed for `reason`.
function hasReason(e,reason){
  const text=p.json(e.baseError??e.rpcError??{message:e.message});
  return text.includes(reason)||text.toLowerCase().includes(`0x${Buffer.from(reason).toString('hex')}`);
}
// Only a rated game, created from a ticket, mints a kifu: check that a ranked
// game that isn't rated is refused.
async function kifuRefused(label,record,session){
  const call=c.mintKifuCall(state.kifu,record.game_id,session.env,c.kifuRecord(session));
  await assert.rejects(account.estimateInvokeFee(call,{tip:0n,blockIdentifier:await freshBlock()}),e=>hasReason(e,'Not a ranked game'));
  record.kifu_refused=true;await save();
  console.log(`${label}: kifu refused for an unrated game`);
}
// Check a settlement onchain and through a second node, and record it. A run
// that stopped after settling resumes here.
async function confirmSettlement(record,session,settled){
  const current=await c.getChannel(node,state.channel,record.game_id,await freshBlock());
  assert.equal(current.status,4);assert.equal(current.anchor.hash,session.stateHash());
  const transaction=await c.rpc(RPC,'starknet_getTransactionByHash',{transaction_hash:settled.transaction_hash,response_flags:['INCLUDE_PROOF_FACTS']});
  assert.deepEqual(transaction.proof_facts.map(BigInt),record.proof.facts.map(BigInt));
  const independent=await c.rpc('https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10','starknet_getTransactionReceipt',{transaction_hash:settled.transaction_hash});
  assert.equal(independent.execution_status,'SUCCEEDED');
  record.steps=session.steps.length;record.settlement=settled;record.independently_confirmed=true;
  record.completed_at=new Date().toISOString();record.balance_after=p.hex(await balance());await save();
}
// A ByteArray's Serde felts as a string.
function text(felts){
  const [count,...rest]=felts.map(BigInt);
  const word=(w,len)=>Buffer.from(w.toString(16).padStart(len*2,'0'),'hex');
  const parts=rest.slice(0,Number(count)).map(w=>word(w,31));
  parts.push(word(rest[Number(count)],Number(rest[Number(count)+1])));
  return Buffer.concat(parts).toString('utf8');
}
// Mint a settled ranked game's kifu to its winner, then read its metadata the
// way indexers do: a `starknet_call` to each public node, inside its limits.
async function mintKifu(label,record,session,winner){
  const packed=c.kifuRecord(session);
  record.kifu??={record_felts:packed.length,steps:session.steps.length};await save();
  const minted=await execute(`${label}_kifu`,c.mintKifuCall(state.kifu,record.game_id,session.env,packed));
  const block=await freshBlock();
  const [owner]=await node.callContract(c.channelCall(state.kifu,'owner_of',c.kifuTokenId(record.game_id)),block);
  assert.equal(BigInt(owner),BigInt(winner),'Kifu minted to someone other than the winner');
  const summary=await node.callContract(c.channelCall(state.kifu,'summary',c.kifuTokenId(record.game_id)),block);
  record.kifu.mint=minted;record.kifu.summary=summary;record.kifu.token_uri={};
  for(const [name,url] of [['publicnode',RPC],['cartridge','https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10']]){
    try{
      const uri=text(await new RpcProvider({nodeUrl:url}).callContract(c.channelCall(state.kifu,'token_uri',c.kifuTokenId(record.game_id))));
      record.kifu.token_uri[name]={ok:true,bytes:Buffer.byteLength(uri)};
      await writeFile(resolve(raw,`${label}-token-uri.txt`),uri);
    }catch(e){record.kifu.token_uri[name]={ok:false,error:(e.message??String(e)).slice(0,500)};}
  }
  await save();
  console.log(`${label}: kifu minted to the winner (${packed.length} felts), token_uri ${p.json(record.kifu.token_uri).replace(/\s+/g,' ')}`);
}
const ranked=command==='ranked';
let referee=null;
if(ranked){
  assert(KEEPER,'Set SURROUND_KEEPER_URL to the keeper that referees ranked games');
  referee=await c.keeperReferee(KEEPER);
  assert(referee!==null,'The keeper referees no games: start it with a referee key');
}
for(const name of process.argv.slice(3).length?process.argv.slice(3):['cgos_9_1682833']){
  const fixture=JSON.parse(await readFile(resolve(root,`offchain/fixtures/${name}.json`),'utf8'));
  const label=ranked?`${name}_ranked`:name;
  const record=state.records[label]??={};await save();
  const settled=state.transactions[`${label}_open_settle`];
  if(!record.completed_at&&settled?.block_number)
    await confirmSettlement(record,p.importSession(JSON.parse(await readFile(resolve(raw,`${label}-session.json`),'utf8'))),settled);
  if(record.completed_at){
    if(ranked&&!record.kifu_refused)
      await kifuRefused(label,record,p.importSession(JSON.parse(await readFile(resolve(raw,`${label}-session.json`),'utf8'))));
    else console.log(`${label}: already settled`);
    continue;
  }
  // Both wallets sign the terms; nothing is onchain until the settlement opens the game.
  const terms=await termsFor(label,fixture,record,ranked?p.rankedClock(referee):null);
  const signatures=await agree(terms,await testKeys());
  let session;
  try{session=p.importSession(JSON.parse(await readFile(resolve(raw,`${label}-session.json`),'utf8')));}
  catch(e){
    if(e.code!=='ENOENT')throw e;
    if(ranked){
      record.referee=p.hex(referee);record.keeper_url=KEEPER;
      session=await playRanked(terms,fixture,signatures);
    }else{
      session=p.goSession(terms);
      for(const {step} of fixture.steps)replay(session,step,keysOf(session));
    }
    await writeFile(resolve(raw,`${label}-session.json`),p.json(session.export()));
  }
  assert.equal(session.context,p.contextHash(p.go,terms),'Saved session has other terms');
  if(ranked){
    const stamps=session.steps.map(r=>r.stamp);
    record.clock={referee:p.hex(terms.clock.referee),settings:terms.clock.settings};
    record.stamps={first:stamps[0],last:stamps.at(-1),longest_gap_ms:Math.max(...stamps.slice(1).map((t,i)=>t-stamps[i]))};
    await save();
  }
  record.result=fixture.result;
  await proveAndSettle(label,record,session,c.openGameCall(terms,signatures));
  console.log(`${label}: native proof accepted and Dojo result settled (${fixture.result})`);
  if(ranked)await kifuRefused(label,record,session);
}
}
main().catch(e=>{console.error(p.json(e.baseError??e.rpcError??e.actual?.baseError??{message:e.message}).slice(0,3000));process.exitCode=1;});
