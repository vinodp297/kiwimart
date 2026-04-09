// src/modules/listings/listing-image.repository.ts
// ─── Listing Image Repository — data access for listing images ────────────────

import { getClient, type DbClient } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const listingImageRepository = {
  /** Count images for a listing. */
  async countByListing(listingId: string, tx?: DbClient): Promise<number> {
    const client = getClient(tx);
    return client.listingImage.count({ where: { listingId } });
  },

  /** Delete orphaned unprocessed images for a user (before new upload). */
  async deleteOrphansByUser(userId: string, tx?: DbClient): Promise<void> {
    const client = getClient(tx);
    await client.listingImage.deleteMany({
      where: {
        listingId: null,
        r2Key: { startsWith: `listings/${userId}/` },
        isScanned: false,
        isSafe: false,
        processedAt: null,
      },
    });
  },

  /** Count pending (unassociated) images for a user. */
  async countPendingByUser(userId: string, tx?: DbClient): Promise<number> {
    const client = getClient(tx);
    return client.listingImage.count({
      where: { listingId: null, r2Key: { startsWith: `listings/${userId}/` } },
    });
  },

  /** Create a new listing image record. */
  async create(data: Prisma.ListingImageUncheckedCreateInput, tx?: DbClient) {
    const client = getClient(tx);
    return client.listingImage.create({ data, select: { id: true } });
  },

  /** Fetch a listing image with its listing's seller ID for ownership check. */
  async findWithListing(imageId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listingImage.findUnique({
      where: { id: imageId },
      select: { r2Key: true, listing: { select: { sellerId: true } } },
    });
  },

  /** Mark an image as failed scan (unsafe). */
  async markUnsafe(imageId: string, tx?: DbClient): Promise<void> {
    const client = getClient(tx);
    await client.listingImage.update({
      where: { id: imageId },
      data: { isScanned: true, isSafe: false, scannedAt: new Date() },
    });
  },

  /** Mark an image as safe and store processed metadata. */
  async markProcessed(
    imageId: string,
    data: {
      r2Key: string;
      thumbnailKey: string;
      width: number;
      height: number;
      sizeBytes: number;
      originalSizeBytes: number;
    },
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.listingImage.update({
      where: { id: imageId },
      data: {
        ...data,
        processedAt: new Date(),
        isScanned: true,
        isSafe: true,
        scannedAt: new Date(),
      },
    });
  },

  /** Mark an image as safe (dev bypass when R2 is unavailable). */
  async markSafe(imageId: string, r2Key: string, tx?: DbClient): Promise<void> {
    const client = getClient(tx);
    await client.listingImage.update({
      where: { id: imageId, r2Key },
      data: { isScanned: true, isSafe: true, scannedAt: new Date() },
    });
  },

  /** Delete unprocessed orphaned images for the cleanup action. */
  async deleteUnprocessedOrphansByUser(userId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listingImage.deleteMany({
      where: {
        listingId: null,
        r2Key: { startsWith: `listings/${userId}/` },
        processedAt: null,
      },
    });
  },

  /** Check listing ownership and image count for delete auth. */
  async findListingOwnerAndCount(listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: { id: listingId },
      select: { sellerId: true, _count: { select: { images: true } } },
    });
  },

  /** Find a specific image by id and listing for deletion. */
  async findByIdAndListing(imageId: string, listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listingImage.findFirst({
      where: { id: imageId, listingId },
    });
  },

  /** Delete an image by id. */
  async deleteById(imageId: string, tx?: DbClient): Promise<void> {
    const client = getClient(tx);
    await client.listingImage.delete({ where: { id: imageId } });
  },

  /** Fetch remaining images ordered by position for re-ordering. */
  async findOrderedByListing(listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listingImage.findMany({
      where: { listingId },
      orderBy: { order: "asc" },
      select: { id: true },
    });
  },

  /** Update the sort order of an image. */
  async updateOrder(
    imageId: string,
    order: number,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.listingImage.update({
      where: { id: imageId },
      data: { order },
    });
  },

  // findListingOwner — consolidated into findListingOwnerAndCount (superset)

  /** Count total images (admin storage monitoring). */
  async countAll(tx?: DbClient): Promise<number> {
    const client = getClient(tx);
    return client.listingImage.count();
  },

  /** Count processed images (processedAt not null). */
  async countProcessed(tx?: DbClient): Promise<number> {
    const client = getClient(tx);
    return client.listingImage.count({ where: { processedAt: { not: null } } });
  },

  /** Count unscanned images. */
  async countPending(tx?: DbClient): Promise<number> {
    const client = getClient(tx);
    return client.listingImage.count({ where: { isScanned: false } });
  },

  /** Count images with thumbnails. */
  async countWithThumbnails(tx?: DbClient): Promise<number> {
    const client = getClient(tx);
    return client.listingImage.count({
      where: { thumbnailKey: { not: null } },
    });
  },

  /** Aggregate size statistics for storage monitoring. */
  async aggregateSizes(tx?: DbClient) {
    const client = getClient(tx);
    return client.listingImage.aggregate({
      _sum: { sizeBytes: true, originalSizeBytes: true },
      _avg: { sizeBytes: true },
    });
  },
};
