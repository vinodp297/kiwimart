// src/server/workers/index.ts
// ─── Worker Process Entry Point ───────────────────────────────────────────────
// Starts all BullMQ workers for the Buyzi marketplace.
// Deployed as a persistent background service on Render.com — separate from
// the Vercel web deployment.
//
// Usage:
//   Production:  npm run worker
//   Development: npm run worker:dev
//
// See docs/RUNBOOK.md → "Worker Deployment" for setup instructions.

import { logger } from "@/shared/logger";
import { startEmailWorker } from "./emailWorker";
import { startImageWorker } from "./imageWorker";
import { startPayoutWorker } from "./payoutWorker";
import { startPickupWorker } from "./pickupWorker";
import { startHealthServer } from "./health-server";
import { emailQueue, imageQueue, payoutQueue, pickupQueue } from "@/lib/queue";
import { env } from "@/env";

async function startAllWorkers() {
  logger.info("workers.starting", {
    workers: ["email", "image", "payout", "pickup"],
    environment: env.NODE_ENV,
  });

  const emailWorker = startEmailWorker();
  const imageWorker = startImageWorker();
  const payoutWorker = startPayoutWorker();
  const pickupWorker = startPickupWorker();

  logger.info("workers.started", {
    queues: ["email", "image", "payout", "pickup"],
  });

  // Start health check server so Render.com can verify the process is alive
  const port = env.PORT; // number — coerced and defaulted to 3001 by env.ts
  const workerEntries = [
    emailWorker && { name: "email", worker: emailWorker },
    imageWorker && { name: "image", worker: imageWorker },
    payoutWorker && { name: "payout", worker: payoutWorker },
    pickupWorker && { name: "pickup", worker: pickupWorker },
  ].filter(Boolean) as import("./health-server").WorkerEntry[];

  const queueEntries: import("./health-server").QueueEntry[] = [
    { name: "email", queue: emailQueue },
    { name: "image", queue: imageQueue },
    { name: "payout", queue: payoutQueue },
    { name: "pickup", queue: pickupQueue },
  ];

  const healthServer = startHealthServer(port, workerEntries, queueEntries);

  // Graceful shutdown — Render.com sends SIGTERM before stopping the service
  async function shutdown(signal: string) {
    logger.info("workers.shutting_down", { signal });

    healthServer.close();

    await Promise.all([
      emailWorker?.close(),
      imageWorker?.close(),
      payoutWorker?.close(),
      pickupWorker?.close(),
    ]);

    logger.info("workers.shutdown_complete");
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

startAllWorkers().catch((error: unknown) => {
  logger.error("workers.startup_failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
