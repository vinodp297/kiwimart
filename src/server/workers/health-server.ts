// src/server/workers/health-server.ts
// ─── Worker Health Check Server ───────────────────────────────────────────────
// Exposes a lightweight HTTP server so Render.com can verify the worker
// process is alive. Runs on a separate port from the Next.js web app.
//
// Render.com polls /health and restarts the service if it stops responding
// OR if it receives a non-2xx response. We return 503 when any worker has
// stopped or any queue is unhealthy so Render.com can restart the process
// before jobs pile up.
//
// Port defaults to 3001 (overridable via PORT env var).
//
// Queue health thresholds (configurable via env vars):
//   HEALTH_FAILED_THRESHOLD  — failed jobs > N → queue UNHEALTHY  (default 10)
//   HEALTH_WAITING_THRESHOLD — waiting jobs > N → queue DEGRADED  (default 100)

import http from "http";
import type { Worker, Queue } from "bullmq";
import { logger } from "@/shared/logger";

export interface WorkerEntry {
  name: string;
  worker: Worker;
}

export interface QueueEntry {
  name: string;
  queue: Queue;
}

export interface QueueHealthStatus {
  waiting: number;
  active: number;
  failed: number;
  isHealthy: boolean;
}

const startTime = Date.now();

function getThreshold(envVar: string, defaultValue: number): number {
  const val = process.env[envVar];
  if (val !== undefined && val !== "") {
    const parsed = Number(val);
    if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
  }
  return defaultValue;
}

export function startHealthServer(
  port = 3001,
  workers: WorkerEntry[] = [],
  queues: QueueEntry[] = [],
): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      void handleHealthCheck(res, workers, queues);
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

async function handleHealthCheck(
  res: http.ServerResponse,
  workers: WorkerEntry[],
  queues: QueueEntry[],
): Promise<void> {
  const failedThreshold = getThreshold("HEALTH_FAILED_THRESHOLD", 10);
  const waitingThreshold = getThreshold("HEALTH_WAITING_THRESHOLD", 100);

  // Worker status checks (synchronous)
  const workerStatuses = workers.map(({ name, worker }) => ({
    name,
    running: worker.isRunning(),
    paused: worker.isPaused(),
  }));

  const allWorkersHealthy = workerStatuses.every((w) => w.running && !w.paused);

  // Queue health checks (async — requires Redis call)
  const queueStatuses: Record<string, QueueHealthStatus> = {};
  let anyQueueUnhealthy = false;
  let anyQueueDegraded = false;

  for (const { name, queue } of queues) {
    try {
      const counts = await queue.getJobCounts("waiting", "active", "failed");
      const waiting = counts.waiting ?? 0;
      const active = counts.active ?? 0;
      const failed = counts.failed ?? 0;
      const isHealthy = failed <= failedThreshold;
      const isDegraded = waiting > waitingThreshold;

      queueStatuses[name] = {
        waiting,
        active,
        failed,
        isHealthy,
      };

      if (!isHealthy) anyQueueUnhealthy = true;
      if (isDegraded) anyQueueDegraded = true;
    } catch {
      // Redis unavailable — mark queue as unhealthy
      queueStatuses[name] = {
        waiting: -1,
        active: -1,
        failed: -1,
        isHealthy: false,
      };
      anyQueueUnhealthy = true;
    }
  }

  // Overall status determination
  let status: "ok" | "degraded" | "unhealthy";
  let statusCode: number;

  if (!allWorkersHealthy || anyQueueUnhealthy) {
    status = "unhealthy";
    statusCode = 503;
  } else if (anyQueueDegraded) {
    status = "degraded";
    statusCode = 200;
  } else {
    status = "ok";
    statusCode = 200;
  }

  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status,
      workers: workerStatuses,
      ...(queues.length > 0 ? { queues: queueStatuses } : {}),
      timestamp: new Date().toISOString(),
      uptimeSeconds,
    }),
  );
}
