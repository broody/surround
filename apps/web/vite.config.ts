import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import katago from "./katago/bridge.ts";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["KATAGO_", "LOBBY_"]);
  return {
    plugins: [react(), tailwindcss(), katago(env)],
    server: {
      port: 5183,
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
      ...(env.LOBBY_BACKEND_URL
        ? { proxy: { "/api": env.LOBBY_BACKEND_URL } }
        : {}),
    },
  };
});
