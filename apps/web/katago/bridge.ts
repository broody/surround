import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// Local-only: the dev server runs KataGo as a GTP engine so the play page can
// seat it as an opponent. Every request replays the whole game, so take-backs
// and new games need no engine-side state.

export type KatagoEnv = {
  KATAGO_BIN?: string;
  KATAGO_MODEL?: string;
  /** KataGo's human SL network; KataGo then imitates a player of a chosen rank. */
  KATAGO_HUMAN_MODEL?: string;
  KATAGO_CONFIG?: string;
};

const MOVE = /^[BW] (?:pass|[A-HJ-T](?:1[0-9]|[1-9]))$/;
const RANK = /^(?:(?:[1-9]|1[0-9]|20)k|[1-9]d)$/;

class Engine {
  private output = "";
  private log = "";
  private waiting: ((reply: string) => void)[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private failure: Error | null = null;
  private process: ChildProcessWithoutNullStreams;

  constructor(bin: string, args: string[]) {
    this.process = spawn(bin, ["gtp", ...args]);
    this.process.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      this.output += chunk;
      let end;
      while ((end = this.output.indexOf("\n\n")) >= 0) {
        const reply = this.output.slice(0, end);
        this.output = this.output.slice(end + 2);
        this.waiting.shift()?.(reply);
      }
    });
    this.process.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      this.log = (this.log + chunk).slice(-2000);
    });
    this.process.on("error", (error) => this.fail(error.message));
    this.process.on("exit", (code, signal) =>
      this.fail(`KataGo exited (${signal ?? code}). ${this.log.trim()}`),
    );
  }

  get alive() {
    return !this.failure;
  }

  private fail(message: string) {
    this.failure ??= new Error(message);
    for (const resolve of this.waiting.splice(0)) resolve(`? ${message}`);
  }

  private command(line: string) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<string>((resolve, reject) => {
      this.waiting.push((reply) =>
        reply.startsWith("=")
          ? resolve(reply.slice(1).trim())
          : reject(new Error(`${line}: ${reply.slice(1).trim()}`)),
      );
      this.process.stdin.write(`${line}\n`);
    });
  }

  /** Runs commands in order, without interleaving other requests' commands. */
  run(lines: string[]) {
    const result = this.queue.then(async () => {
      let reply = "";
      for (const line of lines) reply = await this.command(line);
      return reply;
    });
    this.queue = result.catch(() => {});
    return result;
  }

  close() {
    this.process.kill();
  }
}

async function readJson(request: IncomingMessage) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 65536) throw new Error("Request too large.");
  }
  return JSON.parse(body) as Record<string, unknown>;
}

/** GTP commands that set up the game in a request body. */
function setup(body: Record<string, unknown>) {
  const { size, komi, moves } = body;
  if (!Number.isInteger(size) || (size as number) < 2 || (size as number) > 19)
    throw new Error("Board size must be 2 to 19.");
  if (!Number.isFinite(komi) || Math.abs(komi as number) > 400)
    throw new Error("Komi must be a number.");
  if (!Array.isArray(moves) || !moves.every((move) => MOVE.test(move)))
    throw new Error('Moves must look like "B D16" or "W pass".');
  return [
    `boardsize ${size}`,
    "clear_board",
    `komi ${komi}`,
    ...moves.map((move) => `play ${move}`),
  ];
}

export default function katago(env: KatagoEnv): Plugin {
  const human = Boolean(env.KATAGO_HUMAN_MODEL);
  const config =
    env.KATAGO_CONFIG ??
    fileURLToPath(new URL(human ? "human.cfg" : "gtp.cfg", import.meta.url));
  let engine: Engine | null = null;

  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (!env.KATAGO_MODEL)
      throw new Error(
        "Set KATAGO_MODEL (and KATAGO_BIN) in apps/web/.env.local, then restart the dev server.",
      );
    if (!engine?.alive) {
      engine?.close();
      engine = new Engine(env.KATAGO_BIN ?? "katago", [
        "-model",
        env.KATAGO_MODEL,
        ...(human ? ["-human-model", env.KATAGO_HUMAN_MODEL!] : []),
        "-config",
        config,
      ]);
    }
    let reply;
    if (request.method === "GET" && request.url === "/")
      reply = { name: await engine.run(["name"]), human };
    else if (request.method === "POST" && request.url === "/move") {
      const body = await readJson(request);
      if (body.color !== "B" && body.color !== "W")
        throw new Error('Color must be "B" or "W".');
      if (body.rank !== undefined && !RANK.test(String(body.rank)))
        throw new Error("Rank must be 20k to 1k or 1d to 9d.");
      const rank =
        human && body.rank ? [`kata-set-param humanSLProfile rank_${body.rank}`] : [];
      reply = {
        move: await engine.run([
          ...setup(body),
          ...rank,
          `genmove ${body.color}`,
        ]),
      };
    } else if (request.method === "POST" && request.url === "/score") {
      const body = await readJson(request);
      reply = { score: await engine.run([...setup(body), "final_score"]) };
    } else {
      response.statusCode = 404;
      reply = { error: "Not found." };
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(reply));
  }

  return {
    name: "surround-katago",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/katago", (request, response) => {
        handle(request, response).catch((error: Error) => {
          response.statusCode = 503;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: error.message }));
        });
      });
      server.httpServer?.on("close", () => engine?.close());
    },
  };
}
