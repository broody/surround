// Go as a referee game in JS. The codec and rules mirror
// rules/src/{rules,go}.cairo byte for byte; the protocol (signatures,
// transcripts, sessions, disputes, randomness, codecs) comes from
// @referee/sdk and is re-exported here.
import * as referee from '@referee/sdk';
export * from '@referee/sdk';

const { felt, poseidon, tag, hex } = referee;

export const BLACK = 1, WHITE = 2, DRAW = 3, NO_POINT = 361;
export const PLAYING = 0, SCORING = 1, FINISHED = 2;
export const PLAY = 0, PASS = 1, PROPOSE = 2, ACCEPT = 3, RESUME = 4;
/** Finish reason: both players agreed on the dead stones after two passes. */
export const AGREEMENT = 1;

const LIMB = (1n << 128n) - 1n;
const requireThat = (condition, message) => { if (!condition) throw Error(message); };
const other = color => { requireThat(color === BLACK || color === WHITE, 'Invalid actor'); return 3 - color; };
export const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? hex(v) : v, 2) + '\n';

export const bits = values => values.reduce((mask, point) => {
  requireThat(Number.isInteger(point) && point >= 0 && point < 384, 'Invalid point');
  return mask | 1n << BigInt(point);
}, 0n);
export const limbs = value => [BigInt(value) & LIMB, BigInt(value) >> 128n & LIMB, BigInt(value) >> 256n];
const fromLimbs = r => r.next() + (r.next() << 128n) + (r.next() << 256n);
const mask = value => { const n = BigInt(value); requireThat(n >= 0n && n < 1n << 384n, 'Invalid bitset'); return n; };

export const positionHash = (board, size) =>
  poseidon([tag('SURROUND_POSITION_V1'), size, ...limbs(board.black), ...limbs(board.white)]);
export const appendHistory = (root, position) => poseidon([tag('SURROUND_HISTORY_V1'), root, position]);

const occupied = (board, p) => board.black & 1n << BigInt(p) ? BLACK : board.white & 1n << BigInt(p) ? WHITE : 0;
const neighbors = (p, size) => [p >= size ? p - size : -1, p + size < size * size ? p + size : -1,
  p % size > 0 ? p - 1 : -1, p % size + 1 < size ? p + 1 : -1].filter(n => n >= 0);

export function group(board, size, point) {
  requireThat(Number.isInteger(point) && point >= 0 && point < size * size, 'Point out of bounds');
  const color = occupied(board, point); requireThat(color !== 0, 'No group at point');
  const queue = [point], seen = new Set(queue); let liberty = false;
  for (let i = 0; i < queue.length; i++) for (const p of neighbors(queue[i], size)) {
    const c = occupied(board, p);
    if (!c) liberty = true;
    else if (c === color && !seen.has(p)) { seen.add(p); queue.push(p); }
  }
  return { stones: bits(queue), liberty, count: queue.length };
}

export function markGroup(board, size, dead, point, isDead = true) {
  const g = group(board, size, point).stones;
  return isDead ? BigInt(dead) | g : BigInt(dead) & ~g;
}

function play(board, size, color, point) {
  requireThat(point >= 0 && point < size * size, 'Point out of bounds');
  requireThat(!occupied(board, point), 'Point occupied');
  const out = { ...board }; out[color === BLACK ? 'black' : 'white'] |= 1n << BigInt(point);
  let checked = 0n, captures = 0;
  for (const p of neighbors(point, size)) if (occupied(out, p) === other(color) && !(checked & 1n << BigInt(p))) {
    const g = group(out, size, p); checked |= g.stones;
    if (!g.liberty) { out[color === BLACK ? 'white' : 'black'] &= ~g.stones; captures += g.count; }
  }
  requireThat(group(out, size, point).liberty, 'Suicide prohibited');
  return { board: out, captures };
}

export function score(board, size, dead, komi) {
  board = { black: mask(board.black), white: mask(board.white) }; dead = mask(dead);
  const all = board.black | board.white;
  requireThat(!(board.black & board.white), 'Overlapping stones');
  requireThat(!(all >> BigInt(size * size)), 'Board padding occupied');
  requireThat(!(dead & ~all), 'Dead point is empty');
  for (let p = 0; p < size * size; p++) if (dead & 1n << BigInt(p)) {
    for (const n of neighbors(p, size)) if (occupied(board, n) === occupied(board, p))
      requireThat(!!(dead & 1n << BigInt(n)), 'Partial dead group');
  }
  board = { black: board.black & ~dead, white: board.white & ~dead };
  let black = 0, white = 0; const visited = new Set();
  for (let p = 0; p < size * size; p++) {
    const c = occupied(board, p);
    if (c === BLACK) black++;
    else if (c === WHITE) white++;
    else if (!visited.has(p)) {
      const queue = [p]; visited.add(p); let borders = 0;
      for (let i = 0; i < queue.length; i++) for (const n of neighbors(queue[i], size)) {
        const nc = occupied(board, n);
        if (nc) borders |= nc;
        else if (!visited.has(n)) { visited.add(n); queue.push(n); }
      }
      if (borders === BLACK) black += queue.length;
      if (borders === WHITE) white += queue.length;
    }
  }
  return { black_half: 2 * black, white_half: 2 * white + komi };
}

const validateConfig = c => {
  requireThat([9, 13, 19].includes(c.size), 'Unsupported board size');
  requireThat(c.komi_half <= c.size * c.size * 2, 'Komi out of bounds');
};

/** `GoRules` for referee's JS SDK. Seat 0 plays black, seat 1 white. */
export const go = {
  tag: 'SURROUND',
  rulesVersion: 1,
  encodeConfig: c => [BigInt(c.size), BigInt(c.komi_half)],
  decodeConfig: r => ({ size: r.num(), komi_half: r.num() }),
  encodeAction: a => [BigInt(a.kind), BigInt(a.point), ...limbs(a.dead)],
  encodeState: s => [
    s.move_number, ...limbs(s.board.black), ...limbs(s.board.white), s.history_root, s.next_player, s.phase,
    s.consecutive_passes, s.scoring_round, s.resume_player, s.proposed ? 1 : 0, ...limbs(s.dead),
    s.black_captures, s.white_captures, s.winner, s.finish_reason, s.black_half, s.white_half,
  ].map(BigInt),
  decodeState: r => ({
    move_number: r.num(), board: { black: fromLimbs(r), white: fromLimbs(r) }, history_root: r.next(),
    next_player: r.num(), phase: r.num(), consecutive_passes: r.num(), scoring_round: r.num(),
    resume_player: r.num(), proposed: r.bool(), dead: fromLimbs(r), black_captures: r.num(),
    white_captures: r.num(), winner: r.num(), finish_reason: r.num(), black_half: r.num(), white_half: r.num(),
  }),

  init(config) {
    validateConfig(config);
    const board = { black: 0n, white: 0n };
    return {
      move_number: 0, board, history_root: appendHistory(0n, positionHash(board, config.size)),
      next_player: BLACK, phase: PLAYING, consecutive_passes: 0, scoring_round: 0, resume_player: BLACK,
      proposed: false, dead: 0n, black_captures: 0, white_captures: 0, winner: 0, finish_reason: 0,
      black_half: 0, white_half: 0,
    };
  },

  // The witness is every position hash since the start; scratch keeps it and
  // a set for positional superko.
  openingWitness: config => [positionHash({ black: 0n, white: 0n }, config.size)],
  load(config, state, witness) {
    const history = witness.map(felt), seen = new Set(history);
    requireThat(history.length > 0, 'Missing position history');
    requireThat(seen.size === history.length, 'Repeated history position');
    requireThat(history.reduce(appendHistory, 0n) === felt(state.history_root), 'Wrong position history');
    return { history, seen };
  },
  cloneScratch: s => ({ history: [...s.history], seen: new Set(s.seen) }),
  witness: s => [...s.history],

  apply(config, state, seat, a, scratch) {
    const s = structuredClone(state);
    requireThat(s.phase !== FINISHED, 'Game already finished');
    requireThat(a.kind <= RESUME, 'Unknown action');
    requireThat(a.kind === PLAY || a.point === NO_POINT, 'Noncanonical point');
    requireThat(a.kind === PROPOSE || BigInt(a.dead) === 0n, 'Noncanonical dead mask');
    const color = seat + 1, size = config.size;
    if (a.kind === PLAY) {
      requireThat(s.phase === PLAYING, 'Not playing');
      const result = play(s.board, size, color, a.point), p = positionHash(result.board, size);
      requireThat(!scratch.seen.has(p), 'Positional superko');
      scratch.seen.add(p); scratch.history.push(p);
      s.board = result.board; s.history_root = appendHistory(s.history_root, p);
      s[color === BLACK ? 'black_captures' : 'white_captures'] += result.captures;
      s.move_number++; s.consecutive_passes = 0; s.next_player = other(color);
    } else if (a.kind === PASS) {
      requireThat(s.phase === PLAYING, 'Not playing');
      s.move_number++; s.consecutive_passes++; s.next_player = other(color);
      if (s.consecutive_passes === 2) {
        s.phase = SCORING; s.scoring_round++; s.resume_player = s.next_player; s.proposed = false; s.dead = 0n;
      }
    } else if (a.kind === PROPOSE) {
      requireThat(s.phase === SCORING && !s.proposed, 'Cannot propose');
      score(s.board, size, a.dead, config.komi_half);
      s.dead = BigInt(a.dead); s.proposed = true; s.next_player = other(color);
    } else if (a.kind === ACCEPT) {
      requireThat(s.phase === SCORING && s.proposed, 'No scoring proposal');
      Object.assign(s, score(s.board, size, s.dead, config.komi_half));
      s.winner = s.black_half > s.white_half ? BLACK : s.white_half > s.black_half ? WHITE : DRAW;
      s.phase = FINISHED; s.finish_reason = AGREEMENT;
    } else {
      requireThat(s.phase === SCORING, 'Cannot resume play');
      s.phase = PLAYING; s.next_player = s.resume_player; s.proposed = false; s.dead = 0n; s.consecutive_passes = 0;
    }
    return [s, null];
  },
  resolve() { throw Error('Go has no randomness'); },
  due: s => s.next_player - 1,
  // BLACK (1) and WHITE (2) are already seat + 1; referee's draw is 0.
  outcome: s => (s.phase === FINISHED ? [s.winner === DRAW ? 0 : s.winner, s.finish_reason] : null),
};

/** A Go step for `seat` (0 black, 1 white). */
export const goStep = (seat, kind, point = NO_POINT, dead = 0n) =>
  ({ seat, move: { kind: referee.MOVE_PLAY, action: { kind, point, dead: BigInt(dead) } } });
export const resignStep = seat => ({ seat, move: { kind: referee.MOVE_RESIGN } });

/**
 * Terms for a Surround channel. Go never requests randomness, so the channel
 * uses each seat's session key as its randomness tip.
 */
export function goTerms({ chain_id, channel, game_id, prover, response_seconds = 3600, players, keys, size, komi_half }) {
  const config = { size: Number(size), komi_half: Number(komi_half) };
  validateConfig(config);
  return {
    chain_id: felt(chain_id), channel: felt(channel), game_id: felt(game_id), prover: felt(prover),
    response_seconds: Number(response_seconds), players: players.map(felt), keys: keys.map(felt),
    rng_tips: keys.map(felt), config,
  };
}

/** A client session for a Go channel. */
export const goSession = (terms, options) => new referee.Session(go, terms, options);

/** Restore BigInts in an envelope that went through JSON (`json` writes them as hex). */
export function reviveEnvelope(env) {
  return {
    seq: Number(env.seq), transcript: felt(env.transcript), support_turn: Number(env.support_turn),
    last_seat: Number(env.last_seat),
    pending: { active: Boolean(env.pending.active), seat: Number(env.pending.seat), seq: Number(env.pending.seq), entropy: felt(env.pending.entropy) },
    rng_heads: env.rng_heads.map(felt),
    outcome: { finished: Boolean(env.outcome.finished), winner: Number(env.outcome.winner), reason: Number(env.outcome.reason) },
    game: go.decodeState(new referee.Reader(go.encodeState(env.game))),
  };
}

/** Import a Go transcript exported with `json(session.export())`, verifying every step. */
export function importSession(record) {
  const terms = { ...record.terms, config: { size: Number(record.terms.config.size), komi_half: Number(record.terms.config.komi_half) } };
  return referee.Session.import(go, { ...record, terms, start: reviveEnvelope(record.start), witness: record.witness.map(felt) });
}
