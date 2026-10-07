import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import katago from "./katago/bridge.ts";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["KATAGO_", "LOBBY_", "MATCHMAKER_"]);
  return {
    plugins: [react(), tailwindcss(), katago(env)],
    server: {
      // PORT lets a second dev server (another checkout, a preview) run
      // alongside the usual one.
      port: Number(process.env.PORT) || 5183,
      strictPort: true,
      // Fetched data (thousands of problem files, the lobby's state) isn't
      // source: watching it exhausts the system's file watchers.
      watch: { ignored: ["**/.cache/**", "**/offchain/lobby/data/**"] },
      fs: {
        deny: [
          ".env",
          ".env.*",
          "*.{crt,pem}",
          "**/.git/**",
          "**/.cache/lobby/**",
          "**/offchain/lobby/data/**",
          ...(env.LOBBY_DATA_FILE
            ? [
                resolve(env.LOBBY_DATA_FILE),
                `${resolve(env.LOBBY_DATA_FILE)}.tmp`,
              ]
            : []),
        ],
      },
      proxy: {
        // Rated play on Starknet: the matchmaker (offchain/matchmaker),
        // e.g. the one offchain/anchors/stack.ts runs.
        "/api/matchmaker": {
          target: env.MATCHMAKER_URL ?? "http://127.0.0.1:3300",
          rewrite: (path) => path.replace(/^\/api\/matchmaker/, ""),
        },
        ...(env.LOBBY_BACKEND_URL ? { "/api": env.LOBBY_BACKEND_URL } : {}),
      },
    },
  };
});
