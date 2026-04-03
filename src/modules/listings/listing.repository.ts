import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Listing repository — data access only, no business logic.
// All stubs will be filled in Phase 2 by migrating calls from:
//   - src/modules/listings/listing.service.ts
//   - src/server/actions/listings.ts
// ---------------------------------------------------------------------------

export type ListingWithRelations = Prisma.ListingGetPayload<{
  include: {
    seller: {
      select: { id: true; displayName: true; username: true; avatarKey: true };
    };
    images: true;
    attributes: true;
    category: true;
    subcategory: true;
  };
}>;

export type ListingWithImages = Prisma.ListingGetPayload<{
  include: { images: true };
}>;

export const listingRepository = {
  /** Find a listing by ID with seller, images, attributes, categories.
   * @source src/modules/listings/listing.service.ts */
  async findByIdWithRelations(
    id: string,
  ): Promise<ListingWithRelations | null> {
    // TODO: move from src/modules/listings/listing.service.ts
    throw new Error("Not implemented");
  },

  /** Find a listing by ID with a minimal select for availability checks.
   * @source src/server/actions/orders.ts, src/server/actions/cart.ts */
  async findByIdForPurchase(id: string): Promise<Prisma.ListingGetPayload<{
    select: {
      id: true;
      status: true;
      deletedAt: true;
      priceNzd: true;
      title: true;
      sellerId: true;
      pickupOnly: true;
      shippingCost: true;
    };
  }> | null> {
    // TODO: move from src/server/actions/orders.ts
    throw new Error("Not implemented");
  },

  /** Atomically reserve a listing by transitioning ACTIVE → RESERVED.
   * Returns count of affected rows (0 if already reserved by someone else).
   * @source src/server/actions/orders.ts, src/server/actions/cart.ts */
  async reserveAtomically(id: string): Promise<Prisma.BatchPayload> {
    // TODO: move from src/server/actions/orders.ts
    throw new Error("Not implemented");
  },

  /** Release a reserved listing back to ACTIVE.
   * @source src/server/actions/orders.ts */
  async releaseReservation(id: string): Promise<Prisma.BatchPayload> {
    // TODO: move from src/server/actions/orders.ts
    throw new Error("Not implemented");
  },

  /** Soft-delete a listing (set deletedAt + status REMOVED).
   * @source src/modules/listings/listing.service.ts */
  async softDelete(id: string): Promise<void> {
    // TODO: move from src/modules/listings/listing.service.ts
    throw new Error("Not implemented");
  },

  /** Update a listing's status.
   * @source src/modules/listings/listing.service.ts, src/server/actions/listings.ts */
  async updateStatus(
    id: string,
    status: string,
  ): Promise<Prisma.ListingGetPayload<{ select: { id: true; status: true } }>> {
    // TODO: move from src/server/actions/listings.ts
    throw new Error("Not implemented");
  },

  /** Create a new listing with images.
   * @source src/server/actions/listings.ts */
  async create(
    data: Prisma.ListingCreateInput,
  ): Promise<Prisma.ListingGetPayload<{ include: { images: true } }>> {
    // TODO: move from src/server/actions/listings.ts
    throw new Error("Not implemented");
  },

  /** Update listing fields by ID.
   * @source src/server/actions/listings.ts */
  async update(
    id: string,
    data: Prisma.ListingUpdateInput,
  ): Promise<Prisma.ListingGetPayload<{ select: { id: true } }>> {
    // TODO: move from src/server/actions/listings.ts
    throw new Error("Not implemented");
  },

  /** Increment view count (fire-and-forget).
   * @source src/modules/listings/listing.service.ts */
  async incrementViewCount(id: string): Promise<void> {
    // TODO: move from src/modules/listings/listing.service.ts
    throw new Error("Not implemented");
  },

  /** Increment watcher count.
   * @source src/modules/listings/listing.service.ts */
  async incrementWatcherCount(id: string): Promise<void> {
    // TODO: move from src/modules/listings/listing.service.ts
    throw new Error("Not implemented");
  },

  /** Decrement watcher count.
   * @source src/modules/listings/listing.service.ts */
  async decrementWatcherCount(id: string): Promise<void> {
    // TODO: move from src/modules/listings/listing.service.ts
    throw new Error("Not implemented");
  },

  /** Count active listings for a seller.
   * @source src/server/actions/listings.ts */
  async countBySeller(sellerId: string): Promise<number> {
    // TODO: move from src/server/actions/listings.ts
    throw new Error("Not implemented");
  },

  /** Validate a category exists.
   * @source src/server/actions/listings.ts */
  async findCategoryById(
    id: string,
  ): Promise<Prisma.CategoryGetPayload<{
    select: { id: true; name: true };
  }> | null> {
    // TODO: move from src/server/actions/listings.ts
    throw new Error("Not implemented");
  },

  /** Get listing images ordered by position.
   * @source src/server/actions/listings.ts */
  async findImagesByListingId(
    listingId: string,
  ): Promise<
    Prisma.ListingImageGetPayload<{
      select: { id: true; r2Key: true; order: true };
    }>[]
  > {
    // TODO: move from src/server/actions/listings.ts
    throw new Error("Not implemented");
  },

  /** Find ListingImages by r2Keys.
   * @source src/server/actions/listings.ts */
  async findImagesByKeys(
    r2Keys: string[],
  ): Promise<
    Prisma.ListingImageGetPayload<{ select: { id: true; r2Key: true } }>[]
  > {
    // TODO: move from src/server/actions/listings.ts
    throw new Error("Not implemented");
  },

  /** Reorder listing images.
   * @source src/server/actions/listings.ts */
  async reorderImages(listingId: string, orderedIds: string[]): Promise<void> {
    // TODO: move from src/server/actions/listings.ts
    throw new Error("Not implemented");
  },

  // -------------------------------------------------------------------------
  // Watchlist operations
  // -------------------------------------------------------------------------

  /** Check if a user is watching a listing.
   * @source src/modules/listings/listing.service.ts */
  async findWatchlistItem(
    userId: string,
    listingId: string,
  ): Promise<Prisma.WatchlistItemGetPayload<{ select: { id: true } }> | null> {
    // TODO: move from src/modules/listings/listing.service.ts
    throw new Error("Not implemented");
  },

  /** Add a listing to a user's watchlist.
   * @source src/modules/listings/listing.service.ts */
  async createWatchlistItem(userId: string, listingId: string): Promise<void> {
    // TODO: move from src/modules/listings/listing.service.ts
    throw new Error("Not implemented");
  },

  /** Remove a listing from a user's watchlist.
   * @source src/modules/listings/listing.service.ts */
  async deleteWatchlistItem(userId: string, listingId: string): Promise<void> {
    // TODO: move from src/modules/listings/listing.service.ts
    throw new Error("Not implemented");
  },

  /** Restore a listing to ACTIVE (used in cancellation).
   * @source src/modules/orders/order.service.ts */
  async reactivate(id: string): Promise<Prisma.BatchPayload> {
    // TODO: move from src/modules/orders/order.service.ts
    throw new Error("Not implemented");
  },
};
