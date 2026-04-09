// src/server/workers/health-server.ts
// ─── Worker Health Check Server ───────────────────────────────────────────────
// Exposes a lightweight HTTP server so Render.com can verify the worker
// process is alive. Runs on a separate port from the Next.js web app.
//
// Render.com polls /health and restarts the service if it stops responding
// OR if it receives a non-2xx response. We return 503 when any worker has
// stopped so Render.com can restart the process before jobs pile up.
//
// Port defaults to 3001 (overridable via PORT env var).

import http from "http";
import type { Worker } from "bullmq";
import { logger } from "@/shared/logger";

export interface WorkerEntry {
  name: string;
  worker: Worker;
}

export function startHealthServer(
  port = 3001,
  workers: WorkerEntry[] = [],
): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      const workerStatuses = workers.map(({ name, worker }) => ({
        name,
        running: worker.isRunning(),
        paused: worker.isPaused(),
      }));

      const allHealthy = workerStatuses.every((w) => w.running && !w.paused);
      const statusCode = allHealthy ? 200 : 503;

      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: allHealthy ? "ok" : "degraded",
          workers: workerStatuses,
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
