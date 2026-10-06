import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LobbyService } from "./service.ts";

const service = new LobbyService({
  ...process.env,
  dataFile: resolve(
    process.env.LOBBY_DATA_FILE ??
      fileURLToPath(new URL("data/lobby.json", import.meta.url)),
  ),
  aiRatedAfterPlacement: process.env.LOBBY_AI_RATED_AFTER_PLACEMENT === "true",
  allowedOrigins: process.env.LOBBY_ALLOWED_ORIGINS?.split(",").filter(Boolean),
});
const server = createServer((request, response) => {
  if (!request.url?.startsWith("/api/")) {
    response.writeHead(404);
    response.end();
    return;
  }
  void service.handle(request, response);
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(
  Number(process.env.LOBBY_PORT ?? 5184),
  process.env.LOBBY_HOST ?? "127.0.0.1",
  () => console.log("Surround lobby listening", server.address()),
);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  server.close();
  await service.close();
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
