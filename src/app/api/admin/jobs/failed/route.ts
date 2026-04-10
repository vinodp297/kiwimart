// src/app/api/admin/jobs/failed/route.ts
// ─── Dead-Letter Queue: List Failed Jobs ─────────────────────────────────────
// Returns failed jobs across all 5 BullMQ queues so operators can inspect
// and retry them. Part of the DLQ observability layer.
//
// Requires VIEW_SYSTEM_HEALTH permission (SUPER_ADMIN or READ_ONLY_ADMIN).

import { NextResponse } from "next/server";
import { logger } from "@/shared/logger";
import { requirePermission } from "@/shared/auth/requirePermission";
import { QUEUE_MAP, VALID_QUEUE_NAMES, type QueueName } from "@/lib/queue";
import { apiError } from "@/app/api/v1/_helpers/response";
import { handleRouteError } from "@/server/lib/handle-route-error";

export const dynamic = "force-dynamic";

// Maximum failed jobs returned per queue — keeps the response size manageable.
const MAX_FAILED_PER_QUEUE = 50;

// Fields that must never appear in API responses (defence-in-depth).
const SENSITIVE_FIELDS = new Set([
  "password",
  "token",
  "secret",
  "connectionString",
  "apiKey",
  "stripeAccountId",
]);

/** Strip known-sensitive fields from job data before returning to the client. */
function sanitiseJobData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_FIELDS.has(key)) {
      clean[key] = "[REDACTED]";
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

interface FailedJobSummary {
  id: string | undefined;
  name: string;
  data: Record<string, unknown>;
  failedReason: string;
  attemptsMade: number;
  correlationId: string | undefined;
  createdAt: number;
  failedAt: number | undefined;
}

interface QueueFailedInfo {
  failedCount: number;
  jobs: FailedJobSummary[];
}

export async function GET() {
  // Auth guard — requires VIEW_SYSTEM_HEALTH permission
  try {
    await requirePermission("VIEW_SYSTEM_HEALTH");
  } catch {
    return apiError("Forbidden", 403);
  }

  try {
    const queues: Record<string, QueueFailedInfo> = {};
    let totalFailed = 0;

    await Promise.all(
      VALID_QUEUE_NAMES.map(async (name: QueueName) => {
        const queue = QUEUE_MAP[name];
        const [failedCount, failedJobs] = await Promise.all([
          queue.getFailedCount(),
          queue.getFailed(0, MAX_FAILED_PER_QUEUE - 1),
        ]);

        totalFailed += failedCount;

        queues[name] = {
          failedCount,
          jobs: failedJobs.map((job) => ({
            id: job.id,
            name: job.name,
            data: sanitiseJobData((job.data as Record<string, unknown>) ?? {}),
            failedReason: job.failedReason ?? "Unknown",
            attemptsMade: job.attemptsMade,
            correlationId: (job.data as Record<string, unknown>)
              ?.correlationId as string | undefined,
            createdAt: job.timestamp,
            failedAt: job.finishedOn ?? undefined,
          })),
        };
      }),
    );

    // Sentry alert when failed job backlog exceeds threshold
    if (totalFailed > 10) {
      const queueCounts: Record<string, number> = {};
      for (const name of VALID_QUEUE_NAMES) {
        queueCounts[name] = queues[name]?.failedCount ?? 0;
      }

      import("@sentry/nextjs")
        .then((Sentry) => {
          Sentry.captureMessage(
            `BullMQ dead-letter queue alert: ${totalFailed} failed jobs`,
            {
              level: "warning",
              extra: { queueCounts },
            },
          );
        })
        .catch(() => {
          // Sentry not available — ignore silently
        });

      logger.warn("dlq.threshold.exceeded", {
        totalFailed,
        queueCounts,
      });
    }

    return NextResponse.json({
      data: {
        queues,
        totalFailed,
      },
    });
  } catch (e) {
    return handleRouteError(e, { path: "/api/admin/jobs/failed" });
  }
}
