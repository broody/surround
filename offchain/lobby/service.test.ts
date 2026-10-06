import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyPosition,
  play,
  type Position,
} from "../../apps/web/src/game/rules.ts";
import type { Lobby, Match, Player } from "../../shared/lobby.ts";
import { LobbyService, type LobbyOptions } from "./service.ts";
import {
  RESIGN,
  chooseHumanMove,
  type Analysis,
  type EngineAPI,
} from "./engine.ts";
import { deadStones } from "./scoring.ts";

class FakeEngine implements EngineAPI {
  ranks: string[] = [];
  deferred: ((point: number | null) => void) | null = null;
  defer = false;
  fail = false;
  available = true;
  passOnPass = false;
  hopeless = false;
  status() {
    return {
      state: this.available ? ("ready" as const) : ("unavailable" as const),
      human: this.available,
      pending: 0,
    };
  }
  async ready() {}
  async analyze(position: Position): Promise<Analysis> {
    return {
      id: "test",
      ownership: position.board.map(() => 0),
      rootInfo: { scoreLead: -6.5 },
    };
  }
  async move(position: Position, _komi: number, rank: string) {
    this.ranks.push(rank);
    if (this.fail) throw new Error("Test engine unavailable");
    return { point: await this.pick(position), hopeless: this.hopeless };
  }
  private async pick(position: Position): Promise<number | null> {
    if (this.passOnPass && position.moves.at(-1)?.point === null) return null;
    if (this.defer)
      return new Promise((resolve) => {
        this.deferred = resolve;
      });
    for (let point = position.board.length - 1; point >= 0; point--) {
      try {
        play(position, point);
        return point;
      } catch {}
    }
    return null;
  }
  close() {
    this.deferred?.(null);
  }
}
type Session = { token: string; player: Player };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function harness(options: LobbyOptions = {}) {
  const engine = options.engine ?? new FakeEngine();
  const service = new LobbyService({ ...options, engine });
  const server = createServer((req, res) => void service.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await service.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  cleanup.push(close);
  async function call<T>(
    path: string,
    session?: Session,
    body?: object,
    expected = 200,
  ): Promise<T> {
    const response = await fetch(`${url}/api/lobby${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...(session ? { authorization: `Bearer ${session.token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result as T;
  }
  const player = (name: string, rank = "20k") =>
    call<Session>("/session", undefined, { name, rank }, 201);
  const game = (id: string, who: Session) => call<Match>(`/matches/${id}`, who);
  const action = async (
    id: string,
    who: Session,
    action: string,
    point?: number | null,
  ) => {
    const match = await game(id, who);
    return call<Match>(`/matches/${id}`, who, {
      action,
      version: match.version,
      ...(point === undefined ? {} : { point }),
    });
  };
  const settled = async (id: string, who: Session) => {
    for (let i = 0; i < 100; i++) {
      const match = await game(id, who);
      if (
        !match.thinking &&
        (match.position.turn === 1 || match.status !== "playing" || match.error)
      )
        return match;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("AI never completed its move");
  };
  return {
    engine: engine as FakeEngine,
    call,
    player,
    game,
    action,
    settled,
    close,
    url,
  };
}
test("sessions and human seats are private; moves are authoritative and versioned", async () => {
  const h = await harness();
  const alice = await h.player("Alice");
  const bob = await h.player("Bob");
  const eve = await h.player("Eve");
  await h.call("", undefined, undefined, 401);
  const status = await h.call<{ humans: number; engine: { human: boolean } }>(
    "/status",
  );
  assert.equal(status.humans, 3);
  assert.equal(status.engine.human, true);
  assert.deepEqual(Object.keys(status).sort(), ["engine", "humans"]);
  const table = await h.call<Match>("/tables", alice, { size: 9 });
  await h.call(`/matches/${table.id}`, eve, undefined, 403);
  const match = await h.call<Match>("/join", bob, { id: table.id });
  await h.call("/join", eve, { id: table.id }, 409);
  await h.call(
    `/matches/${match.id}`,
    bob,
    { action: "move", point: 0, version: match.version },
    409,
  );
  const moved = await h.action(match.id, alice, "move", 0);
  assert.equal(moved.position.board[0], 1);
  await h.call(
    `/matches/${match.id}`,
    alice,
    { action: "move", point: 1, version: match.version },
    409,
  );
  await h.call(
    `/matches/${match.id}`,
    bob,
    { action: "move", point: 0, version: moved.version },
    400,
  );
  const next = await h.action(match.id, bob, "move", 1);
  assert.equal(next.position.board[1], 2);
});
test("private codes are hidden from the hall and an ID cannot bypass the invitation", async () => {
  const h = await harness();
  const alice = await h.player("Alice");
  const bob = await h.player("Bob");
  const table = await h.call<Match>("/tables", alice, {
    size: 13,
    private: true,
  });
  assert.match(table.code!, /^[A-F0-9]{12}$/);
  const lobby = await h.call<Lobby>("", bob);
  assert.equal(lobby.tables.length, 0);
  await h.call("/join", bob, { id: table.id }, 404);
  const match = await h.call<Match>("/join", bob, {
    code: table.code!.toLowerCase(),
  });
  assert.equal(match.status, "playing");
});
test("human queue pairs compatible players and stays separate across board sizes", async () => {
  const h = await harness();
  const alice = await h.player("Alice");
  const bob = await h.player("Bob");
  const dan = await h.player("Dan", "1d");
  assert.equal(
    (
      await h.call<{ queued: boolean }>("/queue", alice, {
        size: 9,
        opponent: "human",
      })
    ).queued,
    true,
  );
  assert.equal(
    (
      await h.call<{ queued: boolean }>("/queue", dan, {
        size: 9,
        opponent: "human",
      })
    ).queued,
    true,
  );
  assert.equal(
    (
      await h.call<{ queued: boolean }>("/queue", bob, {
        size: 13,
        opponent: "human",
      })
    ).queued,
    true,
  );
  const result = await h.call<{ match: Match }>("/queue", bob, {
    size: 9,
    opponent: "human",
  });
  assert.equal(result.match.black.id, alice.player.id);
  assert.equal(result.match.white!.id, bob.player.id);
  assert.equal((await h.call<Lobby>("", alice)).activeMatch, result.match.id);
  assert.equal((await h.call<Lobby>("", alice)).queued, false);
  await h.call("/queue/cancel", dan, {});
  assert.equal((await h.call<Lobby>("", dan)).queued, false);
});
test("double passes require both humans to agree; dead changes invalidate agreement", async () => {
  const h = await harness();
  const alice = await h.player("Alice");
  const bob = await h.player("Bob");
  const table = await h.call<Match>("/tables", alice, { size: 9 });
  await h.call("/join", bob, { id: table.id });
  await h.action(table.id, alice, "move", 0);
  await h.action(table.id, bob, "move", 80);
  await h.action(table.id, alice, "move", null);
  const counting = await h.action(table.id, bob, "move", null);
  assert.equal(counting.status, "scoring");
  await h.action(table.id, alice, "accept");
  const marked = await h.action(table.id, bob, "dead", 0);
  assert.deepEqual(marked.accepted, []);
  assert.deepEqual(marked.dead, [0]);
  await h.action(table.id, alice, "accept");
  const finished = await h.action(table.id, bob, "accept");
  assert.equal(finished.status, "finished");
  const profile = await h.call<Lobby>("", alice);
  assert.equal(profile.player.games, 1);
  assert.equal(profile.player.placementGames, 0);
  await h.call(
    `/matches/${table.id}`,
    alice,
    { action: "accept", version: finished.version },
    409,
  );
  assert.equal((await h.call<Lobby>("", alice)).player.games, 1);
});
test("resuming counting clears dead groups and preserves the next player's turn", async () => {
  const h = await harness();
  const alice = await h.player("Alice");
  const bob = await h.player("Bob");
  const table = await h.call<Match>("/tables", alice, { size: 9 });
  await h.call("/join", bob, { id: table.id });
  await h.action(table.id, alice, "move", null);
  await h.action(table.id, bob, "move", null);
  const resumed = await h.action(table.id, bob, "resume");
  assert.equal(resumed.status, "playing");
  assert.equal(resumed.position.turn, 1);
  assert.equal(resumed.position.paused, false);
  await h.action(table.id, alice, "move", 40);
});
test("AI games share the engine while each character keeps its own fixed strength", async () => {
  const h = await harness();
  const alice = await h.player("Alice", "10k");
  const bob = await h.player("Bob", "1d");
  const a = await h.call<Match>("/ai", alice, {
    size: 9,
    characterId: "nanami",
  });
  const b = await h.call<Match>("/ai", bob, {
    size: 13,
    characterId: "luc",
  });
  assert.equal(a.white!.rank, "5k");
  assert.equal(b.white!.rank, "1d");
  await Promise.all([
    h.action(a.id, alice, "move", 0),
    h.action(b.id, bob, "move", 0),
  ]);
  const [first, second] = await Promise.all([
    h.settled(a.id, alice),
    h.settled(b.id, bob),
  ]);
  assert.equal(first.position.moves.length, 2);
  assert.equal(second.position.moves.length, 2);
  assert.deepEqual(h.engine.ranks.sort(), ["1d", "5k"]);
});
test("late AI replies cannot change a resigned game", async () => {
  const h = await harness();
  h.engine.defer = true;
  const alice = await h.player("Alice");
  const match = await h.call<Match>("/ai", alice, {
    size: 9,
    characterId: "yuna",
  });
  await h.action(match.id, alice, "move", 0);
  for (let i = 0; i < 20 && !h.engine.deferred; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  await h.action(match.id, alice, "resign");
  h.engine.deferred!(80);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const finished = await h.game(match.id, alice);
  assert.equal(finished.status, "finished");
  assert.equal(finished.position.moves.length, 1);
  assert.equal(finished.thinking, false);
  assert.equal((await h.call<Lobby>("", alice)).player.placementGames, 0);
});
test("the AI resigns once it has been hopeless for RESIGN.turns turns in a row", async () => {
  const h = await harness();
  const alice = await h.player("Alice");
  const match = await h.call<Match>("/ai", alice, {
    size: 19,
    characterId: "yuna",
  });
  let next = 0;
  const turn = async (hopeless: boolean) => {
    h.engine.hopeless = hopeless;
    await h.action(match.id, alice, "move", next++);
    return h.settled(match.id, alice);
  };
  for (let i = 1; i < RESIGN.turns; i++) await turn(true);
  // One estimate that isn't hopeless starts the count again.
  await turn(false);
  for (let i = 1; i < RESIGN.turns; i++)
    assert.equal((await turn(true)).status, "playing");
  const resigned = await turn(true);
  assert.equal(resigned.status, "finished");
  assert.equal(resigned.result!.winner, 1);
  assert.equal(resigned.result!.reason, "resign");
  // It resigns instead of playing its last move.
  assert.equal(resigned.position.moves.length, 4 * RESIGN.turns - 1);
});
test("failed AI queries can be retried without duplicating human moves", async () => {
  const h = await harness();
  h.engine.fail = true;
  const alice = await h.player("Alice");
  const match = await h.call<Match>("/ai", alice, {
    size: 9,
    characterId: "yuna",
  });
  await h.action(match.id, alice, "move", 40);
  const failed = await h.settled(match.id, alice);
  assert.ok(failed.error);
  h.engine.fail = false;
  await h.action(match.id, alice, "retry");
  const recovered = await h.settled(match.id, alice);
  assert.equal(recovered.position.moves.length, 2);
  assert.equal(recovered.error, undefined);
});
test("five substantial AI results establish placement; subsequent AI games are practice", async () => {
  const h = await harness();
  const alice = await h.player("Alice");
  for (let game = 0; game < 5; game++) {
    const match = await h.call<Match>("/ai", alice, {
      size: 9,
      characterId: "yuna",
    });
    for (let turn = 0; turn < 9; turn++) {
      const current = await h.settled(match.id, alice);
      const point = current.position.board.findIndex((stone, point) => {
        if (stone) return false;
        try {
          play(current.position, point);
          return true;
        } catch {
          return false;
        }
      });
      await h.action(match.id, alice, "move", point);
      await h.settled(match.id, alice);
    }
    const finished = await h.action(match.id, alice, "resign");
    assert.ok(finished.result!.rankChanges[alice.player.id]);
  }
  const lobby = await h.call<Lobby>("", alice);
  assert.equal(lobby.player.placementGames, 5);
  const practice = await h.call<Match>("/ai", alice, {
    size: 9,
    characterId: "nanami",
  });
  assert.equal(practice.ranked, false);
  assert.equal(practice.placement, false);
});
test("profiles and active games survive restart without storing raw tokens", async () => {
  const dir = await mkdtemp(join(tmpdir(), "surround-lobby-test-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const dataFile = join(dir, "lobby.json");
  const h = await harness({ dataFile });
  const alice = await h.player("Alice");
  const table = await h.call<Match>("/tables", alice, {
    size: 19,
    private: true,
  });
  await h.close();
  const disk = await readFile(dataFile, "utf8");
  assert.ok(!disk.includes(alice.token));
  const restarted = await harness({ dataFile });
  const lobby = await restarted.call<Lobby>("", alice);
  assert.equal(lobby.player.id, alice.player.id);
  assert.equal(lobby.activeMatch, table.id);
  assert.equal((await restarted.game(table.id, alice)).code, table.code);
});
test("AI unavailable does not prevent human games", async () => {
  const engine = new FakeEngine();
  engine.available = false;
  const h = await harness({ engine });
  const alice = await h.player("Alice");
  await h.call(
    "/ai",
    alice,
    { size: 9, characterId: "yuna" },
    503,
  );
  assert.equal(
    (await h.call<Match>("/tables", alice, { size: 9 })).status,
    "waiting",
  );
});
test("human policy excludes illegal moves and premature passes", () => {
  const position = play(emptyPosition(9), 0);
  const policy = Array(82).fill(0);
  policy[0] = 0.99;
  policy[40] = 0.1;
  policy[81] = 1;
  assert.equal(
    chooseHumanMove(
      position,
      {
        id: "test",
        humanPolicy: policy,
        moveInfos: [{ move: "E5", order: 0 }],
      },
      () => 0,
    ),
    40,
  );
  assert.equal(
    chooseHumanMove(position, {
      id: "test",
      humanPolicy: policy,
      moveInfos: [{ move: "pass", order: 0 }],
    }),
    null,
  );
});
test("AI counting requires its estimate, and the player can accept or resume", async () => {
  const h = await harness();
  h.engine.passOnPass = true;
  const alice = await h.player("Alice");
  const match = await h.call<Match>("/ai", alice, {
    size: 9,
    characterId: "nanami",
  });
  await h.action(match.id, alice, "move", null);
  let counting: Match = await h.game(match.id, alice);
  for (
    let i = 0;
    i < 30 && !counting.accepted.includes(counting.white!.id);
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    counting = await h.game(match.id, alice);
  }
  assert.equal(counting.status, "scoring");
  assert.deepEqual(counting.score, { black: 0, white: 6.5 });
  await h.call(
    `/matches/${match.id}`,
    alice,
    { action: "dead", point: 0, version: counting.version },
    409,
  );
  const resumed = await h.action(match.id, alice, "resume");
  assert.equal(resumed.status, "playing");
  await h.action(match.id, alice, "move", null);
  for (let i = 0; i < 30; i++) {
    counting = await h.game(match.id, alice);
    if (counting.accepted.includes(counting.white!.id)) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const finished = await h.action(match.id, alice, "accept");
  assert.equal(finished.status, "finished");
  assert.equal(finished.result!.winner, 2);
  assert.equal(finished.result!.rated, false);
});
test("AI dead-group scoring uses Black ownership and rejects malformed estimates", () => {
  const position = emptyPosition(9);
  position.board[0] = 1;
  position.board[1] = 1;
  position.board[80] = 2;
  const ownership = Array(81).fill(0);
  ownership[0] = -1;
  ownership[1] = -1;
  ownership[80] = 1;
  assert.deepEqual(
    [...deadStones(position, ownership)].sort((a, b) => a - b),
    [0, 1, 80],
  );
  assert.throws(() => deadStones(position, [0]), /usable score/);
  ownership[40] = NaN;
  assert.throws(() => deadStones(position, ownership), /usable score/);
});
