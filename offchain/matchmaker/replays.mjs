// Replays: the moves of a finished game, for a player's page to step
// through (GET /games/:id/record). A casual game's record is in the database
// (db/history.mjs: nothing else holds it); a rated one's is at the keeper that
// refereed it (its `GET /games/:channel/:game`, kept on its disk once closed),
// found by asking the matchmaker's keepers in order, as the kifu minter does.
//
// - Only the steps are served, bare: each `{ kind, action? , seat? }`, as the
//   board (shared/go.ts `positionOf`) reads them. No signatures: a replay is
//   for looking at; anyone who wants to check a game asks its keeper.
// - Nothing is verified here: importing a session checks every signature, too
//   slow for a request on the pairing server. A rated game is only looked for
//   at a keeper when the indexer has it, so a request can't send the keepers
//   anywhere else.
// - A game's moves never change once it is over: each game's found is kept in
//   memory (the newest `cache` of them). Its row isn't: the indexer may still
//   rate it, or read it again after a reorg, so that is read each time.
// - No keeper holding it is a 404; a keeper that couldn't be asked (down, slow,
//   failing) is a 503, as the game may well be there.
import { parse } from '../sdk/node_modules/@arbiter/sdk/sdk/src/store.mjs';
import * as p from '../sdk/src/index.mjs';

const notFound = message => Object.assign(Error(message), { status: 404 });
const unavailable = message => Object.assign(Error(message), { status: 503 });
const num = v => Number(typeof v === 'string' ? BigInt(v) : v);

/** A step as a replay needs it: a Go action, a resignation (its seat) or the referee's flag; null for anything else. */
function bare({ step }) {
  const kind = num(step.kind);
  if (kind === p.MOVE_PLAY) {
    const action = { kind: num(step.action.kind) };
    if (action.kind === p.PLAY) action.point = num(step.action.point);
    if (action.kind === p.PROPOSE) action.dead = p.hex(BigInt(step.action.dead));
    return { kind, action };
  }
  if (kind === p.MOVE_RESIGN) return { kind, seat: num(step.seat) };
  if (kind === p.MOVE_FLAG) return { kind };
  return null;
}

/** What a game's signed record (felts as hex, or BigInts) says for a replay: its seats, board, komi and bare steps. */
function movesOf(record) {
  if (num(record.start.seq) !== 0) throw notFound('No record of this game from its first move');
  const { size, komi_half, handicap = 0 } = record.terms.config;
  return { players: record.terms.players.map(x => p.hex(p.felt(x))), size: num(size), komi_half: num(komi_half),
    ...(num(handicap) ? { handicap: num(handicap) } : {}),
    steps: record.steps.map(bare).filter(Boolean) };
}

export class Replays {
  /**
   * `history` is db/history.mjs; `keepers` the matchmaker's (`[{ url }]`), asked
   * in order for a rated game's record, with `fetch` (one that times out).
   */
  constructor(history, { keepers, fetch = globalThis.fetch, cache = 200 }) {
    this.history = history;
    this.keepers = keepers;
    this.fetch = fetch;
    this.max = cache;
    /** Games' moves found (`movesOf`), by id, oldest first; a promise while one is being found. */
    this.cache = new Map();
  }

  /**
   * The replay of the game `id` (a history entry's id): its row and its moves.
   * Throws a 404 where there's no such game or no record of it, a 503 where a
   * keeper that might hold it couldn't be asked.
   */
  async get(id) {
    const game = this.history.game(id);
    if (!game) throw notFound('No such game');
    let moves = this.cache.get(game.id);
    if (!moves) {
      moves = this.#find(game);
      this.cache.set(game.id, moves);
      moves.catch(() => this.cache.get(game.id) === moves && this.cache.delete(game.id));
      while (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value);
    }
    const { players, size, komi_half, handicap, steps } = await moves;
    // A seat the indexer missed (no TicketUsed) is the record's. A handicap game's stones are its terms'.
    return { kind: game.kind, id: game.id, black: game.black ?? players[0], white: game.white ?? players[1], size, komi_half,
      ...(handicap ? { handicap } : {}), winner: game.winner, reason: game.reason, voided: game.voided, at: game.at, steps };
  }

  async #find(game) {
    if (game.kind === 'casual') return movesOf(JSON.parse(game.record));
    const path = `/games/${p.hex(p.felt(game.channel))}/${p.hex(p.felt(game.game_id))}`;
    let unanswered = 0;
    for (const { url } of this.keepers) {
      try {
        const res = await this.fetch(`${url}${path}`);
        if (!res.ok) {
          if (res.status !== 404) unanswered++;
          continue;
        }
        const view = parse(await res.text());
        if (Number(view.start) === 0) return movesOf(view.record);
      } catch {
        unanswered++;
      }
    }
    if (unanswered) throw unavailable('A keeper that may hold this game\'s record can\'t be reached');
    throw notFound('No keeper has this game\'s record');
  }
}
