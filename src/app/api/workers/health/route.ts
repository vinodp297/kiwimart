// src/app/api/workers/health/route.ts
// ─── Worker Health Check ────────────────────────────────────────────────────
// Verifies the Redis queue connection is reachable.
// Returns 200 when healthy, 503 when the queue is unreachable.
//
// Requires either:
//   1. WORKER_SECRET in Authorization header, OR
//   2. Active session with VIEW_SYSTEM_HEALTH permission (admin panel)

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getQueueConnection } from "@/infrastructure/queue/client";
import { verifyBearerSecret } from "@/server/lib/verifyBearerSecret";
import { requirePermission } from "@/shared/auth/requirePermission";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Auth: WORKER_SECRET bearer token OR admin session with VIEW_SYSTEM_HEALTH
  const authHeader = request.headers.get("authorization");
  const hasWorkerSecret = verifyBearerSecret(
    authHeader,
    process.env.WORKER_SECRET,
    "workers/health",
  );

  if (!hasWorkerSecret) {
    // Fall back to admin session auth (does fresh DB lookup + permission check)
    try {
      await requirePermission("VIEW_SYSTEM_HEALTH");
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const redis = getQueueConnection();
    await redis.ping();

    // Check actual worker counts on each queue
    let workersActive = false;
    const queueStatus: Record<string, { workers: number }> = {};
    try {
      const { Queue } = await import("bullmq");
      const queueNames = ["payout", "email", "image"];
      for (const name of queueNames) {
        const q = new Queue(name, { connection: redis as never });
        const workers = await q.getWorkers();
        queueStatus[name] = { workers: workers.length };
        if (workers.length > 0) workersActive = true;
        await q.close();
      }
    } catch {
      // Queue introspection failed — still report redis status
    }

    return NextResponse.json({
      status: workersActive ? "healthy" : "degraded",
      redis: "ok",
      workers: {
        active: workersActive,
        queues: queueStatus,
        note: workersActive
          ? "Workers processing"
          : "No active workers — running in inline fallback mode",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("workers.health.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        status: "error",
        error: "Queue connection failed",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
