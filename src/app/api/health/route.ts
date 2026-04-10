// src/app/api/health/route.ts
// ─── Public Liveness Probe ──────────────────────────────────────────────────
// Performs real dependency checks (database, Redis) with 3s timeouts each.
// Also exposes business-level SLO signals (pending payouts, open disputes,
// failed jobs) so operators can distinguish "infrastructure up, business
// backlogged" from "everything fine".
//
// Used by: deploy pipeline verify job, Vercel health checks, Better Uptime.
// For detailed service health, see /api/admin/health (requires SUPER_ADMIN).
//
// Response rules:
//   status "ok"        — infra green + business backlog within SLOs → HTTP 200
//   status "degraded"  — a check timed out, Redis unreachable, or a business
//                        SLO is breached (stale payouts, DLQ overflow,
//                        payout backlog) → HTTP 200
//   status "unhealthy" — database is unreachable (app cannot function) → HTTP 503
//
// IMPORTANT: Never expose connection strings, passwords, or internal error
// messages publicly — check values are limited to ok / degraded / unreachable.

import { healthService } from "@/server/services/health.service";
import { getRedisClient } from "@/infrastructure/redis/client";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "degraded" | "unreachable";

// ── SLO thresholds ──────────────────────────────────────────────────────────
// Configurable via env so the thresholds can be tuned per environment without
// a redeploy. These are intentionally conservative defaults — a single breach
// moves the health endpoint from "ok" to "degraded" (still HTTP 200), giving
// operators an early warning without tripping page-on-call alarms.
const PENDING_PAYOUTS_WARNING = Number(
  process.env.HEALTH_PENDING_PAYOUTS_THRESHOLD ?? 100,
);
const FAILED_JOBS_WARNING = Number(
  process.env.HEALTH_FAILED_JOBS_THRESHOLD ?? 20,
);
const OLDEST_PAYOUT_WARNING_HOURS = Number(
  process.env.HEALTH_OLDEST_PAYOUT_HOURS ?? 48,
);

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

  // ── Business SLO signals ───────────────────────────────────────────────
  // Fetched in parallel with dependency checks at best effort — a failure
  // here degrades the endpoint but does NOT take the app offline. Observing
  // that business metrics are unavailable is itself a useful signal.
  let business: Awaited<
    ReturnType<typeof healthService.getBusinessMetrics>
  > | null = null;
  let businessBreached = false;
  try {
    business = await withTimeout(
      () => healthService.getBusinessMetrics(),
      CHECK_TIMEOUT_MS,
    );

    if (business.pendingPayouts > PENDING_PAYOUTS_WARNING) {
      businessBreached = true;
    }
    if (business.failedJobs > FAILED_JOBS_WARNING) {
      businessBreached = true;
    }
    if (business.oldestPendingPayout) {
      const ageMs =
        Date.now() - new Date(business.oldestPendingPayout).getTime();
      if (ageMs > OLDEST_PAYOUT_WARNING_HOURS * 60 * 60 * 1000) {
        businessBreached = true;
      }
    }
  } catch (e) {
    // Business metrics collection failed — log for observability but do not
    // fail the overall health probe. Infra checks still determine liveness.
    logger.warn("health.business_metrics_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Database being unreachable is fatal — the app cannot serve any requests.
  // Redis unreachable OR a business SLO breach is a degraded signal.
  let status: "ok" | "degraded" | "unhealthy";
  if (database === "unreachable") {
    status = "unhealthy";
  } else if (
    Object.values(checks).some((c) => c !== "ok") ||
    businessBreached
  ) {
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
      business,
      responseTimeMs: Date.now() - start,
      correlationId,
    },
    { status: status === "unhealthy" ? 503 : 200 },
  );
}
