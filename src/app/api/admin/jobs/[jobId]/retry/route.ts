// src/app/api/admin/jobs/[jobId]/retry/route.ts
// ─── Dead-Letter Queue: Retry a Failed Job ───────────────────────────────────
// Moves a specific failed job back to the waiting state so BullMQ will
// process it again. Requires VIEW_SYSTEM_HEALTH permission.

import { NextResponse } from "next/server";
import { logger } from "@/shared/logger";
import { requirePermission } from "@/shared/auth/requirePermission";
import { QUEUE_MAP, VALID_QUEUE_NAMES, type QueueName } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  // Auth guard — requires VIEW_SYSTEM_HEALTH permission
  try {
    await requirePermission("VIEW_SYSTEM_HEALTH");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { jobId } = await params;
    const body = (await request.json()) as { queueName?: string };
    const queueName = body.queueName as QueueName | undefined;

    if (!queueName || !VALID_QUEUE_NAMES.includes(queueName as QueueName)) {
      return NextResponse.json(
        {
          error: `Invalid queueName. Must be one of: ${VALID_QUEUE_NAMES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const queue = QUEUE_MAP[queueName];
    const job = await queue.getJob(jobId);

    if (!job) {
      return NextResponse.json(
        { error: `Job ${jobId} not found in ${queueName} queue` },
        { status: 404 },
      );
    }

    const jobState = await job.getState();
    if (jobState !== "failed") {
      return NextResponse.json(
        {
          error: `Job ${jobId} is in '${jobState}' state, not 'failed'. Only failed jobs can be retried.`,
        },
        { status: 400 },
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
    logger.error("api.error", {
      path: "/api/admin/jobs/retry",
      error: e instanceof Error ? e.message : e,
    });
    return NextResponse.json(
      { error: "Failed to retry job. Please try again." },
      { status: 500 },
    );
  }
}
