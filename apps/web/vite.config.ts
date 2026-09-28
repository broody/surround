import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import katago from "./katago/bridge.ts";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    katago(loadEnv(mode, process.cwd(), "KATAGO_")),
  ],
  server: { port: 5183, strictPort: true },
}));
