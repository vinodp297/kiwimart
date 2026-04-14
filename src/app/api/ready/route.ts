// src/app/api/ready/route.ts
// ─── READINESS Probe ─────────────────────────────────────────────────────────
// Tells the load balancer whether this instance can safely serve traffic.
// Returns HTTP 503 when any critical dependency is unreachable or timing out.
//
// Use this endpoint — NOT /api/health — in:
//   • Vercel health-check configuration
//   • AWS ALB / nginx upstream health checks
//   • Kubernetes readinessProbe
//   • Better Uptime alert probes
//
// Contrast with /api/health (liveness): liveness always returns 200 to
// confirm the process is running. Readiness returns 503 to stop traffic
// reaching an instance that cannot complete requests.
//
// Checks:
//   database — SELECT 1 within 2 s
//   redis    — PING within 1 s
//   bullmq   — getFailedCount() on monitored queues within 1 s
//              (exercises the BullMQ ↔ Redis connection, not job counts)
//
// IMPORTANT: Never expose connection strings or internal error messages.
// The "failing" array contains only well-known key names.

import { healthService } from "@/server/services/health.service";
import { getRedisClient } from "@/infrastructure/redis/client";
import { payoutQueue, emailQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), timeoutMs),
    ),
  ]);
}

const DB_TIMEOUT_MS = 2_000;
const DEP_TIMEOUT_MS = 1_000;

export async function GET() {
  const failing: string[] = [];

  // ── Database ────────────────────────────────────────────────────────────────
  try {
    await withTimeout(() => healthService.pingDatabase(), DB_TIMEOUT_MS);
  } catch {
    failing.push("database");
  }

  // ── Redis ───────────────────────────────────────────────────────────────────
  try {
    await withTimeout(() => getRedisClient().ping(), DEP_TIMEOUT_MS);
  } catch {
    failing.push("redis");
  }

  // ── BullMQ (exercises the BullMQ ↔ Redis connection) ────────────────────────
  try {
    await withTimeout(
      () =>
        Promise.all([
          payoutQueue.getFailedCount(),
          emailQueue.getFailedCount(),
        ]),
      DEP_TIMEOUT_MS,
    );
  } catch {
    failing.push("bullmq");
  }

  if (failing.length > 0) {
    return Response.json({ status: "not_ready", failing }, { status: 503 });
  }

  return Response.json({ status: "ready" }, { status: 200 });
}
