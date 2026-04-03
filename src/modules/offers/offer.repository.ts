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
    // TODO: move from src/modules/offers/offer.service.ts
    throw new Error("Not implemented");
  },

  /** Find an existing pending offer from a buyer on a listing.
   * @source src/modules/offers/offer.service.ts */
  async findPendingByBuyerAndListing(
    buyerId: string,
    listingId: string,
  ): Promise<Prisma.OfferGetPayload<{
    select: { id: true; status: true };
  }> | null> {
    // TODO: move from src/modules/offers/offer.service.ts
    throw new Error("Not implemented");
  },

  /** Create a new offer.
   * @source src/modules/offers/offer.service.ts */
  async create(data: Prisma.OfferCreateInput): Promise<
    Prisma.OfferGetPayload<{
      select: { id: true; amountNzd: true; status: true; expiresAt: true };
    }>
  > {
    // TODO: move from src/modules/offers/offer.service.ts
    throw new Error("Not implemented");
  },

  /** Accept an offer and set payment deadline (inside a transaction).
   * @source src/modules/offers/offer.service.ts */
  async accept(
    id: string,
    paymentDeadline: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // TODO: move from src/modules/offers/offer.service.ts
    throw new Error("Not implemented");
  },

  /** Decline an offer.
   * @source src/modules/offers/offer.service.ts */
  async decline(id: string, declineNote?: string): Promise<void> {
    // TODO: move from src/modules/offers/offer.service.ts
    throw new Error("Not implemented");
  },

  /** Decline all competing offers on the same listing (inside a transaction).
   * @source src/modules/offers/offer.service.ts */
  async declineCompetitors(
    listingId: string,
    acceptedOfferId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // TODO: move from src/modules/offers/offer.service.ts
    throw new Error("Not implemented");
  },
};
