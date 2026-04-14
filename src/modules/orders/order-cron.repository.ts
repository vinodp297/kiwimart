// src/modules/orders/order-cron.repository.ts
// ─── Finders used ONLY by background cron / worker jobs ──────────────────────

import db, { getClient, type DbClient } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const orderCronRepository = {
  async countEligibleForAutoRelease(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    const [dispatched, cash] = await Promise.all([
      db.order.count({
        where: {
          status: "DISPATCHED",
          dispatchedAt: { not: null, gte: cutoffDate },
        },
      }),
      db.order.count({
        where: {
          status: "COMPLETED",
          fulfillmentType: "CASH_ON_PICKUP",
          completedAt: { not: null, gte: cutoffDate },
          payout: { status: "PENDING" },
        },
      }),
    ]);
    return dispatched + cash;
  },

  async findUndispatchedOlderThan(cutoff: Date, take: number, tx?: DbClient) {
    const client = getClient(tx);
    return client.order.findMany({
      where: {
        status: "PAYMENT_HELD",
        createdAt: { lte: cutoff },
      },
      take,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        sellerId: true,
        createdAt: true,
        listing: { select: { title: true } },
        buyer: { select: { displayName: true } },
      },
    });
  },

  async findDispatchedForAutoRelease(
    cutoff: Date,
    take: number,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.order.findMany({
      where: {
        status: "DISPATCHED",
        dispatchedAt: { not: null, gte: cutoff },
      },
      take,
      orderBy: { dispatchedAt: "asc" },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        totalNzd: true,
        stripePaymentIntentId: true,
        dispatchedAt: true,
        listing: { select: { title: true, id: true } },
        buyer: { select: { email: true, displayName: true } },
        seller: { select: { email: true, displayName: true } },
      },
    });
  },

  async findCashPickupReadyForPayoutRelease(
    cutoff: Date,
    take: number,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.order.findMany({
      where: {
        status: "COMPLETED",
        fulfillmentType: "CASH_ON_PICKUP",
        completedAt: { not: null, gte: cutoff },
        payout: { status: "PENDING" },
      },
      take,
      orderBy: { completedAt: "asc" },
      select: {
        id: true,
        sellerId: true,
        completedAt: true,
        payout: { select: { id: true, status: true } },
      },
    });
  },

  async findListingTitleForOrder(
    orderId: string,
    tx?: DbClient,
  ): Promise<string | null> {
    const client = getClient(tx);
    const order = await client.order.findUnique({
      where: { id: orderId },
      select: { listing: { select: { title: true } } },
    });
    return order?.listing?.title ?? null;
  },

  async findDispatchedForReminders(take: number, tx?: DbClient) {
    const client = getClient(tx);
    return client.order.findMany({
      where: {
        status: "DISPATCHED",
        dispatchedAt: { not: null },
      },
      take,
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        totalNzd: true,
        stripePaymentIntentId: true,
        dispatchedAt: true,
        listing: { select: { title: true, id: true } },
        buyer: { select: { email: true, displayName: true } },
      },
    });
  },

  async findReminderEventsForOrders(
    orderIds: string[],
    tx?: DbClient,
  ): Promise<
    Array<{
      id: string;
      orderId: string;
      type: string;
      metadata: Prisma.JsonValue;
    }>
  > {
    const client = getClient(tx);
    return client.orderEvent.findMany({
      where: {
        orderId: { in: orderIds },
        type: { in: ["DISPATCHED", "DELIVERY_REMINDER_SENT"] },
      },
      select: { id: true, orderId: true, type: true, metadata: true },
    });
  },

  async findDispatchedInWindow(
    windowStart: Date,
    windowEnd: Date,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.order.findMany({
      where: {
        status: "DISPATCHED",
        dispatchedAt: { gte: windowStart, lt: windowEnd },
      },
      select: {
        id: true,
        listing: { select: { title: true } },
        buyer: { select: { email: true, displayName: true } },
        trackingNumber: true,
      },
    });
  },

  async findListingIdsWithActiveOrders(
    listingIds: string[],
    tx?: DbClient,
  ): Promise<string[]> {
    const client = getClient(tx);
    const rows = await client.order.findMany({
      where: {
        listingId: { in: listingIds },
        status: {
          in: [
            "PAYMENT_HELD",
            "DISPATCHED",
            "DELIVERED",
            "COMPLETED",
            "DISPUTED",
          ],
        },
      },
      select: { listingId: true },
    });
    return Array.from(new Set(rows.map((o) => o.listingId)));
  },

  async findQueuedAutoResolutionEvents(take: number, tx?: DbClient) {
    const client = getClient(tx);
    return client.orderEvent.findMany({
      where: {
        type: "AUTO_RESOLVED",
        metadata: { path: ["status"], equals: "QUEUED" },
      },
      take,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        orderId: true,
        metadata: true,
        createdAt: true,
      },
    });
  },

  async findStatusesByIds(orderIds: string[], tx?: DbClient) {
    const client = getClient(tx);
    return client.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, status: true },
    });
  },

  async findCounterEvidenceForOrders(orderIds: string[], tx?: DbClient) {
    const client = getClient(tx);
    return client.orderEvent.findMany({
      where: {
        orderId: { in: orderIds },
        type: "DISPUTE_RESPONDED",
      },
      select: { orderId: true, createdAt: true },
    });
  },

  async findUnresponsiveDisputes(
    responseDeadline: Date,
    take: number,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.order.findMany({
      where: {
        status: "DISPUTED",
        dispute: {
          openedAt: { lte: responseDeadline },
          sellerRespondedAt: null,
          resolvedAt: null,
        },
      },
      take,
      orderBy: { dispute: { openedAt: "asc" } },
      select: { id: true },
    });
  },

  async findPaymentHeldWithPiSince(since: Date, take: number, tx?: DbClient) {
    const client = getClient(tx);
    return client.order.findMany({
      where: {
        status: "PAYMENT_HELD",
        stripePaymentIntentId: { not: null },
        createdAt: { gte: since },
      },
      select: {
        id: true,
        stripePaymentIntentId: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        createdAt: true,
      },
      take,
    });
  },

  async findAwaitingPaymentWithPiOlderThan(
    cutoff: Date,
    take: number,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.order.findMany({
      where: {
        status: "AWAITING_PAYMENT",
        stripePaymentIntentId: { not: null },
        createdAt: { lte: cutoff },
      },
      select: { id: true, stripePaymentIntentId: true, listingId: true },
      take,
      orderBy: { createdAt: "asc" },
    });
  },

  async findPaymentHeldWithPiOlderThan(
    cutoff: Date,
    take: number,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.order.findMany({
      where: {
        status: "PAYMENT_HELD",
        stripePaymentIntentId: { not: null },
        createdAt: { lte: cutoff },
      },
      select: {
        id: true,
        stripePaymentIntentId: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        createdAt: true,
      },
      take,
      orderBy: { createdAt: "asc" },
    });
  },

  async countMetrics(
    awaitingCutoff: Date,
    heldCutoff: Date,
  ): Promise<{
    awaitingPaymentStale: number;
    paymentHeldStale: number;
    disputedOpen: number;
  }> {
    const [awaitingPaymentStale, paymentHeldStale, disputedOpen] =
      await Promise.all([
        db.order.count({
          where: {
            status: "AWAITING_PAYMENT",
            stripePaymentIntentId: { not: null },
            createdAt: { lte: awaitingCutoff },
          },
        }),
        db.order.count({
          where: {
            status: "PAYMENT_HELD",
            createdAt: { lte: heldCutoff },
          },
        }),
        db.order.count({ where: { status: "DISPUTED" } }),
      ]);
    return { awaitingPaymentStale, paymentHeldStale, disputedOpen };
  },

  async findQueuedAutoResolutionsForOrders(
    orderIds: string[],
    tx?: DbClient,
  ): Promise<Array<{ orderId: string }>> {
    const client = getClient(tx);
    return client.orderEvent.findMany({
      where: {
        orderId: { in: orderIds },
        type: "AUTO_RESOLVED",
        metadata: { path: ["status"], equals: "QUEUED" },
      },
      select: { orderId: true },
    });
  },
};
