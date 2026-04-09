// src/server/workers/health-server.ts
// ─── Worker Health Check Server ───────────────────────────────────────────────
// Exposes a lightweight HTTP server so Render.com can verify the worker
// process is alive. Runs on a separate port from the Next.js web app.
//
// Render.com polls /health and restarts the service if it stops responding.
// Port defaults to 3001 (overridable via PORT env var).

import http from "http";
import { logger } from "@/shared/logger";

const WORKERS = ["email", "image", "payout", "pickup"] as const;

export function startHealthServer(port = 3001): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          workers: WORKERS,
          timestamp: new Date().toISOString(),
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    logger.info("workers.health_server_started", { port });
  });

  server.on("error", (err) => {
    logger.error("workers.health_server_error", { error: err.message, port });
  });

  return server;
}
