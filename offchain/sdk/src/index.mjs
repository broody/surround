// Go as a referee game in JS. The codec and rules mirror
// rules/src/{rules,go}.cairo byte for byte; the protocol (signatures,
// transcripts, sessions, disputes, randomness, codecs) comes from
// @referee/sdk and is re-exported here.
import * as referee from '@referee/sdk';
export * from '@referee/sdk';

const { felt, poseidon, tag, hex } = referee;

export const BLACK = 1, WHITE = 2, DRAW = 3, NO_POINT = 361;
export const PLAYING = 0, SCORING = 1, FINISHED = 2;
/** `GoAction` variants, in Cairo's order: Play(point), Pass, Propose(dead), Accept, Resume. */
export const PLAY = 0, PASS = 1, PROPOSE = 2, ACCEPT = 3, RESUME = 4;
/** Finish reason: both players agreed on the dead stones after two passes. */
export const AGREEMENT = 1;
/** Finish reasons: two passes after the game's one resume, and a move limit, both scored with every stone alive. */
export const PLAYED_OUT = 2, MOVE_LIMIT = 3;
/** Moves a game may take in all, and after its one resume (`move_limit`, `playout_limit`). */
export const moveLimit = config => 3 * config.size * config.size;
export const playoutLimit = config => 2 * config.size * config.size;

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
  rulesVersion: 3,
  encodeConfig: c => [BigInt(c.size), BigInt(c.komi_half)],
  decodeConfig: r => ({ size: r.num(), komi_half: r.num() }),
  encodeAction(a) {
    switch (a.kind) {
      case PLAY: return [0n, BigInt(a.point)];
      case PROPOSE: return [2n, ...limbs(mask(a.dead))];
      case PASS: case ACCEPT: case RESUME: return [BigInt(a.kind)];
      default: throw Error('Unknown action');
    }
  },
  // The inverse of `encodeAction`: a keeper reads steps played onchain back from calldata with it.
  decodeAction(r) {
    const kind = r.num();
    if (kind === PLAY) return { kind, point: r.num() };
    if (kind === PROPOSE) return { kind, dead: fromLimbs(r) };
    requireThat([PASS, ACCEPT, RESUME].includes(kind), 'Unknown action');
    return { kind };
  },
  encodeState: s => [
    s.move_number, ...limbs(s.board.black), ...limbs(s.board.white), s.history_root, s.next_player, s.phase,
    s.consecutive_passes, s.scoring_round, s.resume_player, s.resumed_at, s.proposed ? 1 : 0, ...limbs(s.dead),
    s.black_captures, s.white_captures, s.winner, s.finish_reason, s.black_half, s.white_half,
  ].map(BigInt),
  decodeState: r => ({
    move_number: r.num(), board: { black: fromLimbs(r), white: fromLimbs(r) }, history_root: r.next(),
    next_player: r.num(), phase: r.num(), consecutive_passes: r.num(), scoring_round: r.num(),
    resume_player: r.num(), resumed_at: r.num(), proposed: r.bool(), dead: fromLimbs(r), black_captures: r.num(),
    white_captures: r.num(), winner: r.num(), finish_reason: r.num(), black_half: r.num(), white_half: r.num(),
  }),

  init(config) {
    validateConfig(config);
    const board = { black: 0n, white: 0n };
    return {
      move_number: 0, board, history_root: appendHistory(0n, positionHash(board, config.size)),
      next_player: BLACK, phase: PLAYING, consecutive_passes: 0, scoring_round: 0, resume_player: BLACK,
      resumed_at: 0, proposed: false, dead: 0n, black_captures: 0, white_captures: 0, winner: 0, finish_reason: 0,
      black_half: 0, white_half: 0,
    };
  },

  // The witness is every position hash since the start; scratch keeps it and
  // a set for positional superko.
  openingWitness: config => [positionHash({ black: 0n, white: 0n }, config.size)],
  encodeWitness: history => referee.span(history),
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
    requireThat([PLAY, PASS, PROPOSE, ACCEPT, RESUME].includes(a.kind), 'Unknown action');
    const color = seat + 1, size = config.size;
    if (a.kind === PLAY) {
      requireThat(s.phase === PLAYING, 'Not playing');
      const result = play(s.board, size, color, a.point), p = positionHash(result.board, size);
      requireThat(!scratch.seen.has(p), 'Positional superko');
      scratch.seen.add(p); scratch.history.push(p);
      s.board = result.board; s.history_root = appendHistory(s.history_root, p);
      s[color === BLACK ? 'black_captures' : 'white_captures'] += result.captures;
      s.move_number++; s.consecutive_passes = 0; s.next_player = other(color);
      checkLimits(s, config);
    } else if (a.kind === PASS) {
      requireThat(s.phase === PLAYING, 'Not playing');
      s.move_number++; s.consecutive_passes++; s.next_player = other(color);
      if (s.consecutive_passes === 2) {
        if (s.resumed_at !== 0) finishOnBoard(s, config, PLAYED_OUT);
        else { s.phase = SCORING; s.scoring_round++; s.resume_player = s.next_player; s.proposed = false; s.dead = 0n; }
      } else checkLimits(s, config);
    } else if (a.kind === PROPOSE) {
      requireThat(s.phase === SCORING && !s.proposed, 'Cannot propose');
      score(s.board, size, a.dead, config.komi_half);
      s.dead = BigInt(a.dead); s.proposed = true; s.next_player = other(color);
    } else if (a.kind === ACCEPT) {
      requireThat(s.phase === SCORING && s.proposed, 'No scoring proposal');
      Object.assign(s, score(s.board, size, s.dead, config.komi_half));
      s.winner = winnerOf(s.black_half, s.white_half);
      s.phase = FINISHED; s.finish_reason = AGREEMENT;
    } else {
      requireThat(s.phase === SCORING, 'Cannot resume play');
      requireThat(s.resumed_at === 0, 'Already resumed');
      s.resumed_at = s.move_number;
      s.phase = PLAYING; s.next_player = s.resume_player; s.proposed = false; s.dead = 0n; s.consecutive_passes = 0;
    }
    return [s, null];
  },
  resolve() { throw Error('Go has no randomness'); },
  due: s => s.next_player - 1,
  // BLACK (1) and WHITE (2) are already seat + 1; referee's draw is 0.
  outcome: s => (s.phase === FINISHED ? [s.winner === DRAW ? 0 : s.winner, s.finish_reason] : null),
  maxSteps: config => moveLimit(config) + 64,
  adjudicate(config, state) {
    const { black_half, white_half } = score(state.board, config.size, 0n, config.komi_half);
    const winner = winnerOf(black_half, white_half);
    return [winner === DRAW ? 0 : winner, MOVE_LIMIT];
  },
};

const winnerOf = (black, white) => (black > white ? BLACK : white > black ? WHITE : DRAW);

// End a game that reached a move limit, scored as it stands (`check_limits`).
function checkLimits(s, config) {
  if (s.move_number >= moveLimit(config) || (s.resumed_at !== 0 && s.move_number >= s.resumed_at + playoutLimit(config)))
    finishOnBoard(s, config, MOVE_LIMIT);
}

// Score the board with every stone alive and finish (`finish_on_board`).
function finishOnBoard(s, config, reason) {
  Object.assign(s, score(s.board, config.size, 0n, config.komi_half));
  s.winner = winnerOf(s.black_half, s.white_half);
  s.dead = 0n; s.phase = FINISHED; s.finish_reason = reason;
}

/** A canonical Go action: only Play has a point and only Propose a dead mask. */
export function goAction(kind, point = NO_POINT, dead = 0n) {
  if (kind === PLAY) return { kind, point: Number(point) };
  if (kind === PROPOSE) return { kind, dead: BigInt(dead) };
  requireThat([PASS, ACCEPT, RESUME].includes(kind), 'Unknown action');
  return { kind };
}
/** A Go step. It belongs to the seat due to move (seat 0 black, seat 1 white). */
export const goStep = (kind, point, dead) => referee.play(goAction(kind, point, dead));
/** Either seat may resign at any time, so resignation names its seat. */
export const resignStep = seat => referee.resign(seat);

/** Ranked games' per-turn timer: Surround's old clock, 60 s per turn with no bank or increment. */
export const RANKED_TURN_MS = 60000;

// Ranked time controls are refereed by `key`: the public key of the keeper
// that stamps the game's steps (`referee` in the keeper's `GET /info`). Every
// step, scoring included, is charged to the seat due to act. Both use referee's
// standard time rules (`standardTime`), which Go's codec keeps as its default.
// Go never asks for a roll, so no clock carries a referee's randomness tip
// (`rng_tip` is 0): the channel refuses one that does.

/** A ranked game on Surround's per-turn timer: 60 s per turn, nothing carried over. */
export const rankedClock = key => ({
  referee: felt(key), settings: { turn_ms: RANKED_TURN_MS, bank_ms: 0, increment_ms: 0, byoyomi: null }, rng_tip: 0n,
});

/**
 * A ranked game on Japanese byo-yomi: `main_ms` of main time, then `periods`
 * periods of `period_ms`. A turn that ends inside a period costs nothing, each
 * period that runs out is lost, and a seat that outlasts its last period has
 * flagged.
 */
export const byoyomiClock = (key, { main_ms, periods, period_ms }) => ({
  referee: felt(key), settings: { turn_ms: 0, bank_ms: main_ms, increment_ms: 0, byoyomi: { periods, period_ms } },
  rng_tip: 0n,
});

const reviveClock = c => {
  if (c == null) return null;
  const s = c.settings, b = s.byoyomi;
  return {
    referee: felt(c.referee),
    settings: { turn_ms: Number(s.turn_ms), bank_ms: Number(s.bank_ms), increment_ms: Number(s.increment_ms),
      byoyomi: b == null ? null : { periods: Number(b.periods), period_ms: Number(b.period_ms) } },
    rng_tip: felt(c.rng_tip ?? 0),
  };
};

/**
 * Terms for a Surround channel. Go never requests randomness, so the channel
 * uses each seat's session key as its randomness tip. `clock` is the time
 * control of a timed game (`rankedClock(referee)` or `byoyomiClock(...)`),
 * null when untimed.
 */
export function goTerms({ chain_id, channel, game_id, prover, response_seconds = 3600, clock = null, players, keys, size, komi_half }) {
  const config = { size: Number(size), komi_half: Number(komi_half) };
  validateConfig(config);
  referee.checkTimeControl(go, clock);
  return {
    chain_id: felt(chain_id), channel: felt(channel), game_id: felt(game_id), prover: felt(prover),
    response_seconds: Number(response_seconds), clock: reviveClock(clock), players: players.map(felt), keys: keys.map(felt),
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
    rng_heads: env.rng_heads.map(felt), rng_fresh: env.rng_fresh.map(Boolean), rng_referee: felt(env.rng_referee ?? 0),
    clock: env.clock == null ? null : {
      seats: { banks: env.clock.seats.banks.map(Number), periods: env.clock.seats.periods.map(Number) },
      used: Number(env.clock.used), stamp: Number(env.clock.stamp),
    },
    outcome: { finished: Boolean(env.outcome.finished), winner: Number(env.outcome.winner), reason: Number(env.outcome.reason) },
    game: go.decodeState(new referee.Reader(go.encodeState(env.game))),
  };
}

/**
 * Import a Go transcript exported with `json(session.export())`, verifying
 * every step (and, in a timed game, every stamp's attestation).
 */
export function importSession(record, options) {
  const t = record.terms;
  const terms = { ...t, clock: reviveClock(t.clock), config: { size: Number(t.config.size), komi_half: Number(t.config.komi_half) } };
  return referee.Session.import(go, { ...record, terms, start: reviveEnvelope(record.start), witness: record.witness.map(felt) }, options);
}
