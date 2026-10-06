import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { randomUUID, randomInt } from "node:crypto";
import {
  areaScore,
  coordinate,
  play,
  pointFromCoordinate,
  type Position,
} from "../../apps/web/src/game/rules.ts";
import { RANKS } from "../../shared/lobby.ts";
import { deadStones } from "./scoring.ts";

export type EngineEnv = {
  KATAGO_BIN?: string;
  KATAGO_MODEL?: string;
  KATAGO_HUMAN_MODEL?: string;
  KATAGO_ANALYSIS_CONFIG?: string;
};
export type Analysis = {
  id: string;
  humanPolicy?: number[];
  moveInfos?: { move: string; order: number }[];
  ownership?: number[];
  rootInfo?: { scoreLead: number; winrate?: number };
  models?: { usesHumanSLProfile: boolean }[];
  version?: string;
};
export type EngineAPI = {
  status(): {
    state: "starting" | "ready" | "unavailable";
    human: boolean;
    pending: number;
  };
  ready(): Promise<void>;
  analyze(
    position: Position,
    komi: number,
    rank?: string,
    signal?: AbortSignal,
  ): Promise<Analysis>;
  /**
   * A move at `rank`'s human strength, or KataGo's best without a rank, and
   * whether the side to move looked `hopeless` before playing it.
   */
  move(
    position: Position,
    komi: number,
    rank?: string,
    signal?: AbortSignal,
  ): Promise<{ point: number | null; hopeless: boolean }>;
  close(): void;
};
export class KataGo implements EngineAPI {
  private child: ChildProcessWithoutNullStreams | null = null;
  private waiting = new Map<
    string,
    {
      resolve: (result: Analysis) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >();
  private startup: Promise<void> | null = null;
  private state: "starting" | "ready" | "unavailable" = "unavailable";
  private human = false;
  private nextStart = 0;
  private closed = false;
  private env: EngineEnv;
  constructor(env: EngineEnv) {
    this.env = env;
  }
  status() {
    return { state: this.state, human: this.human, pending: this.waiting.size };
  }
  ready(): Promise<void> {
    if (this.closed)
      return Promise.reject(new Error("The engine is shutting down."));
    if (this.state === "ready") return Promise.resolve();
    if (this.startup) return this.startup;
    if (!this.env.KATAGO_MODEL || Date.now() < this.nextStart)
      return Promise.reject(
        new Error("AI opponents are temporarily unavailable."),
      );
    this.state = "starting";
    const child = spawn(this.env.KATAGO_BIN ?? "katago", [
      "analysis",
      "-model",
      this.env.KATAGO_MODEL,
      "-config",
      this.env.KATAGO_ANALYSIS_CONFIG ??
        fileURLToPath(new URL("analysis.cfg", import.meta.url)),
      "-override-config",
      "reportAnalysisWinratesAs=BLACK",
      ...(this.env.KATAGO_HUMAN_MODEL
        ? ["-human-model", this.env.KATAGO_HUMAN_MODEL]
        : []),
    ]);
    this.child = child;
    const fail = (error: Error) => {
      if (this.child !== child) return;
      this.child = null;
      this.state = "unavailable";
      this.human = false;
      this.nextStart = Date.now() + 5000;
      for (const item of this.waiting.values()) {
        item.cleanup();
        item.reject(error);
      }
      this.waiting.clear();
      child.kill();
    };
    child.on("error", () =>
      fail(
        new Error(
          "KataGo could not start. Check the server's engine configuration.",
        ),
      ),
    );
    child.on("exit", () =>
      fail(new Error("KataGo stopped. Retry your move in a moment.")),
    );
    child.stdin.on("error", () => fail(new Error("KataGo's input closed.")));
    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    createInterface({ input: child.stdout }).on("line", (line) => {
      let result: Analysis & {
        error?: string;
        warning?: string;
        isDuringSearch?: boolean;
        noResults?: boolean;
      };
      try {
        result = JSON.parse(line);
      } catch {
        return;
      }
      if (result.warning || result.isDuringSearch) return;
      const item = this.waiting.get(result.id);
      if (!item) return;
      this.waiting.delete(result.id);
      item.cleanup();
      if (result.error || result.noResults) {
        if (result.error) console.error("KataGo query rejected:", result.error);
        item.reject(
          new Error(
            result.error
              ? "The AI could not complete this move. Please retry."
              : "Analysis was cancelled.",
          ),
        );
      } else item.resolve(result);
    });
    this.startup = this.query({ action: "query_models" }, undefined, 120_000)
      .then((result) => {
        this.human =
          result.models?.some((model) => model.usesHumanSLProfile) ?? false;
        this.state = "ready";
      })
      .catch((error) => {
        fail(error);
        throw error;
      })
      .finally(() => {
        this.startup = null;
      });
    return this.startup;
  }
  private query(
    body: Record<string, unknown>,
    signal?: AbortSignal,
    timeout = 60_000,
  ): Promise<Analysis> {
    if (signal?.aborted)
      return Promise.reject(new Error("Analysis was cancelled."));
    if (!this.child)
      return Promise.reject(
        new Error("AI opponents are temporarily unavailable."),
      );
    if (this.waiting.size >= 32)
      return Promise.reject(
        new Error("The AI tables are busy. Please try again shortly."),
      );
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const item = this.waiting.get(id);
        if (!item) return;
        this.waiting.delete(id);
        item.cleanup();
        this.child?.stdin.write(
          `${JSON.stringify({ id: randomUUID(), action: "terminate", terminateId: id })}\n`,
        );
        reject(
          new Error(
            signal?.aborted
              ? "Analysis was cancelled."
              : "The AI took too long. Retry the move.",
          ),
        );
      };
      const timer = setTimeout(cancel, timeout);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      };
      this.waiting.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", cancel, { once: true });
      this.child!.stdin.write(`${JSON.stringify({ ...body, id })}\n`);
    });
  }
  async analyze(
    position: Position,
    komi: number,
    rank?: string,
    signal?: AbortSignal,
  ) {
    await this.ready();
    if (rank && (!RANKS.includes(rank) || !this.human))
      throw new Error("Ranked AI opponents require KataGo's human SL model.");
    const size = Math.sqrt(position.board.length);
    return this.query(
      {
        moves: position.moves.map(({ color, point }) => [
          color === 1 ? "B" : "W",
          point === null ? "pass" : coordinate(point, size),
        ]),
        boardXSize: size,
        boardYSize: size,
        initialPlayer: "B",
        rules: {
          ko: "POSITIONAL",
          scoring: "AREA",
          tax: "NONE",
          suicide: false,
          hasButton: false,
          whiteHandicapBonus: "0",
          friendlyPassOk: true,
        },
        komi,
        maxVisits: 64,
        includePolicy: Boolean(rank),
        includeOwnership: true,
        ...(rank
          ? {
              overrideSettings: {
                humanSLProfile: `rank_${rank}`,
                ignorePreRootHistory: false,
              },
            }
          : {}),
      },
      signal,
    );
  }
  async move(
    position: Position,
    komi: number,
    rank?: string,
    signal?: AbortSignal,
  ) {
    await this.ready();
    const human = this.human && rank !== undefined;
    const result = await this.analyze(
      position,
      komi,
      human ? rank : undefined,
      signal,
    );
    const choice = (point: number | null) => ({
      point,
      hopeless: hopeless(position, result),
    });
    // The opponent passed: end the game if that costs nothing.
    if (position.moves.at(-1)?.point === null && passIsEnough(position, komi, result))
      return choice(null);
    if (human) return choice(chooseHumanMove(position, result));
    const best = result.moveInfos?.find((move) => move.order === 0)?.move;
    if (!best) throw new Error("KataGo did not return a move.");
    if (best.toLowerCase() === "pass") return choice(null);
    const point = pointFromCoordinate(best, Math.sqrt(position.board.length));
    play(position, point);
    return choice(point);
  }
  close() {
    this.closed = true;
    for (const item of this.waiting.values()) {
      item.cleanup();
      item.reject(new Error("The engine is shutting down."));
    }
    this.waiting.clear();
    this.child?.kill();
    this.child = null;
    this.state = "unavailable";
  }
}
/** Points a pass may give up against KataGo's estimate: dame, and a 64-visit search's noise. */
export const PASS_TOLERANCE = 1;

/**
 * Whether the side to move can answer a pass with a pass. Two passes end the
 * game, scored by agreement: KataGo's dead stones taken off, then area. That
 * result is compared with KataGo's estimate of playing on (its root score
 * lead), and passing wins if it gives up at most `PASS_TOLERANCE` points.
 * KataGo's own value for a pass is no guide: after two passes it scores the
 * stones as they lie, dead ones too. Without this, the engine keeps filling
 * its own territory, which costs nothing under area scoring, and never ends.
 */
export function passIsEnough(
  position: Position,
  komi: number,
  result: Analysis,
  tolerance = PASS_TOLERANCE,
): boolean {
  const lead = result.rootInfo?.scoreLead;
  if (lead === undefined || !Number.isFinite(lead)) return false;
  let dead: Set<number>;
  try {
    dead = deadStones(position, result.ownership);
  } catch {
    return false;
  }
  const score = areaScore(position.board, dead);
  // Black's lead if the game ends now; KataGo reports leads for Black.
  const now = score.black - score.white - komi;
  const gain = position.turn === 1 ? now - lead : lead - now;
  return gain >= -tolerance;
}

/**
 * When a ranked AI gives up, after KataGo's human-like resignation
 * (cpp/configs/gtp_human5k_example.cfg): once moves fill 40% of the board,
 * behind by 20% of its area (16 points on 9×9, 72 on 19×19) with under 0.5%
 * to win. The margin is what a human opponent would have to blunder back;
 * KataGo's win rate assumes superhuman play from here, so it falls to zero
 * long before a kyu game is decided and only confirms the margin. The caller
 * resigns once this holds for `turns` of the side's turns in a row, so a short
 * search that misreads one capturing race or ko can't end the game.
 *
 * Tuned on 200 20k-vs-20k human SL games, where winners had trailed by up to
 * half a 9×9 board, it never resigned a game its side went on to win. The
 * same margin serves every rank: 1d games came back from deficits as large,
 * and on 200 of them it misjudged one, 80 points down for 40 turns before
 * the opponent lost a huge group.
 */
export const RESIGN = { moves: 0.4, lead: 0.2, winrate: 0.005, turns: 10 };

/** Whether the side to move is hopelessly behind by `result`'s estimate. */
export function hopeless(position: Position, result: Analysis): boolean {
  const lead = result.rootInfo?.scoreLead;
  const winrate = result.rootInfo?.winrate;
  if (!Number.isFinite(lead) || !Number.isFinite(winrate)) return false;
  // KataGo reports both for Black.
  const black = position.turn === 1;
  const area = position.board.length;
  return (
    position.moves.length >= RESIGN.moves * area &&
    (black ? lead! : -lead!) <= -RESIGN.lead * area &&
    (black ? winrate! : 1 - winrate!) < RESIGN.winrate
  );
}

// Sample the human policy at its native temperature. Fewer search visits by
// themselves do not make a superhuman network a calibrated beginner.
export function chooseHumanMove(
  position: Position,
  result: Analysis,
  random = () => randomInt(0, 0x1000000) / 0x1000000,
): number | null {
  const best = result.moveInfos?.find((move) => move.order === 0)?.move;
  if (best?.toLowerCase() === "pass") return null;
  if (
    !result.humanPolicy ||
    result.humanPolicy.length !== position.board.length + 1
  )
    throw new Error("KataGo did not return a human move policy.");
  const candidates: { point: number; weight: number }[] = [];
  result.humanPolicy.slice(0, -1).forEach((weight, point) => {
    if (!(weight > 0) || !Number.isFinite(weight)) return;
    try {
      play(position, point);
      candidates.push({ point, weight });
    } catch {
      /* Includes positional superko. */
    }
  });
  let sample =
    random() * candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  for (const candidate of candidates) {
    sample -= candidate.weight;
    if (sample < 0) return candidate.point;
  }
  if (candidates.length) return candidates[candidates.length - 1].point;
  if (best && best.toLowerCase() !== "pass") {
    const point = pointFromCoordinate(best, Math.sqrt(position.board.length));
    play(position, point);
    return point;
  }
  return null;
}
