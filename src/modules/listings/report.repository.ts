// src/modules/listings/report.repository.ts
// ─── Report Repository — data access for content reports ─────────────────────

import db from "@/lib/db";
import { Prisma, ReportReason, ReportStatus } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof db;

export const reportRepository = {
  /** Fetch the seller ID of a listing (for resolving report target).
   * @source src/server/actions/reports.ts — createReport */
  async findListingSellerId(
    listingId: string,
    tx?: DbClient,
  ): Promise<{ sellerId: string } | null> {
    const client = tx ?? db;
    return client.listing.findUnique({
      where: { id: listingId },
      select: { sellerId: true },
    });
  },

  /** Check for a recent duplicate report (same reporter + target within 24h).
   * @source src/server/actions/reports.ts — createReport */
  async findRecentByReporter(
    reporterId: string,
    filter: { listingId?: string; targetUserId?: string | null },
    since: Date,
    tx?: DbClient,
  ) {
    const client = tx ?? db;
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

  /** Create a new report record.
   * @source src/server/actions/reports.ts — createReport */
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
    const client = tx ?? db;
    return client.report.create({
      data,
      select: { id: true },
    });
  },
};
