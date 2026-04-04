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
    sellerEnabled: true;
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
  /** Find a seller's public profile by username.
   * @source src/app/(public)/sellers/[username]/page.tsx */
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
        sellerEnabled: true,
        idVerified: true,
        avgResponseTimeMinutes: true,
        responseRate: true,
        sellerTierOverride: true,
      },
    });
  },

  /** Find a seller's public profile by ID.
   * @source src/app/(public)/listings/[id]/SellerPanel.tsx */
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
        sellerEnabled: true,
        idVerified: true,
        avgResponseTimeMinutes: true,
        responseRate: true,
        sellerTierOverride: true,
      },
    });
  },

  /** Find trust metrics for a user.
   * @source src/modules/sellers/trust-score.service.ts */
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

  /** Upsert trust metrics after a sale or review.
   * @source src/modules/sellers/trust-score.service.ts */
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

  /** Update seller response-time metrics.
   * @source src/modules/sellers/response-metrics.service.ts */
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

  /** Find sellers eligible for tier downgrade check.
   * @source src/server/jobs/sellerDowngradeCheck.ts */
  async findSellersForDowngradeCheck(take: number): Promise<
    Prisma.UserGetPayload<{
      select: {
        id: true;
        sellerTierOverride: true;
        sellerEnabled: true;
      };
    }>[]
  > {
    return db.user.findMany({
      where: { sellerEnabled: true, isBanned: false },
      select: { id: true, sellerTierOverride: true, sellerEnabled: true },
      take,
    });
  },

  /** Update seller tier.
   * @source src/server/jobs/sellerDowngradeCheck.ts */
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

  /** Find sellers with open disputes (for downgrade check).
   * @source src/server/jobs/sellerDowngradeCheck.ts */
  async findSellersWithOpenDisputes(): Promise<
    Prisma.UserGetPayload<{ select: { id: true } }>[]
  > {
    return db.user.findMany({
      where: {
        sellerEnabled: true,
        isBanned: false,
        sellerOrders: { some: { status: "DISPUTED" } },
      },
      select: { id: true },
    });
  },

  /** Get Stripe account ID for a seller.
   * @source src/modules/orders/order.service.ts, src/modules/payments/payment.service.ts */
  async findStripeAccountId(sellerId: string): Promise<string | null> {
    const user = await db.user.findUnique({
      where: { id: sellerId },
      select: { stripeAccountId: true },
    });
    return user?.stripeAccountId ?? null;
  },
};
