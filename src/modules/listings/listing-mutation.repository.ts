// src/modules/listings/listing-mutation.repository.ts
// ─── All write / update / delete methods ──────────────────────────────────────

import db, { getClient, type DbClient } from "@/lib/db";
import { fireAndForget } from "@/lib/fire-and-forget";
import { MS_PER_DAY } from "@/lib/time";
import { Prisma } from "@prisma/client";
import type { ListingStatus } from "@prisma/client";

export const listingMutationRepository = {
  async softDelete(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.update({
      where: { id },
      data: { deletedAt: new Date(), status: "REMOVED" },
    });
  },

  /** Fire-and-forget view count increment */
  incrementViewCount(id: string) {
    fireAndForget(
      db.listing.update({
        where: { id },
        data: { viewCount: { increment: 1 } },
      }),
      "listing.incrementViewCount",
      { listingId: id },
    );
  },

  async removeWatch(userId: string, listingId: string) {
    await db.$transaction([
      db.watchlistItem.delete({
        where: { userId_listingId: { userId, listingId } },
      }),
      db.listing.update({
        where: { id: listingId },
        data: { watcherCount: { decrement: 1 } },
      }),
    ]);
  },

  async addWatch(userId: string, listingId: string) {
    await db.$transaction([
      db.watchlistItem.create({ data: { userId, listingId } }),
      db.listing.update({
        where: { id: listingId },
        data: { watcherCount: { increment: 1 } },
      }),
    ]);
  },

  async reserveAtomically(
    id: string,
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: { id, status: "ACTIVE" },
      data: { status: "RESERVED" },
    });
  },

  async releaseReservation(
    id: string,
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: { id, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
  },

  async restoreFromSold(id: string): Promise<void> {
    await db.listing.updateMany({
      where: { id, status: "SOLD" },
      data: { status: "ACTIVE" },
    });
  },

  async updateListing(
    id: string,
    data: Prisma.ListingUncheckedUpdateInput,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.listing.update({ where: { id }, data });
  },

  async create(data: Prisma.ListingUncheckedCreateInput, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.create({ data, select: { id: true } });
  },

  async markSold(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.update({
      where: { id },
      data: { status: "SOLD", soldAt: new Date() },
    });
  },

  async expireActivePast(
    now: Date,
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: {
        status: "ACTIVE",
        expiresAt: { lt: now },
        deletedAt: null,
      },
      data: { status: "EXPIRED" },
    });
  },

  async releaseStaleReservations(
    now: Date,
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: {
        status: "RESERVED",
        reservedUntil: { lt: now },
      },
      data: { status: "ACTIVE", reservedUntil: null },
    });
  },

  async bulkReleaseFromReserved(
    listingIds: string[],
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: { id: { in: listingIds }, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
  },

  async reorderImages(listingId: string, orderedIds: string[], tx?: DbClient) {
    const client = getClient(tx);
    await Promise.all(
      orderedIds.map((id, i) =>
        client.listingImage.update({ where: { id }, data: { order: i } }),
      ),
    );
  },

  async reactivate(id: string, tx?: DbClient): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: { id, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
  },

  async setStatus(id: string, status: ListingStatus, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.update({ where: { id }, data: { status } });
  },

  async disconnectDraftImages(listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listingImage.updateMany({
      where: { listingId },
      data: { listingId: null },
    });
  },

  async associateImageByKey(
    r2Key: string,
    listingId: string,
    order: number,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.listingImage.updateMany({
      where: { r2Key },
      data: { listingId, order },
    });
  },

  async updateListingOptimistic(
    id: string,
    data: Prisma.ListingUncheckedUpdateInput,
    expectedUpdatedAt: Date,
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: { id, updatedAt: expectedUpdatedAt },
      data: { ...data, updatedAt: new Date() },
    });
  },

  async enableSeller(userId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.user.update({
      where: { id: userId },
      data: { isSellerEnabled: true },
    });
  },

  createPriceHistory(listingId: string, priceNzd: number) {
    fireAndForget(
      db.listingPriceHistory.create({ data: { listingId, priceNzd } }),
      "listing.createPriceHistory",
      { listingId, priceNzd },
    );
  },

  async approveListing(listingId: string, adminId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.update({
      where: { id: listingId },
      data: {
        status: "ACTIVE",
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * MS_PER_DAY),
        moderatedBy: adminId,
        moderatedAt: new Date(),
        moderationNote: null,
      },
    });
  },

  async requestChanges(
    listingId: string,
    adminId: string,
    note: string,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.listing.update({
      where: { id: listingId },
      data: {
        status: "NEEDS_CHANGES",
        moderatedBy: adminId,
        moderatedAt: new Date(),
        moderationNote: note,
      },
    });
  },

  async rejectListing(
    listingId: string,
    adminId: string,
    reason: string,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.listing.update({
      where: { id: listingId },
      data: {
        status: "REMOVED",
        moderatedBy: adminId,
        moderatedAt: new Date(),
        moderationNote: reason,
      },
    });
  },

  async $transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return db.$transaction(fn);
  },
};
