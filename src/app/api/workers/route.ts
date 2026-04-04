// src/app/api/workers/route.ts  (Sprint 4 + Sprint 8)
// ─── Worker Startup Endpoint ─────────────────────────────────────────────────
// Starts all BullMQ workers on POST request.
// Protected with WORKER_SECRET env var — call from Railway/deployment init.
//
// Usage: POST /api/workers with Authorization: Bearer {WORKER_SECRET}

import type { NextRequest } from "next/server";
import { logger } from "@/shared/logger";
import { verifyBearerSecret } from "@/server/lib/verifyBearerSecret";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";

export const runtime = "nodejs";

let workersStarted = false;

export async function POST(request: NextRequest) {
  // 1. Verify worker secret (timing-safe)
  const authHeader = request.headers.get("authorization");

  if (!verifyBearerSecret(authHeader, process.env.WORKER_SECRET, "workers")) {
    return apiError("Unauthorised", 401);
  }

  // 2. Prevent double-starting
  if (workersStarted) {
    return apiOk({ status: "already_running" });
  }

  // 3. Start all workers
  try {
    const { startEmailWorker } = await import("@/server/workers/emailWorker");
    const { startImageWorker } = await import("@/server/workers/imageWorker");
    const { startPayoutWorker } = await import("@/server/workers/payoutWorker");

    startEmailWorker();
    startImageWorker();
    startPayoutWorker();

    workersStarted = true;

    logger.info("workers.started", { workers: ["email", "image", "payout"] });
    return apiOk({ status: "started", workers: ["email", "image", "payout"] });
  } catch (err) {
    logger.error("workers.start_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError("Failed to start workers", 500);
  }
}

export async function GET(request: NextRequest) {
  // Require WORKER_SECRET auth for status check too
  const authHeader = request.headers.get("authorization");

  if (!verifyBearerSecret(authHeader, process.env.WORKER_SECRET, "workers")) {
    return apiError("Unauthorised", 401);
  }

  return apiOk({ status: workersStarted ? "running" : "stopped" });
}
