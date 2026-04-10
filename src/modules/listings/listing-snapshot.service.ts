// src/modules/listings/listing-snapshot.service.ts
// ─── Listing Snapshot Service ──────────────────────────────────────────────────
// Captures an immutable copy of a listing at the moment a buyer places an order.
//
// Design rules:
//   • Always called inside the same db.$transaction as the Order creation so the
//     snapshot and order are atomic — if one fails, both roll back.
//   • Never called outside a transaction. Never calls global db directly.
//   • Write-once — no update or upsert logic exists here.
//   • If the listing is not found the error bubbles up and rolls back the order.

import { logger } from "@/shared/logger";
import type { DbClient } from "@/modules/listings/listing.repository";

// ── Transaction client type ───────────────────────────────────────────────────
// DbClient is Prisma's transaction-scoped client (omits lifecycle methods).
// It is re-exported from listing.repository so services never import db directly.
type PrismaTransactionClient = DbClient;

// ── captureListingSnapshot ────────────────────────────────────────────────────

/**
 * Freeze an immutable copy of a listing into ListingSnapshot.
 *
 * @param orderId   - The newly-created order's id (used as the snapshot key)
 * @param listingId - The listing being purchased
 * @param tx        - The Prisma transaction client (NOT the global db)
 */
export async function captureListingSnapshot(
  orderId: string,
  listingId: string,
  tx: PrismaTransactionClient,
): Promise<void> {
  // 1. Fetch all fields we need to freeze — use the transaction client
  const listing = await tx.listing.findUnique({
    where: { id: listingId },
    select: {
      title: true,
      description: true,
      condition: true,
      priceNzd: true,
      shippingNzd: true,
      shippingOption: true,
      isNegotiable: true,
      categoryId: true,
      subcategoryName: true,
      images: {
        select: { r2Key: true, thumbnailKey: true, order: true },
        orderBy: { order: "asc" },
      },
      attrs: {
        select: { label: true, value: true, order: true },
        orderBy: { order: "asc" },
      },
    },
  });

  if (!listing) {
    // Error bubbles to the transaction callback → full rollback
    logger.error("listing-snapshot.listing-not-found", { orderId, listingId });
    throw new Error(`Listing ${listingId} not found for snapshot`);
  }

  // 2. Fetch the category name — no formal Prisma relation on Listing so we query
  //    directly. Still inside the same tx so it's atomic.
  const category = await tx.category.findUnique({
    where: { id: listing.categoryId },
    select: { name: true },
  });

  // 3. Build JSON-serialisable shapes for the two blob fields
  const images = listing.images.map((img) => ({
    r2Key: img.r2Key,
    thumbnailKey: img.thumbnailKey,
    order: img.order,
  }));

  const attributes = listing.attrs.map((attr) => ({
    label: attr.label,
    value: attr.value,
    order: attr.order,
  }));

  // 4. Write the snapshot — inside the transaction so it rolls back with the order
  await tx.listingSnapshot.create({
    data: {
      orderId,
      listingId,
      title: listing.title,
      description: listing.description,
      condition: listing.condition,
      priceNzd: listing.priceNzd,
      // Pickup listings have null shippingNzd — store 0 to keep column non-null
      shippingNzd: listing.shippingNzd ?? 0,
      categoryName: category?.name ?? "Unknown",
      subcategoryName: listing.subcategoryName ?? null,
      shippingOption: listing.shippingOption,
      isNegotiable: listing.isNegotiable,
      images,
      attributes,
    },
  });

  logger.info("listing-snapshot.captured", { orderId, listingId });
}
