import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  areaScore,
  emptyPosition,
  groupAt,
  play,
  pointFromCoordinate,
  type Color,
  type Position,
} from "../../apps/web/src/game/rules.ts";
import {
  CHARACTERS,
  KOMI,
  PLACEMENT_GAMES,
  RANKS,
  rankIndex,
  recommendedCharacter,
  type BoardSize,
  type Lobby,
  type Match,
  type Player,
  type Seat,
} from "../../shared/lobby.ts";
import {
  MU_T,
  anchorRating,
  rankLabel,
  rankTenths,
  update,
  type Rating,
} from "../sdk/src/rating.mjs";
import { KataGo, type EngineAPI, type EngineEnv } from "./engine.ts";
import { deadStones } from "./scoring.ts";

type Profile = Player & {
  tokenHash: string;
  rating: { mu: string; phi: string; last: string };
};
type State = {
  schema: 1;
  profiles: Record<string, Profile>;
  matches: Record<string, Match>;
};
export type LobbyOptions = EngineEnv & {
  dataFile?: string;
  engine?: EngineAPI;
  aiRatedAfterPlacement?: boolean;
  allowedOrigins?: string[];
};
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const rating = (profile: Profile): Rating => ({
  mu: BigInt(profile.rating.mu),
  phi: BigInt(profile.rating.phi),
  last: BigInt(profile.rating.last),
});
const packRating = (value: Rating) => ({
  mu: String(value.mu),
  phi: String(value.phi),
  last: String(value.last),
});
const publicPlayer = ({
  id,
  name,
  rank,
  games,
  placementGames,
  wins,
  losses,
}: Profile): Player => ({
  id,
  name,
  rank,
  games,
  placementGames,
  wins,
  losses,
});
const seat = (profile: Profile): Seat => ({
  id: profile.id,
  name: profile.name,
  rank: profile.rank,
  kind: "human",
});
const boardSize = (value: unknown): BoardSize => {
  if (value !== 9 && value !== 13 && value !== 19)
    fail(400, "Choose a 9, 13, or 19 line board.");
  return value as BoardSize;
};
const nameOf = (value: unknown) => {
  if (
    typeof value !== "string" ||
    !/^[\p{L}\p{N} _.'-]{2,24}$/u.test(value.trim())
  )
    fail(
      400,
      "Use 2–24 letters, numbers, spaces, or simple punctuation for your name.",
    );
  return (value as string).trim();
};

export class LobbyService {
  private state: State = { schema: 1, profiles: {}, matches: {} };
  private engine: EngineAPI;
  private options: LobbyOptions;
  private loaded: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();
  private seen = new Map<string, number>();
  private queue = new Map<string, { size: BoardSize; at: number }>();
  private jobs = new Map<string, AbortController>();
  private rates = new Map<string, { at: number; count: number }>();
  private closed = false;
  constructor(options: LobbyOptions) {
    this.options = options;
    this.engine = options.engine ?? new KataGo(options);
    this.loaded = this.load();
    void this.loaded.catch((error) =>
      console.error("Lobby data could not be loaded:", error),
    );
    void this.engine.ready().catch(() => {});
  }
  private async load() {
    if (!this.options.dataFile) return;
    try {
      const state = JSON.parse(
        await readFile(this.options.dataFile, "utf8"),
      ) as State;
      if (state.schema !== 1 || !state.profiles || !state.matches)
        throw new Error("Unsupported lobby data schema.");
      this.state = state;
      for (const match of Object.values(state.matches)) match.thinking = false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private transaction<T>(fn: () => T): Promise<T> {
    const result = this.writes.then(async () => {
      await this.loaded;
      const before = structuredClone(this.state);
      try {
        const value = fn();
        if (this.options.dataFile) {
          await mkdir(dirname(this.options.dataFile), { recursive: true });
          const temp = `${this.options.dataFile}.tmp`;
          await writeFile(temp, JSON.stringify(this.state), { mode: 0o600 });
          await rename(temp, this.options.dataFile);
        }
        return value;
      } catch (error) {
        this.state = before;
        throw error;
      }
    });
    this.writes = result.catch(() => {});
    return result;
  }
  private active(id: string) {
    return Object.values(this.state.matches).find(
      (match) =>
        [match.black.id, match.white?.id].includes(id) &&
        ["waiting", "playing", "scoring"].includes(match.status),
    );
  }
  private touch(match: Match) {
    match.version++;
    match.updatedAt = Date.now();
  }
  private assertFree(id: string) {
    if (this.active(id)) fail(409, "Finish or leave your current game first.");
  }
  private newMatch(
    player: Profile,
    size: BoardSize,
    visibility: "public" | "private",
    ai?: { id: string },
  ): Match {
    player = this.state.profiles[player.id];
    this.assertFree(player.id);
    if (Object.keys(this.state.matches).length >= 1000) {
      const finished = Object.values(this.state.matches)
        .filter((match) => ["finished", "cancelled"].includes(match.status))
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, 100);
      if (!finished.length)
        fail(503, "All tables are occupied. Please try again later.");
      for (const match of finished) delete this.state.matches[match.id];
    }
    const character =
      ai && CHARACTERS.find((character) => character.id === ai.id);
    if (ai && !character) fail(400, "Choose an opponent from the roster.");
    if (
      ai &&
      (!this.engine.status().human || this.engine.status().state !== "ready")
    )
      fail(
        503,
        "AI opponents are warming up or unavailable. You can still play a human.",
      );
    const match: Match = {
      id: randomUUID(),
      version: 1,
      size,
      komi: KOMI,
      black: seat(player),
      white: character
        ? {
            id: `ai:${character.id}`,
            name: character.name,
            rank: character.rank,
            kind: "ai",
            characterId: character.id,
          }
        : null,
      position: emptyPosition(size),
      status: character ? "playing" : "waiting",
      visibility,
      ...(visibility === "private" && !ai
        ? { code: randomBytes(6).toString("hex").toUpperCase() }
        : {}),
      ranked: character
        ? player.placementGames < PLACEMENT_GAMES ||
          Boolean(this.options.aiRatedAfterPlacement)
        : true,
      placement: Boolean(character && player.placementGames < PLACEMENT_GAMES),
      thinking: false,
      dead: [],
      accepted: [],
      updatedAt: Date.now(),
    };
    this.queue.delete(player.id);
    this.state.matches[match.id] = match;
    return match;
  }
  private join(player: Profile, match: Match) {
    player = this.state.profiles[player.id];
    this.assertFree(player.id);
    if (match.status !== "waiting" || match.white)
      fail(409, "This table has already been taken.");
    if (match.black.id === player.id)
      fail(400, "Invite another player to this table.");
    match.white = seat(player);
    match.status = "playing";
    this.touch(match);
    this.queue.delete(player.id);
    return match;
  }
  private getMatch(id: string, player: Profile) {
    const match = this.state.matches[id];
    if (!match) return fail(404, "That game could not be found.");
    if (match.black.id !== player.id && match.white?.id !== player.id)
      return fail(403, "This game belongs to other players.");
    return match;
  }
  private count(match: Match) {
    const score = areaScore(match.position.board, new Set(match.dead));
    return { black: score.black, white: score.white + match.komi };
  }
  private finish(
    match: Match,
    winner: Color,
    reason: "score" | "resign",
    margin?: number,
  ) {
    const rankChanges: Record<string, string> = {};
    const now = BigInt(Math.floor(Date.now() / 1000));
    const black = this.state.profiles[match.black.id];
    const white =
      match.white!.kind === "human"
        ? this.state.profiles[match.white!.id]
        : null;
    const opponentRating = white
      ? rating(white)
      : anchorRating(MU_T[rankIndex(match.white!.rank)], now);
    const updated = update(
      rating(black),
      opponentRating,
      winner === 1 ? 2 : 0,
      now,
    );
    const rated =
      match.ranked &&
      match.position.moves.filter((move) => move.point !== null).length >=
        Math.min(20, match.size * 2);
    for (const [profile, value, color] of [
      [black, updated.black, 1],
      [white, updated.white, 2],
    ] as const) {
      if (!profile) continue;
      profile.games++;
      if (winner === color) profile.wins++;
      else profile.losses++;
      // Very short games still record the result, but cannot establish or
      // manipulate a rank by repeatedly resigning an empty board.
      if (rated) {
        profile.rating = packRating(value);
        profile.rank = rankLabel(rankTenths(value.mu));
        rankChanges[profile.id] = profile.rank;
        if (match.placement) profile.placementGames++;
      }
    }
    match.result = {
      winner,
      reason,
      ...(margin === undefined ? {} : { margin }),
      rated,
      rankChanges,
    };
    match.status = "finished";
    match.thinking = false;
    delete match.error;
    this.touch(match);
    this.jobs.get(match.id)?.abort();
  }
  private kick(id: string) {
    const match = this.state.matches[id];
    if (
      this.closed ||
      !match ||
      match.white?.kind !== "ai" ||
      this.jobs.has(id) ||
      match.error
    )
      return;
    if (
      match.status !== "scoring" &&
      !(match.status === "playing" && match.position.turn === 2)
    )
      return;
    if (match.status === "scoring" && match.accepted.includes(match.white.id))
      return;
    const controller = new AbortController();
    this.jobs.set(id, controller);
    void (async () => {
      const started = await this.transaction(() => {
        const current = this.state.matches[id];
        if (
          controller.signal.aborted ||
          this.closed ||
          !current ||
          !["playing", "scoring"].includes(current.status)
        )
          return false;
        current.thinking = true;
        this.touch(current);
        return true;
      });
      if (!started) return;
      const current = this.state.matches[id];
      const version = current.version;
      const scoring = current.status === "scoring";
      try {
        const result = scoring
          ? await this.engine.analyze(
              current.position,
              current.komi,
              undefined,
              controller.signal,
            )
          : await this.engine.move(
              current.position,
              current.komi,
              current.white!.rank,
              controller.signal,
            );
        await this.transaction(() => {
          const game = this.state.matches[id];
          if (
            controller.signal.aborted ||
            game.version !== version ||
            !["playing", "scoring"].includes(game.status)
          )
            return;
          game.thinking = false;
          if (scoring) {
            const ownership = (result as { ownership?: number[] }).ownership;
            const dead = deadStones(game.position, ownership);
            game.dead = [...dead];
            game.score = this.count(game);
            game.accepted = [game.white!.id];
          } else {
            game.position = play(game.position, result as number | null);
            if (game.position.paused) {
              game.status = "scoring";
              game.score = this.count(game);
            }
          }
          this.touch(game);
        });
      } catch (error) {
        if (!controller.signal.aborted && !this.closed)
          await this.transaction(() => {
            const game = this.state.matches[id];
            if (!["playing", "scoring"].includes(game.status)) return;
            game.thinking = false;
            game.error = (error as Error).message;
            this.touch(game);
          });
      }
    })()
      .catch((error) => console.error("Lobby AI job:", error))
      .finally(() => {
        this.jobs.delete(id);
        if (!this.closed) this.kick(id);
      });
  }
  private lobby(player: Profile): Lobby {
    player = this.state.profiles[player.id];
    const now = Date.now();
    for (const [id, at] of this.seen)
      if (now - at > 45_000) this.seen.delete(id);
    for (const [id, entry] of this.queue)
      if (!this.seen.has(id) || now - entry.at > 180_000) this.queue.delete(id);
    return {
      player: publicPlayer(player),
      activeMatch: this.active(player.id)?.id ?? null,
      queued: this.queue.has(player.id),
      tables: Object.values(this.state.matches)
        .filter(
          (match) =>
            match.status === "waiting" &&
            match.visibility === "public" &&
            this.seen.has(match.black.id),
        )
        .map((match) => ({
          id: match.id,
          host: match.black,
          size: match.size,
          ranked: match.ranked,
        })),
      humans: [...this.seen.keys()]
        .map((id) => this.state.profiles[id])
        .filter(Boolean)
        .map((profile) => ({
          id: profile.id,
          name: profile.name,
          rank: profile.rank,
          playing: Boolean(this.active(profile.id)?.white),
        })),
      engine: this.engine.status(),
    };
  }
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const send = (status: number, value: unknown) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(JSON.stringify(value));
    };
    try {
      await this.loaded;
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (this.closed) fail(503, "The lobby is restarting.");
      if (request.method !== "GET" && request.method !== "POST")
        fail(405, "Method not allowed.");
      const origin = request.headers.origin;
      if (
        origin &&
        origin !== `http://${request.headers.host}` &&
        origin !== `https://${request.headers.host}` &&
        !this.options.allowedOrigins?.includes(origin)
      )
        fail(403, "This origin cannot access the lobby.");
      const ip = request.socket.remoteAddress ?? "local";
      const now = Date.now();
      for (const [key, value] of this.rates)
        if (now - value.at > 60_000) this.rates.delete(key);
      const bearer =
        request.headers.authorization?.replace(/^Bearer /, "") ?? "";
      const rateKey = /^[a-f0-9]{64}$/.test(bearer)
        ? `${ip}:${digest(bearer)}`
        : ip;
      if (this.rates.size >= 10_000 && !this.rates.has(rateKey))
        fail(429, "Please try again shortly.");
      const rate = this.rates.get(rateKey) ?? { at: now, count: 0 };
      this.rates.set(rateKey, rate);
      if (++rate.count > 360)
        fail(429, "Please slow down and try again shortly.");
      let body: Record<string, unknown> = {};
      if (request.method === "POST") {
        request.setEncoding("utf8");
        let text = "";
        for await (const chunk of request) {
          text += chunk;
          if (Buffer.byteLength(text) > 65_536) fail(413, "Request too large.");
        }
        try {
          body = JSON.parse(text);
        } catch {
          fail(400, "Send a JSON request.");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          fail(400, "Send a JSON object.");
      }
      if (path.startsWith("/api/katago")) {
        send(200, await this.legacy(path, request.method!, body));
        return;
      }
      if (path === "/api/lobby/status" && request.method === "GET") {
        void this.engine.ready().catch(() => {});
        send(200, {
          humans: [...this.seen.values()].filter((at) => now - at <= 45_000)
            .length,
          engine: this.engine.status(),
        });
        return;
      }
      if (path === "/api/lobby/session" && request.method === "POST") {
        const token = randomBytes(32).toString("hex");
        const result = await this.transaction(() => {
          if (Object.keys(this.state.profiles).length >= 10_000)
            fail(503, "New player registration is temporarily closed.");
          const name = nameOf(body.name);
          const rank =
            typeof body.rank === "string" && RANKS.includes(body.rank)
              ? body.rank
              : "20k";
          const player: Profile = {
            id: randomUUID(),
            name,
            rank,
            games: 0,
            placementGames: 0,
            wins: 0,
            losses: 0,
            tokenHash: digest(token),
            rating: { mu: String(MU_T[rankIndex(rank)]), phi: "0", last: "0" },
          };
          this.state.profiles[player.id] = player;
          return { token, player: publicPlayer(player) };
        });
        this.seen.set(result.player.id, now);
        send(201, result);
        return;
      }
      const token =
        request.headers.authorization?.replace(/^Bearer /, "") ?? "";
      if (!/^[a-f0-9]{64}$/.test(token))
        fail(401, "Enter the lobby to start playing.");
      const tokenHash = digest(token);
      const player = Object.values(this.state.profiles).find(
        (profile) => profile.tokenHash === tokenHash,
      );
      if (!player)
        return fail(
          401,
          "Your player session has expired. Enter the lobby again.",
        );
      this.seen.set(player.id, now);
      if (path === "/api/lobby" && request.method === "GET") {
        void this.engine.ready().catch(() => {});
        send(200, this.lobby(player));
        return;
      }
      const matchRoute = /^\/api\/lobby\/matches\/([a-f0-9-]+)$/.exec(path);
      if (matchRoute && request.method === "GET") {
        const match = this.getMatch(matchRoute[1], player);
        this.kick(match.id);
        send(200, match);
        return;
      }
      if (request.method !== "POST") fail(404, "Endpoint not found.");
      let result: unknown;
      if (path === "/api/lobby/profile")
        result = await this.transaction(() => {
          const current = this.state.profiles[player.id];
          current.name = nameOf(body.name);
          return publicPlayer(current);
        });
      else if (path === "/api/lobby/tables")
        result = await this.transaction(() =>
          this.newMatch(
            player,
            boardSize(body.size),
            body.private === true ? "private" : "public",
          ),
        );
      else if (path === "/api/lobby/ai")
        result = await this.transaction(() =>
          this.newMatch(player, boardSize(body.size), "private", {
            id: String(body.characterId),
          }),
        );
      else if (path === "/api/lobby/join")
        result = await this.transaction(() => {
          const code =
            typeof body.code === "string"
              ? body.code.replace(/[^a-z0-9]/gi, "").toUpperCase()
              : undefined;
          const match = code
            ? Object.values(this.state.matches).find(
                (match) => match.code === code,
              )
            : this.state.matches[String(body.id)];
          if (!match || (match.visibility === "private" && code !== match.code))
            return fail(404, "That table or invitation could not be found.");
          return this.join(player, match);
        });
      else if (path === "/api/lobby/queue/cancel") {
        this.queue.delete(player.id);
        result = { queued: false };
      } else if (path === "/api/lobby/queue")
        result = await this.transaction(() => {
          const size = boardSize(body.size);
          this.assertFree(player.id);
          const candidate = [...this.queue.entries()].find(
            ([id, entry]) =>
              id !== player.id &&
              entry.size === size &&
              this.seen.has(id) &&
              Date.now() - entry.at < 180_000 &&
              !this.active(id) &&
              Math.abs(
                rankIndex(this.state.profiles[id].rank) -
                  rankIndex(player.rank),
              ) <= 3,
          );
          const table = Object.values(this.state.matches).find(
            (match) =>
              match.status === "waiting" &&
              match.visibility === "public" &&
              match.size === size &&
              match.black.id !== player.id &&
              this.seen.has(match.black.id) &&
              Math.abs(rankIndex(match.black.rank) - rankIndex(player.rank)) <=
                3,
          );
          if (table) return { match: this.join(player, table), queued: false };
          if (candidate) {
            const match = this.newMatch(
              this.state.profiles[candidate[0]],
              size,
              "public",
            );
            return { match: this.join(player, match), queued: false };
          }
          if (body.opponent !== "human")
            return {
              match: this.newMatch(player, size, "private", {
                id: recommendedCharacter(player.rank).id,
              }),
              queued: false,
            };
          this.queue.set(player.id, { size, at: now });
          return { match: null, queued: true };
        });
      else if (matchRoute)
        result = await this.transaction(() =>
          this.action(this.getMatch(matchRoute[1], player), player, body),
        );
      else fail(404, "Endpoint not found.");
      const match = (result as { match?: Match })?.match ?? (result as Match);
      if (match?.id && this.state.matches[match.id]) this.kick(match.id);
      send(200, result);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      if (status === 503 && !(error instanceof HttpError))
        console.error("Lobby request:", error);
      send(status, {
        error:
          status === 503
            ? "The lobby or AI is unavailable. Please try again shortly."
            : (error as Error).message,
      });
    }
  }
  private action(match: Match, player: Profile, body: Record<string, unknown>) {
    if (body.version !== match.version)
      fail(409, "The game changed. Refresh and try again.");
    if (["finished", "cancelled"].includes(match.status))
      fail(409, "This game has already ended.");
    const color: Color = player.id === match.black.id ? 1 : 2;
    if (body.action === "cancel") {
      if (match.status !== "waiting")
        fail(409, "Resign to leave a game in progress.");
      match.status = "cancelled";
    } else if (body.action === "resign") {
      if (match.status === "waiting")
        fail(409, "Cancel the table to leave it.");
      this.finish(match, color === 1 ? 2 : 1, "resign");
      return match;
    } else if (body.action === "retry") {
      if (!match.error || match.white?.kind !== "ai")
        fail(409, "There is no AI move to retry.");
      delete match.error;
    } else if (body.action === "move") {
      if (
        match.status !== "playing" ||
        match.position.turn !== color ||
        match.thinking
      )
        fail(409, "Wait for your turn.");
      if (
        match.position.moves.length >= match.size * match.size * 6 &&
        body.point !== null
      )
        fail(
          409,
          "This game has reached its move limit. Pass to count or resign.",
        );
      if (body.point !== null && !Number.isInteger(body.point))
        fail(400, "Choose an intersection or pass.");
      try {
        match.position = play(match.position, body.point as number | null);
      } catch (error) {
        fail(400, (error as Error).message);
      }
      if (match.position.paused) {
        match.status = "scoring";
        match.score = this.count(match);
      }
    } else if (body.action === "dead") {
      if (match.status !== "scoring" || match.white?.kind === "ai")
        fail(
          409,
          "Dead stones can be agreed between human players during counting.",
        );
      const point = Number(body.point);
      if (
        !Number.isInteger(point) ||
        point < 0 ||
        point >= match.position.board.length ||
        !match.position.board[point]
      )
        fail(400, "Choose a group of stones.");
      const group = [...groupAt(match.position.board, point).stones];
      const dead = new Set(match.dead);
      const remove = dead.has(point);
      group.forEach((stone) => (remove ? dead.delete(stone) : dead.add(stone)));
      match.dead = [...dead];
      match.accepted = [];
      match.score = this.count(match);
    } else if (body.action === "accept") {
      if (match.status !== "scoring" || match.thinking || match.error)
        fail(409, "Wait for the count to finish.");
      if (
        match.white?.kind === "ai" &&
        !match.accepted.includes(match.white.id)
      )
        fail(409, "Wait for the AI's count.");
      if (!match.accepted.includes(player.id)) match.accepted.push(player.id);
      if (match.accepted.length === 2) {
        const score = this.count(match);
        this.finish(
          match,
          score.black > score.white ? 1 : 2,
          "score",
          Math.abs(score.black - score.white),
        );
        return match;
      }
    } else if (body.action === "resume") {
      if (match.status !== "scoring" || match.thinking)
        fail(409, "Wait for the count to finish.");
      match.position = { ...match.position, paused: false, passes: 0 };
      match.status = "playing";
      match.dead = [];
      match.accepted = [];
      delete match.score;
      delete match.error;
    } else fail(400, "Unknown game action.");
    this.touch(match);
    return match;
  }
  private async legacy(
    path: string,
    method: string,
    body: Record<string, unknown>,
  ) {
    if (
      (path === "/api/katago" || path === "/api/katago/") &&
      method === "GET"
    ) {
      await this.engine.ready();
      return { name: "KataGo", human: this.engine.status().human };
    }
    if (
      method !== "POST" ||
      !["/api/katago/move", "/api/katago/score"].includes(path)
    )
      return fail(404, "Endpoint not found.");
    const size = body.size as number;
    const komi = body.komi as number;
    if (
      !Number.isInteger(size) ||
      size < 2 ||
      size > 19 ||
      !Number.isFinite(komi) ||
      Math.abs(komi) > 400 ||
      !Array.isArray(body.moves) ||
      body.moves.length > size * size * 6
    )
      fail(400, "Invalid board or move history.");
    let position: Position = emptyPosition(size);
    for (const move of body.moves as unknown[]) {
      if (
        typeof move !== "string" ||
        !/^[BW] (?:pass|[A-HJ-T](?:1[0-9]|[1-9]))$/.test(move)
      )
        fail(400, "Invalid move.");
      const [color, vertex] = (move as string).split(" ");
      if ((position.turn === 1 ? "B" : "W") !== color)
        fail(400, "Invalid move order.");
      try {
        position = play(
          { ...position, paused: false, passes: 0 },
          vertex === "pass" ? null : pointFromCoordinate(vertex, size),
        );
      } catch {
        fail(400, "Invalid move history.");
      }
    }
    if (path.endsWith("/move")) {
      if (body.color !== (position.turn === 1 ? "B" : "W"))
        fail(400, "Invalid player to move.");
      const point = await this.engine.move(position, komi, String(body.rank));
      return {
        move:
          point === null
            ? "pass"
            : `${"ABCDEFGHJKLMNOPQRST"[point % size]}${size - Math.floor(point / size)}`,
      };
    }
    const result = await this.engine.analyze(position, komi);
    const dead = deadStones(position, result.ownership);
    const score = areaScore(position.board, dead);
    const lead = score.black - score.white - komi;
    return {
      score: lead === 0 ? "0" : `${lead > 0 ? "B" : "W"}+${Math.abs(lead)}`,
    };
  }
  async close() {
    this.closed = true;
    for (const controller of this.jobs.values()) controller.abort();
    this.engine.close();
    await this.writes;
  }
}
