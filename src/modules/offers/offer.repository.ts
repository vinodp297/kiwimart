import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Offer repository — data access only, no business logic.
// All stubs will be filled in Phase 2 by migrating calls from:
//   - src/modules/offers/offer.service.ts
// ---------------------------------------------------------------------------

export type OfferWithRelations = Prisma.OfferGetPayload<{
  include: {
    buyer: {
      select: { id: true; displayName: true; username: true; email: true };
    };
    seller: {
      select: { id: true; displayName: true; username: true; email: true };
    };
    listing: {
      select: { id: true; title: true; priceNzd: true; status: true };
    };
  };
}>;

export const offerRepository = {
  /** Find an offer by ID with buyer, seller, and listing.
   * @source src/modules/offers/offer.service.ts */
  async findByIdWithRelations(id: string): Promise<OfferWithRelations | null> {
    return db.offer.findUnique({
      where: { id },
      include: {
        buyer: {
          select: { id: true, displayName: true, username: true, email: true },
        },
        seller: {
          select: { id: true, displayName: true, username: true, email: true },
        },
        listing: {
          select: { id: true, title: true, priceNzd: true, status: true },
        },
      },
    });
  },

  /** Find an existing pending offer from a buyer on a listing.
   * @source src/modules/offers/offer.service.ts */
  async findPendingByBuyerAndListing(
    buyerId: string,
    listingId: string,
  ): Promise<Prisma.OfferGetPayload<{
    select: { id: true; status: true };
  }> | null> {
    return db.offer.findFirst({
      where: { listingId, buyerId, status: "PENDING" },
      select: { id: true, status: true },
    });
  },

  /** Create a new offer.
   * @source src/modules/offers/offer.service.ts */
  async create(
    data: Prisma.OfferUncheckedCreateInput,
  ): Promise<{ id: string }> {
    return db.offer.create({ data, select: { id: true } });
  },

  /**
   * Accept an offer — optimistic lock via status guard (inside a transaction).
   *
   * The WHERE clause includes `status: "PENDING"` so that a concurrent accept
   * or decline returns count=0 instead of overwriting the competing write.
   * Callers must check result.count — 0 means CONCURRENT_MODIFICATION.
   *
   * @source src/modules/offers/offer.service.ts
   */
  async accept(
    id: string,
    paymentDeadlineAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<Prisma.BatchPayload> {
    return tx.offer.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "ACCEPTED",
        respondedAt: new Date(),
        paymentDeadlineAt,
      },
    });
  },

  /**
   * Decline an offer — optimistic lock via status guard.
   *
   * The WHERE clause includes `status: "PENDING"` so that a concurrent
   * response returns count=0 instead of overwriting it.
   * Callers must check result.count — 0 means CONCURRENT_MODIFICATION.
   *
   * @source src/modules/offers/offer.service.ts
   */
  async decline(
    id: string,
    declineReason?: string,
  ): Promise<Prisma.BatchPayload> {
    return db.offer.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "DECLINED",
        respondedAt: new Date(),
        declineReason: declineReason ?? null,
      },
    });
  },

  /** Decline all competing offers on the same listing (inside a transaction).
   * @source src/modules/offers/offer.service.ts */
  async declineCompetitors(
    listingId: string,
    acceptedOfferId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.offer.updateMany({
      where: {
        listingId,
        id: { not: acceptedOfferId },
        status: "PENDING",
      },
      data: { status: "DECLINED", respondedAt: new Date() },
    });
  },
};
