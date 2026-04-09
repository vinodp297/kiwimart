import db, { getClient, type DbClient } from "@/lib/db";
import type {
  Dispute,
  DisputeStatus,
  EvidenceUploadedBy,
  Prisma,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// Dispute repository — data access only, no business logic.
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

export type DisputeWithEvidence = Dispute & {
  evidence: Prisma.DisputeEvidenceGetPayload<Record<string, unknown>>[];
};

export const disputeRepository = {
  // ── findUnique by orderId (minimal) ─────────────────────────────────────
  async findByOrderId(orderId: string, tx?: DbClient): Promise<Dispute | null> {
    const client = getClient(tx);
    return client.dispute.findUnique({ where: { orderId } });
  },

  // ── findUnique by orderId with evidence ─────────────────────────────────
  async findByOrderIdWithEvidence(
    orderId: string,
    tx?: DbClient,
  ): Promise<DisputeWithEvidence | null> {
    const client = getClient(tx);
    return client.dispute.findUnique({
      where: { orderId },
      include: { evidence: { orderBy: { createdAt: "asc" } } },
    });
  },

  // ── findUnique by id with evidence ──────────────────────────────────────
  async findByIdWithEvidence(
    disputeId: string,
    tx?: DbClient,
  ): Promise<DisputeWithEvidence | null> {
    const client = getClient(tx);
    return client.dispute.findUnique({
      where: { id: disputeId },
      include: { evidence: { orderBy: { createdAt: "asc" } } },
    });
  },

  // ── findUnique by id (select status only) ───────────────────────────────
  async findStatusById(
    disputeId: string,
    tx?: DbClient,
  ): Promise<{ status: DisputeStatus } | null> {
    const client = getClient(tx);
    return client.dispute.findUnique({
      where: { id: disputeId },
      select: { status: true },
    });
  },

  // ── create ──────────────────────────────────────────────────────────────
  async create(
    data: {
      orderId: string;
      reason: string;
      source: string;
      status: string;
      buyerStatement: string | null;
      openedAt: Date;
    },
    tx?: DbClient,
  ): Promise<Dispute> {
    const client = getClient(tx);
    return client.dispute.create({
      data: data as Prisma.DisputeUncheckedCreateInput,
    });
  },

  // ── update ──────────────────────────────────────────────────────────────
  async update(
    disputeId: string,
    data: Prisma.DisputeUpdateInput,
    tx?: DbClient,
  ): Promise<Dispute> {
    const client = getClient(tx);
    return client.dispute.update({
      where: { id: disputeId },
      data,
    });
  },

  // ── createManyEvidence ──────────────────────────────────────────────────
  async createManyEvidence(
    records: {
      disputeId: string;
      uploadedBy: EvidenceUploadedBy;
      uploaderId: string;
      r2Key: string;
      fileType: string;
      label?: string | null;
    }[],
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.disputeEvidence.createMany({ data: records });
  },

  // ── $transaction (pass-through for service-level transactions) ─────────
  async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return db.$transaction(fn);
  },

  // ── Stub methods preserved for other consumers ─────────────────────────

  /** Find a dispute by ID with full relations (admin views). */
  async findByIdWithRelations(
    id: string,
    tx?: DbClient,
  ): Promise<DisputeWithRelations | null> {
    const client = getClient(tx);
    return client.dispute.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            buyer: { select: { id: true, displayName: true, email: true } },
            seller: { select: { id: true, displayName: true, email: true } },
            listing: { select: { id: true, title: true, priceNzd: true } },
          },
        },
        evidence: true,
      },
    }) as Promise<DisputeWithRelations | null>;
  },

  /** Count recent disputes for a buyer (abuse-detection check). */
  async countRecentByBuyer(
    buyerId: string,
    since: Date,
    tx?: DbClient,
  ): Promise<number> {
    const client = getClient(tx);
    return client.dispute.count({
      where: {
        order: { buyerId },
        openedAt: { gte: since },
      },
    });
  },

  /** Fetch open disputes (admin queue, paginated). */
  async findOpen(
    take: number,
    cursor?: string,
    tx?: DbClient,
  ): Promise<DisputeWithRelations[]> {
    const client = getClient(tx);
    return client.dispute.findMany({
      where: {
        status: {
          in: [
            "OPEN",
            "AWAITING_SELLER_RESPONSE",
            "SELLER_RESPONDED",
            "UNDER_REVIEW",
          ],
        },
      },
      include: {
        order: {
          include: {
            buyer: { select: { id: true, displayName: true, email: true } },
            seller: { select: { id: true, displayName: true, email: true } },
            listing: { select: { id: true, title: true, priceNzd: true } },
          },
        },
        evidence: true,
      },
      orderBy: { openedAt: "asc" },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    }) as Promise<DisputeWithRelations[]>;
  },

  /** Update verification application status after dispute. */
  async updateVerificationApplication(
    sellerId: string,
    data: Prisma.VerificationApplicationUpdateManyMutationInput,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.verificationApplication.updateMany({
      where: { sellerId },
      data,
    });
  },
};
