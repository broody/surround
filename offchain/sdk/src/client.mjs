import { RpcProvider, shortString } from 'starknet';
import { encodeAction, encodeSignedAction, encodeState,
  normalizeState, normalizeTerms, contextHash, stateHash, poseidon, hex, ZERO_SIGNATURE, replay } from './index.mjs';

const tag = text => BigInt(shortString.encodeShortString(text));
const same = (a,b) => a.map(BigInt).join() === b.map(BigInt).join();
const requireThat = (ok,message) => { if (!ok) throw Error(message); };
const combine = a => BigInt(a[0]) + (BigInt(a[1]) << 128n) + (BigInt(a[2]) << 256n);
export const NATIVE_CONFIRMATIONS = 10;
export function nativeProofBlock(head,anchorBlock) {
  requireThat(Number.isSafeInteger(head)&&head>=0&&Number.isSafeInteger(anchorBlock)&&anchorBlock>=0,'Invalid block number');
  return head-NATIVE_CONFIRMATIONS>=anchorBlock ? head-NATIVE_CONFIRMATIONS : null;
}
export function decodeState(values) {
  requireThat(values.length === 27,'Invalid state encoding');
  const n=values.map(BigInt), z=i=>Number(n[i]);
  const state=normalizeState({ sequence:z(0),move_number:z(1),board:{black:combine(n.slice(2,5)),white:combine(n.slice(5,8))},
    history_root:n[8],transcript_hash:n[9],next_player:z(10),phase:z(11),consecutive_passes:z(12),scoring_round:z(13),
    resume_player:z(14),proposed:n[15]===1n,dead:combine(n.slice(16,19)),black_captures:z(19),white_captures:z(20),
    winner:z(21),finish_reason:z(22),black_half:z(23),white_half:z(24),support_turn:z(25),last_actor:z(26) });
  requireThat(same(encodeState(state),n),'Noncanonical state encoding');
  return state;
}
export function decodeSnapshot(values) {
  requireThat(values.length === 40,'Invalid snapshot encoding');
  const keys=['chain_id','channel','game_id','black','white','black_key','white_key','prover','size','komi_half','response_seconds'];
  const terms=normalizeTerms(Object.fromEntries(keys.map((k,i)=>[k,values[i]])));
  return {terms,epoch:Number(BigInt(values[11])),state:decodeState(values.slice(12,39)),anchor_block:Number(BigInt(values[39]))};
}
export function decodeChannel(values) {
  requireThat(values.length === 68,'Invalid channel encoding');
  const n=values.map(BigInt);
  return { id:n[0],black:n[1],white:n[2],black_key:n[3],white_key:n[4],prover:n[5],size:Number(n[6]),komi_half:Number(n[7]),
    response_seconds:Number(n[8]),status:Number(n[9]),epoch:Number(n[10]),context:n[11],anchor_block:Number(n[12]),deadline:Number(n[13]),
    anchor:decodeState(n.slice(14,41)),candidate:decodeState(n.slice(41,68)) };
}
export const channelCall = (channel,entrypoint,calldata=[]) => ({contractAddress:hex(channel),entrypoint,calldata:calldata.map(hex)});
export const createChannelCall = ({channel,size,komi_half,invited_white=0n,session_key,prover,response_seconds=3600}) =>
  channelCall(channel,'create_channel',[size,komi_half,invited_white,session_key,prover,response_seconds]);
export const joinChannelCall = (channel,id,sessionKey) => channelCall(channel,'join_channel',[id,sessionKey]);
export const disputeCall = (channel,id,epoch) => channelCall(channel,'open_dispute',[id,epoch]);
export const resolveCall = (channel,id,epoch) => channelCall(channel,'resolve_dispute',[id,epoch]);
export const timeoutCall = (channel,id,epoch) => channelCall(channel,'claim_timeout',[id,epoch]);
export const resignCall = (channel,id) => channelCall(channel,'resign_channel',[id]);
export const forceActionCall = (channel,id,epoch,history,action) => channelCall(channel,'force_action',[id,epoch,history.length,...history,...encodeAction(action)]);
export const resumeCall = (channel,id,epoch,blackAck,whiteAck) => channelCall(channel,'resume_channel',[id,epoch,blackAck.r,blackAck.s,whiteAck.r,whiteAck.s]);
export const directHistoryCall = (channel,id,epoch,history,actions,blackAck=ZERO_SIGNATURE,whiteAck=ZERO_SIGNATURE) =>
  channelCall(channel,'submit_history',[id,epoch,history.length,...history,actions.length,...actions.flatMap(encodeSignedAction),blackAck.r,blackAck.s,whiteAck.r,whiteAck.s]);
export const settlementCall = (prover,channel,id,epoch,end,blackAck=ZERO_SIGNATURE,whiteAck=ZERO_SIGNATURE) =>
  channelCall(prover,'settle',[channel,id,epoch,...encodeState(end),blackAck.r,blackAck.s,whiteAck.r,whiteAck.s]);

export async function rpc(url,method,params={},timeout=30000) {
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw Object.assign(Error(`${method}: HTTP ${response.status}: ${(await response.text()).slice(0,240)}`),{httpStatus:response.status});
  const body=await response.json();
  if(body.error)throw Object.assign(Error(`${method}: ${body.error.message}`),{rpcError:body.error});
  return body.result;
}

export async function getSnapshot(provider,channel,id,block='latest') {
  const result=decodeSnapshot(await provider.callContract(channelCall(channel,'get_snapshot',[id]),block));
  requireThat(result.terms.channel === BigInt(channel) && result.terms.game_id === BigInt(id),'Snapshot identifies another game');
  requireThat(result.terms.chain_id === BigInt(await provider.getChainId()),'Snapshot identifies another chain');
  return result;
}

export function proofPayload(classHash,terms,epoch,start,end) {
  return [BigInt(classHash),tag('SURROUND_PROVED_GAME_V1'),BigInt(terms.chain_id),BigInt(terms.prover),BigInt(terms.channel),BigInt(terms.game_id),
    contextHash(terms),BigInt(epoch),stateHash(start),stateHash(end)];
}

// PROOF1 is the small (log20) path, PROOF2 the large path; the adapter accepts both
// and pins the virtual OS program (`osProgram`, read from the adapter).
export const PROOF_VERSIONS=['PROOF1','PROOF2'];
// Virtual OS program attested in Starknet v0.14.4 proof facts (Sepolia, 2026-09).
// Pinned per adapter instance at deployment; a network OS upgrade needs a new instance.
export const VIRTUAL_OS_PROGRAM='0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1';
export function validateNativeProof(response,{classHash,terms,epoch,start,end,block,osProgram}) {
  requireThat(typeof response.proof === 'string' && response.proof.length>0,'Missing native proof');
  const payload=proofPayload(classHash,terms,epoch,start,end),messages=response.l2_to_l1_messages;
  requireThat(Array.isArray(messages) && messages.length===1,'Unexpected proof messages');
  requireThat(BigInt(messages[0].from_address)===BigInt(terms.prover) && BigInt(messages[0].to_address)===0n
    && same(messages[0].payload,payload),'Prover returned another transition');
  const f=response.proof_facts?.map(BigInt);
  requireThat(osProgram!==undefined,'Supply the adapter\'s pinned OS program');
  requireThat(f?.length===9 && PROOF_VERSIONS.map(tag).includes(f[0]) && f[1]===tag('VIRTUAL_SNOS')
    && f[2]===BigInt(osProgram) && f[3]===tag('VIRTUAL_SNOS0')
    && f[4]===BigInt(block.block_number) && f[5]===BigInt(block.block_hash) && f[7]===1n
    && f[8]===poseidon([terms.prover,0,payload.length,...payload]),'Proof facts do not match the block and transition');
  // These checks prevent mismatched service responses; Starknet must still verify
  // the cryptography when this proof is submitted. A response alone is not finality.
  return {proof:response.proof,proofFacts:response.proof_facts};
}

// The virtual INVOKE_V3 that ChannelProver executes to emit the proved transition.
// It is never broadcast; a prover runs it against a base block and proves it.
export function provingTransaction({session,epoch,nonce,l2GasLimit=10_000_000_000}) {
  const zero={max_amount:'0x1',max_price_per_unit:'0x0'};
  return {type:'INVOKE',version:'0x3',sender_address:hex(session.terms.prover),
    calldata:[session.terms.channel,session.terms.game_id,epoch,session.initialHistory.length,...session.initialHistory,
      session.actions.length,...session.actions.flatMap(encodeSignedAction)].map(hex),signature:[],nonce:hex(nonce),
    resource_bounds:{l1_gas:zero,l1_data_gas:zero,l2_gas:{max_amount:hex(l2GasLimit),max_price_per_unit:'0x0'}},
    tip:'0x0',paymaster_data:[],account_deployment_data:[],nonce_data_availability_mode:'L1',fee_data_availability_mode:'L1'};
}

export async function proveSession({rpcUrl,proverUrl,session,epoch,blockNumber,expectedClassHash,l2GasLimit=10_000_000_000}) {
  requireThat(expectedClassHash !== undefined,'Supply the pinned prover class hash');
  const provider=new RpcProvider({nodeUrl:rpcUrl});
  // Native verification accepts bases at least ten blocks behind the head.
  // Wait for a fresh create/join/checkpoint to enter that range before proving.
  const anchor=await getSnapshot(provider,session.terms.channel,session.terms.game_id);
  let eligible=null;
  for(let attempt=0;attempt<80;attempt++){
    eligible=nativeProofBlock(await provider.getBlockNumber(),anchor.anchor_block);
    if(eligible!==null)break;
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  requireThat(eligible!==null,'Channel anchor is not yet ten blocks deep; retry proving later');
  requireThat(blockNumber===undefined || (Number.isSafeInteger(blockNumber)&&blockNumber>=anchor.anchor_block&&blockNumber<=eligible),
    'Proof base must follow the anchor and be at least ten blocks deep');
  const block=await provider.getBlockWithTxHashes(blockNumber ?? eligible);
  const current=await getSnapshot(provider,session.terms.channel,session.terms.game_id,block.block_hash);
  requireThat(current.epoch===epoch,'Stale proving epoch');
  requireThat(contextHash(current.terms)===contextHash(session.terms) && stateHash(current.state)===stateHash(session.start),'Session does not start at the chain anchor');
  requireThat(block.block_number>=current.anchor_block,'Proof base predates anchor');
  const classHash=await provider.getClassHashAt(hex(session.terms.prover),block.block_hash);
  requireThat(BigInt(classHash)===BigInt(expectedClassHash),'Unexpected prover class');
  const computed=replay(session.terms,session.start,session.initialHistory,session.actions).state;
  requireThat(stateHash(computed)===stateHash(session.state),'Session output mismatch');
  const transaction=provingTransaction({session,epoch,l2GasLimit,
    nonce:await provider.getNonceForAddress(hex(session.terms.prover),block.block_hash)});
  const started=Date.now();
  const response=await rpc(proverUrl,'starknet_proveTransaction',{block_id:{block_hash:block.block_hash},transaction},600000);
  const osProgram=BigInt((await provider.callContract(channelCall(session.terms.prover,'os_program'),block.block_hash))[0]);
  const options=validateNativeProof(response,{classHash,terms:session.terms,epoch,start:session.start,end:computed,block,osProgram});
  return {response,options,block,wall_seconds:(Date.now()-started)/1000,
    call:(blackAck,whiteAck)=>settlementCall(session.terms.prover,session.terms.channel,session.terms.game_id,epoch,computed,blackAck,whiteAck)};
}
