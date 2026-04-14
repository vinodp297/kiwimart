// src/app/api/health/route.ts
// ─── LIVENESS Probe ─────────────────────────────────────────────────────────
// Tells the orchestrator the process is alive. Always returns HTTP 200 as
// long as the server can respond — even if a dependency is unhealthy.
//
// For load-balancer / traffic-gating decisions use /api/ready (readiness):
//   • /api/ready returns HTTP 503 when DB, Redis, or BullMQ is unhealthy.
//
// Checks run here (DB SELECT 1 + Redis PING) are informational only.
// Status values "ok" | "degraded" | "unhealthy" appear in the JSON body so
// monitoring dashboards can report health without affecting routing.
//
// Deliberately contains NO business-level metrics (pending payouts, DLQ size,
// etc.) — those are expensive aggregate queries that amplify DB load during
// degradation. Use /api/admin/health (SUPER_ADMIN only) for business SLOs.
//
// IMPORTANT: Never expose connection strings, passwords, or internal error
// messages publicly — check values are limited to ok / degraded / unreachable.

import { healthService } from "@/server/services/health.service";
import { getRedisClient } from "@/infrastructure/redis/client";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "degraded" | "unreachable";

// Wraps a check function with a hard timeout. Throws an Error with
// message "timeout" if the check takes longer than timeoutMs.
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

const CHECK_TIMEOUT_MS = 3000;

async function checkDatabase(): Promise<CheckStatus> {
  try {
    await withTimeout(() => healthService.pingDatabase(), CHECK_TIMEOUT_MS);
    return "ok";
  } catch (e) {
    // Timeout means the DB is slow but may still be up — degrade, don't declare dead.
    if (e instanceof Error && e.message === "timeout") return "degraded";
    return "unreachable";
  }
}

async function checkRedis(): Promise<CheckStatus> {
  try {
    await withTimeout(() => getRedisClient().ping(), CHECK_TIMEOUT_MS);
    return "ok";
  } catch (e) {
    if (e instanceof Error && e.message === "timeout") return "degraded";
    return "unreachable";
  }
}

export async function GET(request: Request) {
  const start = Date.now();

  // Correlate with the upstream proxy-generated ID so deploy logs are traceable.
  const correlationId =
    request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);

  const checks = { database, redis };

  // Compute status for body (informational — HTTP is always 200 for liveness).
  // Load balancers should poll /api/ready for routing decisions.
  let status: "ok" | "degraded" | "unhealthy";
  if (database === "unreachable") {
    status = "unhealthy";
  } else if (Object.values(checks).some((c) => c !== "ok")) {
    status = "degraded";
  } else {
    status = "ok";
  }

  // Version: prefer the git commit SHA set by Vercel, fall back to npm package
  // version, then a safe unknown sentinel. Never expose internal paths.
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
    process.env.npm_package_version ??
    "unknown";

  // Always HTTP 200 — liveness only. Even "unhealthy" returns 200 here because
  // the process is alive and responding. Use /api/ready for 503 behaviour.
  return Response.json(
    {
      status,
      version,
      checks,
      responseTimeMs: Date.now() - start,
      // ISO 8601 — never a Unix integer; avoids timestamp disclosure finding.
      timestamp: new Date().toISOString(),
      correlationId,
    },
    { status: 200 },
  );
}
