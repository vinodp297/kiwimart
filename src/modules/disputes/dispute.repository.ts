import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Dispute repository — data access only, no business logic.
// All stubs will be filled in Phase 2 by migrating calls from:
//   - src/server/actions/disputes.ts
//   - src/server/services/dispute/dispute.service.ts
//   - src/modules/disputes/auto-resolution.service.ts
//   - src/modules/admin/admin-disputes.service.ts
// ---------------------------------------------------------------------------

export type DisputeWithRelations = Prisma.DisputeGetPayload<{
  include: {
    order: {
      include: {
        buyer: { select: { id: true; displayName: true; email: true } };
        seller: { select: { id: true; displayName: true; email: true } };
        listing: { select: { id: true; title: true; priceNzd: true } };
      };
    };
    evidence: true;
  };
}>;

export const disputeRepository = {
  /** Find a dispute by ID with full relations.
   * @source src/server/services/dispute/dispute.service.ts */
  async findByIdWithRelations(
    id: string,
  ): Promise<DisputeWithRelations | null> {
    // TODO: move from src/server/services/dispute/dispute.service.ts
    throw new Error("Not implemented");
  },

  /** Find a dispute by order ID.
   * @source src/modules/disputes/auto-resolution.service.ts */
  async findByOrderId(
    orderId: string,
  ): Promise<Prisma.DisputeGetPayload<{
    select: { id: true; status: true };
  }> | null> {
    // TODO: move from src/modules/disputes/auto-resolution.service.ts
    throw new Error("Not implemented");
  },

  /** Create a dispute (called inside a transaction).
   * @source src/server/actions/disputes.ts */
  async create(
    data: Prisma.DisputeCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.DisputeGetPayload<{ select: { id: true } }>> {
    // TODO: move from src/server/actions/disputes.ts
    throw new Error("Not implemented");
  },

  /** Update dispute status and resolution fields.
   * @source src/modules/admin/admin-disputes.service.ts */
  async resolve(
    id: string,
    data: Prisma.DisputeUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    // TODO: move from src/modules/admin/admin-disputes.service.ts
    throw new Error("Not implemented");
  },

  /** Add evidence to a dispute.
   * @source src/server/actions/disputes.ts */
  async createEvidence(
    data: Prisma.DisputeEvidenceCreateInput,
  ): Promise<Prisma.DisputeEvidenceGetPayload<{ select: { id: true } }>> {
    // TODO: move from src/server/actions/disputes.ts
    throw new Error("Not implemented");
  },

  /** Count recent disputes for a buyer (abuse-detection check).
   * @source src/server/actions/disputes.ts */
  async countRecentByBuyer(buyerId: string, since: Date): Promise<number> {
    // TODO: move from src/server/actions/disputes.ts
    throw new Error("Not implemented");
  },

  /** Fetch open disputes (admin queue, paginated).
   * @source src/app/api/admin/disputes/route.ts */
  async findOpen(
    take: number,
    cursor?: string,
  ): Promise<DisputeWithRelations[]> {
    // TODO: move from src/app/api/admin/disputes/route.ts
    throw new Error("Not implemented");
  },

  /** Update verification application status after dispute.
   * @source src/server/actions/disputes.ts, src/server/actions/seller.ts */
  async updateVerificationApplication(
    sellerId: string,
    data: Prisma.VerificationApplicationUpdateManyMutationInput,
  ): Promise<void> {
    // TODO: move from src/server/actions/disputes.ts
    throw new Error("Not implemented");
  },
};
