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
    sellerTier: true;
  };
}>;

export type TrustMetricsRow = Prisma.TrustMetricsGetPayload<{
  select: {
    userId: true;
    totalSales: true;
    completionRate: true;
    disputeRate: true;
    averageRating: true;
    fraudFlag: true;
    updatedAt: true;
  };
}>;

export const sellerRepository = {
  /** Find a seller's public profile by username.
   * @source src/app/(public)/sellers/[username]/page.tsx */
  async findPublicByUsername(
    username: string,
  ): Promise<SellerPublicProfile | null> {
    // TODO: move from src/app/(public)/sellers/[username]/page.tsx
    throw new Error("Not implemented");
  },

  /** Find a seller's public profile by ID.
   * @source src/app/(public)/listings/[id]/SellerPanel.tsx */
  async findPublicById(id: string): Promise<SellerPublicProfile | null> {
    // TODO: move from src/app/(public)/listings/[id]/SellerPanel.tsx
    throw new Error("Not implemented");
  },

  /** Find trust metrics for a user.
   * @source src/modules/sellers/trust-score.service.ts */
  async findTrustMetrics(userId: string): Promise<TrustMetricsRow | null> {
    // TODO: move from src/modules/sellers/trust-score.service.ts
    throw new Error("Not implemented");
  },

  /** Upsert trust metrics after a sale or review.
   * @source src/modules/sellers/trust-score.service.ts */
  async upsertTrustMetrics(
    userId: string,
    create: Prisma.TrustMetricsCreateInput,
    update: Prisma.TrustMetricsUpdateInput,
  ): Promise<void> {
    // TODO: move from src/modules/sellers/trust-score.service.ts
    throw new Error("Not implemented");
  },

  /** Update seller response-time metrics.
   * @source src/modules/sellers/response-metrics.service.ts */
  async updateResponseMetrics(
    sellerId: string,
    avgResponseTimeMinutes: number,
    responseRate: number,
  ): Promise<void> {
    // TODO: move from src/modules/sellers/response-metrics.service.ts
    throw new Error("Not implemented");
  },

  /** Find sellers eligible for tier downgrade check.
   * @source src/server/jobs/sellerDowngradeCheck.ts */
  async findSellersForDowngradeCheck(take: number): Promise<
    Prisma.UserGetPayload<{
      select: {
        id: true;
        sellerTier: true;
        sellerEnabled: true;
      };
    }>[]
  > {
    // TODO: move from src/server/jobs/sellerDowngradeCheck.ts
    throw new Error("Not implemented");
  },

  /** Update seller tier.
   * @source src/server/jobs/sellerDowngradeCheck.ts */
  async updateSellerTier(userId: string, tier: string): Promise<void> {
    // TODO: move from src/server/jobs/sellerDowngradeCheck.ts
    throw new Error("Not implemented");
  },

  /** Find sellers with open disputes (for downgrade check).
   * @source src/server/jobs/sellerDowngradeCheck.ts */
  async findSellersWithOpenDisputes(): Promise<
    Prisma.UserGetPayload<{ select: { id: true } }>[]
  > {
    // TODO: move from src/server/jobs/sellerDowngradeCheck.ts
    throw new Error("Not implemented");
  },

  /** Get Stripe account ID for a seller.
   * @source src/modules/orders/order.service.ts, src/modules/payments/payment.service.ts */
  async findStripeAccountId(sellerId: string): Promise<string | null> {
    // TODO: move from src/modules/orders/order.service.ts
    throw new Error("Not implemented");
  },
};
