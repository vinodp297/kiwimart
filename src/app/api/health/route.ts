// src/app/api/health/route.ts
// ─── Public Liveness Probe ──────────────────────────────────────────────────
// Cheap-only checks: database SELECT 1 + Redis PING. Each is capped at 3 s.
//
// Deliberately contains NO business-level metrics (pending payouts, DLQ size,
// etc.) — those are expensive aggregate queries that amplify DB load during
// degradation. Use /api/admin/health (SUPER_ADMIN only) for business SLOs.
//
// Used by: deploy pipeline verify job, Vercel health checks, Better Uptime.
//
// Response rules:
//   status "ok"        — both infra checks green → HTTP 200
//   status "degraded"  — a check timed out or Redis unreachable → HTTP 200
//   status "unhealthy" — database is unreachable (app cannot function) → HTTP 503
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

  // Database being unreachable is fatal — the app cannot serve any requests.
  // Redis unreachable is a degraded signal (caching and queues affected).
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
    { status: status === "unhealthy" ? 503 : 200 },
  );
}
