// src/modules/listings/report.repository.ts
// ─── Report Repository — data access for content reports ─────────────────────

import { getClient, type DbClient } from "@/lib/db";
import { ReportReason, ReportStatus } from "@prisma/client";

export const reportRepository = {
  /** Fetch the seller ID of a listing (for resolving report target). */
  async findListingSellerId(
    listingId: string,
    tx?: DbClient,
  ): Promise<{ sellerId: string } | null> {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: { id: listingId },
      select: { sellerId: true },
    });
  },

  /** Check for a recent duplicate report (same reporter + target within 24h). */
  async findRecentByReporter(
    reporterId: string,
    filter: { listingId?: string; targetUserId?: string | null },
    since: Date,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.report.findFirst({
      where: {
        reporterId,
        ...(filter.listingId
          ? { listingId: filter.listingId }
          : { targetUserId: filter.targetUserId }),
        createdAt: { gte: since },
      },
    });
  },

  /** Create a new report record. */
  async create(
    data: {
      reporterId: string;
      targetUserId: string | null | undefined;
      listingId: string | undefined;
      reason: ReportReason;
      description: string;
      status: ReportStatus;
    },
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.report.create({
      data,
      select: { id: true },
    });
  },
};
