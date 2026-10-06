import { resolve } from "node:path";
import type { Plugin } from "vite";
import { LobbyService } from "../../../offchain/lobby/service.ts";
import type { EngineEnv } from "../../../offchain/lobby/engine.ts";

// Dev mounts the same backend used in production. The multiplayer lobby and
// board sandbox share one analysis process, including the human SL model.
export default function lobby(env: EngineEnv & Record<string, string>): Plugin {
  return {
    name: "surround-lobby",
    configureServer(server) {
      if (env.LOBBY_BACKEND_URL) return;
      const service = new LobbyService({
        ...env,
        dataFile: resolve(env.LOBBY_DATA_FILE ?? ".cache/lobby/lobby.json"),
        aiRatedAfterPlacement: env.LOBBY_AI_RATED_AFTER_PLACEMENT === "true",
      });
      server.middlewares.use((request, response, next) => {
        if (!/^\/api\/(?:lobby|katago)(?:\/|$)/.test(request.url ?? ""))
          return next();
        void service.handle(request, response);
      });
      server.httpServer?.once("close", () => void service.close());
    },
  };
}
