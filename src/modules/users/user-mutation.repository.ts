// src/modules/users/user-mutation.repository.ts
// ─── User CRUD + business mutations ───────────────────────────────────────────

import db, { getClient, type DbClient } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const userMutationRepository = {
  async create(data: Prisma.UserCreateInput): Promise<{
    id: string;
    email: string;
    displayName: string;
    username: string;
  }> {
    return db.user.create({
      data,
      select: { id: true, email: true, displayName: true, username: true },
    });
  },

  async update(
    id: string,
    data: Prisma.UserUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.user.update({ where: { id }, data });
  },

  async setBanState(
    id: string,
    isBanned: boolean,
    reason: string | null,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.user.update({
      where: { id },
      data: isBanned
        ? { isBanned: true, bannedAt: new Date(), bannedReason: reason }
        : { isBanned: false, bannedAt: null, bannedReason: null },
    });
  },

  async setSellerEnabled(
    id: string,
    value: boolean,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.user.update({
      where: { id },
      data: { isSellerEnabled: value },
    });
  },

  async updateByStripeAccountId(
    stripeAccountId: string,
    data: Prisma.UserUpdateInput,
  ): Promise<void> {
    await db.user.updateMany({ where: { stripeAccountId }, data });
  },

  async applySellerTierDowngrade(
    sellerId: string,
    downgradedTier: string,
    reason: string,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.user.update({
      where: { id: sellerId },
      data: {
        sellerTierOverride: downgradedTier,
        sellerTierOverrideReason: reason,
        sellerTierOverrideAt: new Date(),
        sellerTierOverrideBy: "SYSTEM",
      },
    });
  },

  async findSellersExceedingDisputeRate(
    disputeRateThreshold: number,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.user.findMany({
      where: {
        isSellerEnabled: true,
        isBanned: false,
        sellerTierOverride: null,
        trustMetrics: {
          disputeRate: { gt: disputeRateThreshold },
        },
      },
      select: {
        id: true,
        trustMetrics: {
          select: {
            completedOrders: true,
            totalOrders: true,
            averageRating: true,
            disputeRate: true,
          },
        },
      },
    });
  },

  async findSellersWithOpenDisputes(tx?: DbClient) {
    const client = getClient(tx);
    return client.user.findMany({
      where: {
        isSellerEnabled: true,
        isBanned: false,
        sellerTierOverride: null,
        sellerOrders: {
          some: { status: "DISPUTED" },
        },
      },
      select: {
        id: true,
        trustMetrics: {
          select: {
            completedOrders: true,
            totalOrders: true,
            averageRating: true,
            disputeRate: true,
          },
        },
        _count: {
          select: {
            sellerOrders: { where: { status: "DISPUTED" } },
          },
        },
      },
    });
  },

  async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return db.$transaction(fn);
  },
};
