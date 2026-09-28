// Kifu records: a settled game's steps and final position, packed exactly as
// the Kifu contract stores them (`src/kifu/record.cairo`, which documents the
// format). `encodeKifu` builds the `record` that `mint` takes; `decodeKifu`
// unpacks one read from the contract or from Torii's `Kifu` model.
import * as referee from '@referee/sdk';
import { ACCEPT, BLACK, PASS, PLAY, PROPOSE, RESUME, WHITE } from './index.mjs';

const { MOVE_PLAY, MOVE_RECOMMIT, MOVE_RESIGN, MOVE_FLAG } = referee;
const LOW_MAX = (1n << 128n) - 1n, HIGH_MAX = (1n << 123n) - 1n;
// Codes after the points' own.
const CODE = { pass: 0, accept: 1, resume: 2, propose: 3, resign: 4, flag: 6, recommit: 7 };
const CODES = 8;
const check = (condition, message) => { if (!condition) throw Error(message); };
/** The most dead stones a mask lists point by point; more take a bitmap. */
const listLimit = points => points === 81 ? 12 : points === 169 ? 22 : 41;

class Writer {
  felts = []; low = 0n; lane = 0; acc = 0n; mul = 1n;
  put(value, radix) {
    value = BigInt(value); radix = BigInt(radix);
    check(value >= 0n && value < radix, 'Unencodable step');
    if (this.mul > (this.lane === 0 ? LOW_MAX : HIGH_MAX) / radix) {
      if (this.lane === 0) { this.low = this.acc; this.lane = 1; }
      else { this.felts.push((this.acc << 128n) + this.low); this.low = 0n; this.lane = 0; }
      this.acc = 0n; this.mul = 1n;
    }
    this.acc += value * this.mul; this.mul *= radix;
  }
  bits(value, count) {
    for (let read = 0; read < count; read += 16) {
      const width = Math.min(16, count - read);
      this.put(value & ((1n << BigInt(width)) - 1n), 1n << BigInt(width));
      value >>= BigInt(width);
    }
    check(value === 0n, 'Unencodable step');
  }
  finish() {
    if (this.lane === 1) this.felts.push((this.acc << 128n) + this.low);
    else if (this.mul > 1n) this.felts.push(this.acc);
    return this.felts;
  }
}

class Reader {
  constructor(felts) { this.felts = felts.map(BigInt); this.high = 0n; this.lane = 1; this.cur = 0n; this.mul = LOW_MAX; }
  take(radix) {
    radix = BigInt(radix);
    if (this.mul > (this.lane === 0 ? LOW_MAX : HIGH_MAX) / radix) {
      check(this.cur === 0n, 'Noncanonical record');
      if (this.lane === 0) { this.cur = this.high; this.lane = 1; }
      else {
        check(this.felts.length > 0, 'Record too short');
        const felt = this.felts.shift();
        this.cur = felt & LOW_MAX; this.high = felt >> 128n; this.lane = 0;
      }
      this.mul = 1n;
    }
    const digit = this.cur % radix;
    this.cur /= radix; this.mul *= radix;
    return digit;
  }
  bits(count) {
    let value = 0n;
    for (let read = 0; read < count; read += 16) {
      const width = Math.min(16, count - read);
      value += this.take(1n << BigInt(width)) << BigInt(read);
    }
    return value;
  }
}

const ones = mask => { const out = []; for (let p = 0; mask > 0n; p++, mask >>= 1n) if (mask & 1n) out.push(p); return out; };
const limbWidths = points => { const low = Math.min(points, 128), mid = Math.min(points - low, 128); return [low, mid, points - low - mid]; };

/** Each Play's color and the last color played on each point, in referee's turn order. */
function walk(steps) {
  const last = new Map();
  let next = BLACK, resume = BLACK, passes = 0;
  for (const step of steps) {
    if (step.kind !== MOVE_PLAY) continue;
    const a = step.action;
    if (a.kind === PLAY) { last.set(Number(a.point), next); passes = 0; next = 3 - next; }
    else if (a.kind === PASS) { passes++; next = 3 - next; if (passes === 2) resume = next; }
    else if (a.kind === PROPOSE) next = 3 - next;
    else if (a.kind === RESUME) { next = resume; passes = 0; }
  }
  return last;
}

/**
 * Pack a game's steps from the opening (referee step objects, as in
 * `session.steps[i].step`) and its settled final position `{ black, white }`.
 */
export function encodeKifu(size, steps, board) {
  const points = size * size, radix = points + CODES, w = new Writer();
  for (const step of steps) {
    if (step.kind === MOVE_PLAY) {
      const a = step.action;
      if (a.kind === PLAY) { check(Number(a.point) < points, 'Unencodable step'); w.put(a.point, radix); }
      else if (a.kind === PASS) w.put(points + CODE.pass, radix);
      else if (a.kind === ACCEPT) w.put(points + CODE.accept, radix);
      else if (a.kind === RESUME) w.put(points + CODE.resume, radix);
      else if (a.kind === PROPOSE) {
        w.put(points + CODE.propose, radix);
        const dead = BigInt(a.dead), listed = ones(dead), limit = listLimit(points);
        if (listed.length <= limit) {
          w.put(0, 2); w.put(listed.length, limit + 1);
          let start = 0;
          for (const p of listed) { check(p < points, 'Unencodable step'); w.put(p - start, points - start); start = p + 1; }
        } else {
          w.put(1, 2);
          const [low, mid, high] = limbWidths(points);
          w.bits(dead & LOW_MAX, low); w.bits(dead >> 128n & LOW_MAX, mid); w.bits(dead >> 256n, high);
        }
      } else throw Error('Unencodable step');
    } else if (step.kind === MOVE_RESIGN) { check(Number(step.seat) < 2, 'Unencodable step'); w.put(points + CODE.resign + Number(step.seat), radix); }
    else if (step.kind === MOVE_FLAG) w.put(points + CODE.flag, radix);
    else if (step.kind === MOVE_RECOMMIT) {
      w.put(points + CODE.recommit, radix);
      const tip = BigInt(step.tip);
      w.bits(tip & LOW_MAX, 128); w.bits(tip >> 128n, 124);
    } else throw Error('Unencodable step');
  }
  // Whether each played point holds a stone at the end, in point order.
  const last = walk(steps), black = BigInt(board.black), white = BigInt(board.white);
  const played = [...last.keys()].sort((a, b) => a - b);
  const set = new Set(played);
  for (const p of ones(black | white)) check(set.has(p), 'Unencodable board');
  const bits = played.map(p => {
    const stone = black >> BigInt(p) & 1n ? BLACK : white >> BigInt(p) & 1n ? WHITE : 0;
    check(stone === 0 || stone === last.get(p), 'Unencodable board');
    return stone ? 1n : 0n;
  });
  for (let i = 0; i < bits.length; i += 16) {
    const chunk = bits.slice(i, i + 16);
    w.put(chunk.reduce((v, b, j) => v | b << BigInt(j), 0n), 1n << BigInt(chunk.length));
  }
  return w.finish();
}

/** Unpack a record of `count` steps: `{ steps, board }`. Rejects any record `encodeKifu` would not produce. */
export function decodeKifu(size, count, record) {
  const points = size * size, radix = points + CODES, r = new Reader(record), steps = [];
  const go = action => referee.play(action);
  for (let i = 0; i < count; i++) {
    const code = Number(r.take(radix));
    if (code < points) { steps.push(go({ kind: PLAY, point: code })); continue; }
    const kind = code - points;
    if (kind === CODE.pass) steps.push(go({ kind: PASS }));
    else if (kind === CODE.accept) steps.push(go({ kind: ACCEPT }));
    else if (kind === CODE.resume) steps.push(go({ kind: RESUME }));
    else if (kind === CODE.propose) {
      const limit = listLimit(points);
      let dead = 0n;
      if (r.take(2) === 0n) {
        const n = Number(r.take(limit + 1));
        for (let j = 0, start = 0; j < n; j++) {
          check(start < points, 'Noncanonical record');
          const p = start + Number(r.take(points - start));
          dead |= 1n << BigInt(p); start = p + 1;
        }
      } else {
        const [low, mid, high] = limbWidths(points);
        dead = r.bits(low) | r.bits(mid) << 128n | r.bits(high) << 256n;
        check(ones(dead).length > limit, 'Noncanonical record');
      }
      steps.push(go({ kind: PROPOSE, dead }));
    } else if (kind === CODE.flag) steps.push(referee.flag());
    else if (kind === CODE.recommit) steps.push(referee.recommit(r.bits(128) | r.bits(124) << 128n));
    else steps.push(referee.resign(kind - CODE.resign));
  }
  const last = walk(steps), board = { black: 0n, white: 0n };
  const played = [...last.keys()].sort((a, b) => a - b);
  for (let i = 0; i < played.length; i += 16) {
    const width = Math.min(16, played.length - i);
    let chunk = r.take(1n << BigInt(width));
    for (const p of played.slice(i, i + width)) {
      if (chunk & 1n) board[last.get(p) === BLACK ? 'black' : 'white'] |= 1n << BigInt(p);
      chunk >>= 1n;
    }
  }
  check(r.cur === 0n && r.felts.length === 0 && (r.lane === 1 || r.high === 0n), 'Noncanonical record');
  return { steps, board };
}
