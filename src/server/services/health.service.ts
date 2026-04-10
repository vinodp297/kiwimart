// src/server/services/health.service.ts
// ─── Health Service ──────────────────────────────────────────────────────────
// Thin wrapper around the database ping used by health-check routes.
// Keeps raw db access out of route files.

import db from "@/lib/db";

export interface BusinessMetrics {
  /** Payouts awaiting release (PENDING status). */
  pendingPayouts: number;
  /** Open disputes requiring admin attention. */
  openDisputes: number;
  /** BullMQ DLQ job count across the critical queues. */
  failedJobs: number;
  /** ISO timestamp of the oldest PENDING payout, or null if none. */
  oldestPendingPayout: string | null;
}

export const healthService = {
  /** Run a lightweight DB query to confirm the database is reachable.
   * Throws on failure; callers wrap with try/catch or withTimeout. */
  async pingDatabase(): Promise<void> {
    await db.$queryRaw`SELECT 1`;
  },

  /**
   * Collect business-level health signals for SLO monitoring.
   * Returns counts that tell operators whether the business is healthy,
   * not just whether the infrastructure is running.
   *
   * - pendingPayouts: sellers waiting to be paid
   * - openDisputes: disputes awaiting human review
   * - failedJobs: DLQ size across BullMQ queues
   * - oldestPendingPayout: age of the oldest payout stuck in PENDING
   */
  async getBusinessMetrics(): Promise<BusinessMetrics> {
    const [pendingPayouts, openDisputes, oldestPending] = await Promise.all([
      db.payout.count({ where: { status: "PENDING" } }),
      db.dispute.count({ where: { status: "OPEN" } }),
      db.payout.findFirst({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);

    // Failed-job count is collected lazily — BullMQ may not be connected in
    // some environments (build-time, unit tests). On failure we fall back
    // to 0 so the health endpoint never blocks on a Redis round-trip.
    let failedJobs = 0;
    try {
      const { QUEUE_MAP } = await import("@/lib/queue");
      const counts = await Promise.all(
        Object.values(QUEUE_MAP).map((q) => q.getJobCounts("failed")),
      );
      failedJobs = counts.reduce((sum, c) => sum + (c.failed ?? 0), 0);
    } catch {
      // Queue unavailable — surface zero rather than fail the health probe.
      // The dependencies.redis check already reports the underlying outage.
    }

    return {
      pendingPayouts,
      openDisputes,
      failedJobs,
      oldestPendingPayout: oldestPending?.createdAt.toISOString() ?? null,
    };
  },
};
