import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["MATCHMAKER_"]);
  return {
    plugins: [react(), tailwindcss()],
    server: {
      // PORT lets a second dev server (another checkout, a preview) run
      // alongside the usual one.
      port: Number(process.env.PORT) || 5183,
      strictPort: true,
      // Fetched data (thousands of problem files) isn't source: watching it
      // exhausts the system's file watchers.
      watch: { ignored: ["**/.cache/**"] },
      fs: {
        deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**"],
      },
      proxy: {
        // Play: the matchmaker (offchain/matchmaker), e.g. the one
        // offchain/anchors/stack.ts runs.
        "/api/matchmaker": {
          target: env.MATCHMAKER_URL ?? "http://127.0.0.1:3300",
          rewrite: (path) => path.replace(/^\/api\/matchmaker/, ""),
        },
      },
    },
  };
});
