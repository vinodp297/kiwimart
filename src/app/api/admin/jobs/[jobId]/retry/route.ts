// src/app/api/admin/jobs/[jobId]/retry/route.ts
// ─── Dead-Letter Queue: Retry a Failed Job ───────────────────────────────────
// Moves a specific failed job back to the waiting state so BullMQ will
// process it again. Requires VIEW_SYSTEM_HEALTH permission.

import { NextResponse } from "next/server";
import { logger } from "@/shared/logger";
import { requirePermission } from "@/shared/auth/requirePermission";
import { rateLimit } from "@/server/lib/rateLimit";
import { QUEUE_MAP, VALID_QUEUE_NAMES, type QueueName } from "@/lib/queue";
import { apiError } from "@/app/api/v1/_helpers/response";
import { handleRouteError } from "@/server/lib/handle-route-error";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  // Auth guard — requires VIEW_SYSTEM_HEALTH permission
  let admin;
  try {
    admin = await requirePermission("VIEW_SYSTEM_HEALTH");
  } catch {
    return apiError("Forbidden", 403);
  }

  try {
    const { jobId } = await params;
    const body = (await request.json()) as { queueName?: string };
    const queueName = body.queueName as QueueName | undefined;

    // Rate limit — 30 job retries per hour per admin (keyed by admin ID)
    try {
      const limit = await rateLimit(
        "adminJobRetry",
        `admin:${admin.id}:jobRetry`,
      );
      if (!limit.success) {
        return apiError(
          "Too many requests. Please slow down.",
          429,
          "RATE_LIMITED",
        );
      }
    } catch (rlErr) {
      logger.warn("admin:rate-limit-unavailable", {
        action: "jobRetry",
        adminId: admin.id,
        error: rlErr instanceof Error ? rlErr.message : String(rlErr),
      });
      // Fail open — allow the action if rate limiter is unavailable
    }

    if (!queueName || !VALID_QUEUE_NAMES.includes(queueName as QueueName)) {
      return apiError(
        `Invalid queueName. Must be one of: ${VALID_QUEUE_NAMES.join(", ")}`,
        400,
      );
    }

    const queue = QUEUE_MAP[queueName];
    const job = await queue.getJob(jobId);

    if (!job) {
      return apiError(`Job ${jobId} not found in ${queueName} queue`, 404);
    }

    const jobState = await job.getState();
    if (jobState !== "failed") {
      return apiError(
        `Job ${jobId} is in '${jobState}' state, not 'failed'. Only failed jobs can be retried.`,
        400,
      );
    }

    await job.retry("failed");

    logger.info("dlq.job.retried", {
      jobId,
      queueName,
      correlationId: (job.data as Record<string, unknown>)?.correlationId as
        | string
        | undefined,
    });

    return NextResponse.json({
      success: true,
      jobId,
      queueName,
    });
  } catch (e) {
    return handleRouteError(e, { path: "/api/admin/jobs/retry" });
  }
}
