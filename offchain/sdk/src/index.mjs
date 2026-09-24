import { ec, hash, shortString } from 'starknet';

export const VERSION = 1;
export const BLACK = 1, WHITE = 2, DRAW = 3, NO_POINT = 361;
export const PLAYING = 0, SCORING = 1, FINISHED = 2;
export const PLAY = 0, PASS = 1, PROPOSE = 2, ACCEPT = 3, RESUME = 4, RESIGN = 5;
export const ZERO_SIGNATURE = Object.freeze({ r: 0n, s: 0n });
const LIMB = (1n << 128n) - 1n;
const PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const MASK250 = (1n << 250n) - 1n;
const felt = value => { const n = BigInt(value); if (n < 0n || n >= PRIME) throw Error('Invalid felt'); return n; };
const tag = value => BigInt(shortString.encodeShortString(value));
export const poseidon = values => BigInt(hash.computePoseidonHashOnElements(values.map(felt)));
export const signingHash = values => poseidon(values) & MASK250;
export const hex = value => `0x${BigInt(value).toString(16)}`;
export const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? hex(v) : v, 2) + '\n';
const requireThat = (condition, message) => { if (!condition) throw Error(message); };
const other = color => { requireThat(color === BLACK || color === WHITE, 'Invalid actor'); return 3 - color; };
export const bits = values => values.reduce((mask, point) => {
  requireThat(Number.isInteger(point) && point >= 0 && point < 384, 'Invalid point');
  return mask | 1n << BigInt(point);
}, 0n);
export const limbs = value => [BigInt(value) & LIMB, BigInt(value) >> 128n & LIMB, BigInt(value) >> 256n];
const mask = value => { const n = BigInt(value); requireThat(n >= 0n && n < 1n << 384n, 'Invalid bitset'); return n; };
const checkedInt = (value, max, name) => {
  const n = Number(value); requireThat(Number.isSafeInteger(n) && n >= 0 && n <= max, `Invalid ${name}`); return n;
};

export function normalizeTerms(t) {
  const result = Object.fromEntries(['chain_id','channel','game_id','black','white','black_key','white_key','prover'].map(k => [k, felt(t[k])]));
  result.size = checkedInt(t.size, 19, 'size');
  requireThat([9,13,19].includes(result.size), 'Unsupported board size');
  result.komi_half = checkedInt(t.komi_half, result.size ** 2 * 2, 'komi');
  result.response_seconds = checkedInt(t.response_seconds, 604800, 'response window');
  requireThat(result.response_seconds >= 300, 'Invalid response window');
  requireThat(result.black !== 0n && result.white !== 0n && result.black !== result.white, 'Invalid players');
  requireThat(result.black_key !== 0n && result.white_key !== 0n && result.black_key !== result.white_key, 'Invalid session keys');
  requireThat(result.channel !== 0n && result.prover !== 0n, 'Invalid contract address');
  return result;
}

export function encodeTerms(input) {
  const t = normalizeTerms(input);
  return ['chain_id','channel','game_id','black','white','black_key','white_key','prover','size','komi_half','response_seconds'].map(k => BigInt(t[k]));
}
export const contextHash = terms => poseidon([tag('SURROUND_CHANNEL_V1'), 1, 1, ...encodeTerms(terms)]);
export const positionHash = (board, size) => poseidon([tag('SURROUND_POSITION_V1'), size, ...limbs(board.black), ...limbs(board.white)]);
export const appendHistory = (root, position) => poseidon([tag('SURROUND_HISTORY_V1'), root, position]);

export function initialState(size) {
  requireThat([9,13,19].includes(size), 'Unsupported board size');
  const board = { black: 0n, white: 0n };
  return { sequence: 0, move_number: 0, board,
    history_root: appendHistory(0, positionHash(board, size)), transcript_hash: 0n,
    next_player: BLACK, phase: PLAYING, consecutive_passes: 0, scoring_round: 0,
    resume_player: BLACK, proposed: false, dead: 0n, black_captures: 0, white_captures: 0,
    winner: 0, finish_reason: 0, black_half: 0, white_half: 0, support_turn: 0, last_actor: 0 };
}

export function normalizeState(s) {
  const result = structuredClone(s);
  for (const k of ['sequence','move_number','scoring_round','black_captures','white_captures','support_turn']) result[k] = checkedInt(s[k], 2 ** 32 - 1, k);
  for (const k of ['next_player','phase','consecutive_passes','resume_player','winner','finish_reason','last_actor']) result[k] = checkedInt(s[k], 255, k);
  for (const k of ['black_half','white_half']) result[k] = checkedInt(s[k], 65535, k);
  requireThat(typeof s.proposed === 'boolean', 'Invalid proposal flag');
  result.board = { black: mask(s.board.black), white: mask(s.board.white) };
  result.dead = mask(s.dead);
  result.history_root = felt(s.history_root); result.transcript_hash = felt(s.transcript_hash);
  return result;
}

export function encodeState(input) {
  const s = normalizeState(input);
  return [s.sequence, s.move_number, ...limbs(s.board.black), ...limbs(s.board.white), s.history_root, s.transcript_hash,
    s.next_player, s.phase, s.consecutive_passes, s.scoring_round, s.resume_player, Number(s.proposed), ...limbs(s.dead),
    s.black_captures, s.white_captures, s.winner, s.finish_reason, s.black_half, s.white_half, s.support_turn, s.last_actor].map(BigInt);
}
export const stateHash = state => poseidon([tag('SURROUND_STATE_V1'), ...encodeState(state)]);
export function action(kind, actor, point = NO_POINT, dead = 0n) {
  return normalizeAction({ kind, actor, point, dead });
}
export function normalizeAction(a) {
  return { kind: checkedInt(a.kind, RESIGN, 'action kind'), actor: checkedInt(a.actor, WHITE, 'actor'),
    point: checkedInt(a.point, 65535, 'point'), dead: mask(a.dead) };
}
export function encodeAction(a) { a = normalizeAction(a); return [a.kind, a.actor, a.point, ...limbs(a.dead)].map(BigInt); }
export const actionHash = (terms, state, a) => signingHash([tag('SURROUND_ACTION_V1'), contextHash(terms), stateHash(state), ...encodeAction(a)]);
export const checkpointHash = (terms, epoch, state) => signingHash([tag('SURROUND_CHECKPOINT_V1'), contextHash(terms), checkedInt(epoch, 2 ** 32 - 1, 'epoch'), stateHash(state)]);
export const reopenHash = (terms, epoch, state) => signingHash([tag('SURROUND_REOPEN_V1'), contextHash(terms), checkedInt(epoch, 2 ** 32 - 1, 'epoch'), stateHash(state)]);
export const publicKey = privateKey => BigInt(ec.starkCurve.getStarkKey(privateKey));
export function sign(message, privateKey) {
  const sig = ec.starkCurve.sign(hex(message), privateKey);
  return { r: sig.r, s: sig.s };
}
export function verifySignature(message, signature, key) {
  try {
    const parsed = new ec.starkCurve.Signature(felt(signature.r), felt(signature.s));
    // Starknet keys contain only x. Either curve point may be used by the Cairo
    // verifier; the standard SDK signs against the same x-only convention.
    return ec.starkCurve.verify(parsed, hex(message),
      `02${felt(key).toString(16).padStart(64,'0')}`)
      || ec.starkCurve.verify(parsed, hex(message),
        `03${felt(key).toString(16).padStart(64,'0')}`);
  } catch { return false; }
}
export function signAction(terms, state, a, privateKey) {
  a = normalizeAction(a);
  requireThat(publicKey(privateKey) === BigInt(a.actor === BLACK ? terms.black_key : terms.white_key), 'Wrong signing key');
  return { action: a, signature: sign(actionHash(terms, state, a), privateKey) };
}

const occupied = (board, p) => board.black & 1n << BigInt(p) ? BLACK : board.white & 1n << BigInt(p) ? WHITE : 0;
const neighbors = (p, size) => [p >= size ? p-size : -1, p+size < size*size ? p+size : -1,
  p%size > 0 ? p-1 : -1, p%size+1 < size ? p+1 : -1].filter(n => n >= 0);
export function group(board, size, point) {
  requireThat(Number.isInteger(point) && point >= 0 && point < size*size, 'Point out of bounds');
  const color = occupied(board, point); requireThat(color !== 0, 'No group at point');
  const queue = [point], seen = new Set(queue); let liberty = false;
  for (let i=0;i<queue.length;i++) for (const p of neighbors(queue[i], size)) {
    const c = occupied(board,p);
    if (!c) liberty = true;
    else if (c === color && !seen.has(p)) { seen.add(p); queue.push(p); }
  }
  return { stones: bits(queue), liberty, count: queue.length };
}
export function markGroup(board, size, dead, point, isDead = true) {
  const g = group(board,size,point).stones;
  return isDead ? BigInt(dead) | g : BigInt(dead) & ~g;
}
function play(board, size, actor, point) {
  requireThat(point >= 0 && point < size*size, 'Point out of bounds');
  requireThat(!occupied(board,point), 'Point occupied');
  const out = { ...board }; out[actor === BLACK ? 'black' : 'white'] |= 1n << BigInt(point);
  let checked = 0n, captures = 0;
  for (const p of neighbors(point,size)) if (occupied(out,p) === other(actor) && !(checked & 1n << BigInt(p))) {
    const g = group(out,size,p); checked |= g.stones;
    if (!g.liberty) { out[actor === BLACK ? 'white' : 'black'] &= ~g.stones; captures += g.count; }
  }
  requireThat(group(out,size,point).liberty, 'Suicide prohibited');
  return { board: out, captures };
}
export function score(board, size, dead, komi) {
  board = { black: mask(board.black), white: mask(board.white) }; dead = mask(dead);
  const all = board.black | board.white;
  requireThat(!(board.black & board.white), 'Overlapping stones');
  requireThat(!(all >> BigInt(size*size)), 'Board padding occupied');
  requireThat(!(dead & ~all), 'Dead point is empty');
  for (let p=0;p<size*size;p++) if (dead & 1n << BigInt(p)) {
    for (const n of neighbors(p,size)) if (occupied(board,n) === occupied(board,p))
      requireThat(!!(dead & 1n << BigInt(n)), 'Partial dead group');
  }
  board = { black: board.black & ~dead, white: board.white & ~dead };
  let black = 0, white = 0; const visited = new Set();
  for (let p=0;p<size*size;p++) {
    const c = occupied(board,p);
    if (c === BLACK) black++;
    else if (c === WHITE) white++;
    else if (!visited.has(p)) {
      const queue = [p]; visited.add(p); let borders = 0;
      for (let i=0;i<queue.length;i++) for (const n of neighbors(queue[i],size)) {
        const nc = occupied(board,n);
        if (nc) borders |= nc;
        else if (!visited.has(n)) { visited.add(n); queue.push(n); }
      }
      if (borders === BLACK) black += queue.length;
      if (borders === WHITE) white += queue.length;
    }
  }
  return { black_half: 2*black, white_half: 2*white + komi };
}

export function applyAction(terms, input, historyInput, signed) {
  const t = normalizeTerms(terms), s = normalizeState(input), a = normalizeAction(signed.action);
  const history = historyInput.map(felt), seen = new Set(history.map(String));
  requireThat(history.length > 0 && seen.size === history.length, 'Invalid position history');
  requireThat(history.reduce(appendHistory, 0n) === s.history_root, 'Wrong position history');
  const message = actionHash(t,s,a);
  requireThat(verifySignature(message, signed.signature, a.actor === BLACK ? t.black_key : t.white_key), 'Invalid session signature');
  requireThat(s.phase !== FINISHED, 'Game already finished');
  other(a.actor);
  requireThat(a.kind === PLAY || a.point === NO_POINT, 'Noncanonical point');
  requireThat(a.kind === PROPOSE || a.dead === 0n, 'Noncanonical dead mask');
  if (a.kind === RESIGN) { s.phase = FINISHED; s.winner = other(a.actor); s.finish_reason = 2; }
  else {
    requireThat(a.actor === s.next_player, 'Wrong action turn');
    if (a.kind === PLAY) {
      requireThat(s.phase === PLAYING, 'Not playing');
      const result = play(s.board,t.size,a.actor,a.point), p = positionHash(result.board,t.size);
      requireThat(!seen.has(String(p)), 'Positional superko');
      history.push(p); s.history_root = appendHistory(s.history_root,p); s.board = result.board;
      s[a.actor === BLACK ? 'black_captures' : 'white_captures'] += result.captures;
      s.move_number++; s.consecutive_passes = 0; s.next_player = other(a.actor);
    } else if (a.kind === PASS) {
      requireThat(s.phase === PLAYING, 'Not playing');
      s.move_number++; s.consecutive_passes++; s.next_player = other(a.actor);
      if (s.consecutive_passes === 2) { s.phase = SCORING; s.scoring_round++; s.resume_player = s.next_player; s.proposed = false; s.dead = 0n; }
    } else if (a.kind === PROPOSE) {
      requireThat(s.phase === SCORING && !s.proposed, 'Cannot propose');
      score(s.board,t.size,a.dead,t.komi_half);
      s.dead = a.dead; s.proposed = true; s.next_player = other(a.actor);
    } else if (a.kind === ACCEPT) {
      requireThat(s.phase === SCORING && s.proposed, 'No scoring proposal');
      Object.assign(s,score(s.board,t.size,s.dead,t.komi_half));
      s.winner = s.black_half > s.white_half ? BLACK : s.white_half > s.black_half ? WHITE : DRAW;
      s.phase = FINISHED; s.finish_reason = 1;
    } else {
      requireThat(a.kind === RESUME && s.phase === SCORING, 'Cannot resume play');
      s.phase = PLAYING; s.next_player = s.resume_player; s.proposed = false; s.dead = 0n; s.consecutive_passes = 0;
    }
  }
  requireThat(s.sequence < 2**32-1, 'Action sequence overflow');
  if(s.last_actor !== a.actor)s.support_turn++;
  s.last_actor = a.actor;
  s.sequence++; s.transcript_hash = poseidon([s.transcript_hash,message]);
  return { state: normalizeState(s), history };
}

export function replay(terms, start, history, actions) {
  let result = { state: normalizeState(start), history: history.map(felt) };
  for (const signed of actions) result = applyAction(terms,result.state,result.history,signed);
  return result;
}
export function encodeSignedAction(signed) { return [...encodeAction(signed.action), felt(signed.signature.r), felt(signed.signature.s)]; }
export function encodeProofInput(terms, start, history, actions) {
  return [...encodeTerms(terms), ...encodeState(start), BigInt(history.length), ...history.map(felt),
    BigInt(actions.length), ...actions.flatMap(encodeSignedAction)].map(hex);
}

// This object contains public transcript data only. Keys stay with the caller.
export class Session {
  constructor(terms, start = initialState(Number(terms.size)), history = [positionHash(start.board, Number(terms.size))]) {
    this.terms = normalizeTerms(terms); this.start = normalizeState(start); this.initialHistory = history.map(felt);
    requireThat(this.initialHistory.reduce(appendHistory,0n) === this.start.history_root, 'Wrong position history');
    this.state = normalizeState(start); this.history = [...this.initialHistory]; this.actions = [];
  }
  receive(signed) {
    const next = applyAction(this.terms,this.state,this.history,signed);
    this.state = next.state; this.history = next.history;
    this.actions.push({ action: normalizeAction(signed.action), signature: { r: felt(signed.signature.r), s: felt(signed.signature.s) } });
    return this.state;
  }
  move(a, privateKey) {
    const signed = signAction(this.terms,this.state,a,privateKey); this.receive(signed); return signed;
  }
  checkpointSignature(epoch, privateKey) { return sign(checkpointHash(this.terms,epoch,this.state),privateKey); }
  export() { return { version: VERSION, terms: this.terms, start: this.start, history: this.initialHistory, actions: this.actions }; }
  static import(record) {
    requireThat(record.version === VERSION, 'Unsupported transcript version');
    const session = new Session(record.terms,record.start,record.history);
    for (const signed of record.actions) session.receive(signed);
    return session;
  }
}
