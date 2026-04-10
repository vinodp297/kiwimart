// src/app/api/admin/health/route.ts
// ─── Detailed Internal Health Check ─────────────────────────────────────────
// Checks all critical services: database, Redis, Stripe.
// Also fetches business SLO metrics (pending payouts, DLQ size, open disputes)
// with a 60-second Redis cache so repeated checks don't amplify DB load.
// Returns 200 when all healthy, 503 when any service is degraded.
// Requires VIEW_SYSTEM_HEALTH permission (SUPER_ADMIN or READ_ONLY_ADMIN).
//
// Business metrics cache:
//   Key:  health:business:metrics
//   TTL:  60 seconds
//   Miss: compute from DB + BullMQ, then cache
//   Hit:  return cached value without hitting the DB

import { NextResponse } from "next/server";
import { healthService } from "@/server/services/health.service";
import { getRedisClient } from "@/infrastructure/redis/client";
import { stripe } from "@/infrastructure/stripe/client";
import { logger } from "@/shared/logger";
import { requirePermission } from "@/shared/auth/requirePermission";
import { apiError } from "@/app/api/v1/_helpers/response";

export const dynamic = "force-dynamic";

interface ServiceCheck {
  name: string;
  status: "ok" | "error";
  latencyMs?: number;
  error?: string;
}

// ── SLO thresholds ───────────────────────────────────────────────────────────
// Breaching any threshold moves the admin health status from "ok" to "degraded".
const PENDING_PAYOUTS_WARNING = Number(
  process.env.HEALTH_PENDING_PAYOUTS_THRESHOLD ?? 100,
);
const FAILED_JOBS_WARNING = Number(
  process.env.HEALTH_FAILED_JOBS_THRESHOLD ?? 20,
);
const OLDEST_PAYOUT_WARNING_HOURS = Number(
  process.env.HEALTH_OLDEST_PAYOUT_HOURS ?? 48,
);

const BUSINESS_METRICS_CACHE_KEY = "health:business:metrics";
const BUSINESS_METRICS_CACHE_TTL_SECONDS = 60;

// Caps each service check at timeoutMs — prevents a slow dependency from
// hanging the entire health endpoint (uptime monitors have short timeouts).
async function checkService(
  name: string,
  fn: () => Promise<void>,
  timeoutMs = 2000,
): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs),
      ),
    ]);
    return {
      name,
      status: "ok",
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name,
      status: "error",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fetch business metrics, serving from a 60-second Redis cache on cache hits.
 * Returns null if both the cache and the DB are unavailable.
 */
async function getCachedBusinessMetrics() {
  try {
    const redis = getRedisClient();

    // Cache hit — return parsed metrics without hitting the DB
    const cached = await redis.get(BUSINESS_METRICS_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached as string);
    }

    // Cache miss — fetch from DB + BullMQ, then cache the result
    const metrics = await healthService.getBusinessMetrics();
    await redis.set(BUSINESS_METRICS_CACHE_KEY, JSON.stringify(metrics), {
      ex: BUSINESS_METRICS_CACHE_TTL_SECONDS,
    });
    return metrics;
  } catch (e) {
    logger.warn("health.business_metrics_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

export async function GET() {
  // Auth guard — requires VIEW_SYSTEM_HEALTH permission
  try {
    await requirePermission("VIEW_SYSTEM_HEALTH");
  } catch {
    return apiError("Forbidden", 403);
  }

  try {
    const start = Date.now();

    // Infrastructure checks and business metrics run in parallel.
    const [infraResults, business] = await Promise.all([
      Promise.allSettled([
        checkService("database", async () => {
          await healthService.pingDatabase();
        }),
        checkService("redis", async () => {
          await getRedisClient().ping();
        }),
        checkService("stripe", async () => {
          // Lightweight check — just verify the API key is accepted
          await stripe.balance.retrieve();
        }),
      ]),
      getCachedBusinessMetrics(),
    ]);

    const services: ServiceCheck[] = infraResults.map((result) =>
      result.status === "fulfilled"
        ? result.value
        : {
            name: "unknown",
            status: "error" as const,
            error: "Check failed",
          },
    );

    // Business SLO breach detection
    let businessBreached = false;
    if (business) {
      if (business.pendingPayouts > PENDING_PAYOUTS_WARNING) {
        businessBreached = true;
      }
      // null failedJobs means metrics unavailable → degrade, not ok
      if (
        business.failedJobs === null ||
        business.failedJobs > FAILED_JOBS_WARNING
      ) {
        businessBreached = true;
      }
      if (!business.metricsAvailable) {
        businessBreached = true;
      }
      if (business.oldestPendingPayout) {
        const ageMs =
          Date.now() - new Date(business.oldestPendingPayout).getTime();
        if (ageMs > OLDEST_PAYOUT_WARNING_HOURS * 60 * 60 * 1000) {
          businessBreached = true;
        }
      }
    }

    const allInfraHealthy = services.every((s) => s.status === "ok");
    const allHealthy = allInfraHealthy && !businessBreached;
    const totalLatencyMs = Date.now() - start;

    if (!allHealthy) {
      logger.error("health.check.degraded", {
        services: services.filter((s) => s.status === "error"),
        businessBreached,
      });
    }

    return NextResponse.json(
      {
        status: allHealthy ? "ok" : "degraded",
        timestamp: new Date().toISOString(),
        totalLatencyMs,
        services,
        business,
      },
      { status: allHealthy ? 200 : 503 },
    );
  } catch (e) {
    logger.error("api.error", {
      path: "/api/admin/health",
      error: e instanceof Error ? e.message : e,
    });
    return NextResponse.json(
      { error: "Health check failed. Please try again." },
      { status: 500 },
    );
  }
}
