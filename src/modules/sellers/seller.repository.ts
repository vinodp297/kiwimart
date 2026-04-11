import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Seller repository — data access only, no business logic.
// All stubs will be filled in Phase 2 by migrating calls from:
//   - src/modules/sellers/trust-score.service.ts
//   - src/modules/sellers/response-metrics.service.ts
//   - src/modules/trust/trust-metrics.service.ts
//   - src/server/actions/seller.ts
//   - src/app/(public)/sellers/[username]/page.tsx
//   - src/server/jobs/sellerDowngradeCheck.ts
// ---------------------------------------------------------------------------

export type SellerPublicProfile = Prisma.UserGetPayload<{
  select: {
    id: true;
    displayName: true;
    username: true;
    avatarKey: true;
    region: true;
    bio: true;
    createdAt: true;
    isSellerEnabled: true;
    idVerified: true;
    avgResponseTimeMinutes: true;
    responseRate: true;
    sellerTierOverride: true;
  };
}>;

export type TrustMetricsRow = Prisma.TrustMetricsGetPayload<{
  select: {
    userId: true;
    totalOrders: true;
    completedOrders: true;
    disputeRate: true;
    averageRating: true;
    isFlaggedForFraud: true;
    updatedAt: true;
  };
}>;

export const sellerRepository = {
  /** Find a seller's public profile by username. */
  async findPublicByUsername(
    username: string,
  ): Promise<SellerPublicProfile | null> {
    return db.user.findFirst({
      where: { username, deletedAt: null, isBanned: false },
      select: {
        id: true,
        displayName: true,
        username: true,
        avatarKey: true,
        region: true,
        bio: true,
        createdAt: true,
        isSellerEnabled: true,
        idVerified: true,
        avgResponseTimeMinutes: true,
        responseRate: true,
        sellerTierOverride: true,
      },
    });
  },

  /** Find a seller's public profile by ID. */
  async findPublicById(id: string): Promise<SellerPublicProfile | null> {
    return db.user.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        username: true,
        avatarKey: true,
        region: true,
        bio: true,
        createdAt: true,
        isSellerEnabled: true,
        idVerified: true,
        avgResponseTimeMinutes: true,
        responseRate: true,
        sellerTierOverride: true,
      },
    });
  },

  /** Find trust metrics for a user. */
  async findTrustMetrics(userId: string): Promise<TrustMetricsRow | null> {
    return db.trustMetrics.findUnique({
      where: { userId },
      select: {
        userId: true,
        totalOrders: true,
        completedOrders: true,
        disputeRate: true,
        averageRating: true,
        isFlaggedForFraud: true,
        updatedAt: true,
      },
    });
  },

  /** Upsert trust metrics after a sale or review. */
  async upsertTrustMetrics(
    userId: string,
    create: Prisma.TrustMetricsCreateInput,
    update: Prisma.TrustMetricsUpdateInput,
  ): Promise<void> {
    await db.trustMetrics.upsert({
      where: { userId },
      create,
      update,
    });
  },

  /** Update seller response-time metrics. */
  async updateResponseMetrics(
    sellerId: string,
    avgResponseTimeMinutes: number,
    responseRate: number,
  ): Promise<void> {
    await db.user.update({
      where: { id: sellerId },
      data: {
        avgResponseTimeMinutes,
        responseRate: Math.round(responseRate * 10) / 10,
        lastResponseCalcAt: new Date(),
      },
    });
  },

  /** Find sellers eligible for tier downgrade check. */
  async findSellersForDowngradeCheck(take: number): Promise<
    Prisma.UserGetPayload<{
      select: {
        id: true;
        sellerTierOverride: true;
        isSellerEnabled: true;
      };
    }>[]
  > {
    return db.user.findMany({
      where: { isSellerEnabled: true, isBanned: false },
      select: { id: true, sellerTierOverride: true, isSellerEnabled: true },
      take,
    });
  },

  /** Update seller tier. */
  async updateSellerTier(userId: string, tier: string): Promise<void> {
    await db.user.update({
      where: { id: userId },
      data: {
        sellerTierOverride: tier,
        sellerTierOverrideAt: new Date(),
        sellerTierOverrideBy: "SYSTEM",
      },
    });
  },

  /** Find sellers with open disputes (for downgrade check). */
  async findSellersWithOpenDisputes(): Promise<
    Prisma.UserGetPayload<{ select: { id: true } }>[]
  > {
    return db.user.findMany({
      where: {
        isSellerEnabled: true,
        isBanned: false,
        sellerOrders: { some: { status: "DISPUTED" } },
      },
      select: { id: true },
    });
  },

  // ── Trust-score helpers ───────────────────────────────────────────────────

  /** Fetch user fields needed to compute a seller trust score. */
  async findForTrustProfile(sellerId: string): Promise<{
    createdAt: Date;
    isVerifiedSeller: boolean;
    idVerified: boolean;
    responseRate: number | null;
    sellerTierOverride: string | null;
  } | null> {
    return db.user.findUnique({
      where: { id: sellerId },
      select: {
        createdAt: true,
        isVerifiedSeller: true,
        idVerified: true,
        responseRate: true,
        sellerTierOverride: true,
      },
    });
  },

  /** Group a seller's orders by status to compute completion/dispute rates. */
  async groupOrdersByStatus(
    sellerId: string,
  ): Promise<{ status: string; _count: { id: number } }[]> {
    // Prisma groupBy has overly-complex generic constraints that can't be satisfied
    // by a plain object literal in strict mode — cast via unknown to the known shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (db.order as any).groupBy({
      by: ["status"],
      where: { sellerId },
      _count: { id: true },
    }) as Promise<{ status: string; _count: { id: number } }[]>;
  },

  /** Aggregate approved buyer reviews for a seller (average rating + count). */
  async aggregateSellerReviews(sellerId: string): Promise<{
    _avg: { rating: number | null };
    _count: { id: number };
  }> {
    return db.review.aggregate({
      where: { subjectId: sellerId, reviewerRole: "BUYER", isApproved: true },
      _avg: { rating: true },
      _count: { id: true },
    });
  },

  /** Count completed sales for a seller in the last 12 months (for tier calculation). */
  async countRecentCompletedSales(
    sellerId: string,
    since: Date,
  ): Promise<number> {
    return db.order.count({
      where: {
        sellerId,
        status: "COMPLETED",
        completedAt: { gte: since },
      },
    });
  },

  /** Fetch message threads for a seller's response-time calculation.
   * Returns first 10 messages per thread, last 50 threads.
   *         src/modules/sellers/response-metrics.service.ts */
  async findMessageThreadsForMetrics(sellerId: string): Promise<
    {
      messages: { senderId: string | null; createdAt: Date }[];
    }[]
  > {
    return db.messageThread.findMany({
      where: {
        OR: [{ participant1Id: sellerId }, { participant2Id: sellerId }],
      },
      select: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: { senderId: true, createdAt: true },
          take: 10,
        },
      },
      take: 50,
    });
  },

  /** Get Stripe account ID for a seller. */
  async findStripeAccountId(sellerId: string): Promise<string | null> {
    const user = await db.user.findUnique({
      where: { id: sellerId },
      select: { stripeAccountId: true },
    });
    return user?.stripeAccountId ?? null;
  },
};
