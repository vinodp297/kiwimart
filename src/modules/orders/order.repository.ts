// src/modules/orders/order.repository.ts
// ─── Order Repository — data access only, no business logic ─────────────────

import db from "@/lib/db";
import { Prisma } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof db;

export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: {
    listing: { include: { images: true; seller: true } };
    buyer: {
      select: { id: true; displayName: true; username: true; email: true };
    };
    seller: {
      select: {
        id: true;
        displayName: true;
        username: true;
        stripeAccountId: true;
      };
    };
    items: true;
  };
}>;

export type OrderForStatus = Prisma.OrderGetPayload<{
  select: {
    id: true;
    status: true;
    buyerId: true;
    sellerId: true;
    listingId: true;
    createdAt: true;
    itemNzd: true;
    totalNzd: true;
    stripePaymentIntentId: true;
  };
}>;

export const orderRepository = {
  // ── Service-layer methods (wired in order.service.ts) ───────────────────

  async findByIdForDelivery(id: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        status: true,
        stripePaymentIntentId: true,
        totalNzd: true,
      },
    });
  },

  async findByIdForDispatch(id: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id },
      select: {
        id: true,
        sellerId: true,
        status: true,
        buyerId: true,
        listing: { select: { title: true } },
        buyer: { select: { email: true, displayName: true } },
      },
    });
  },

  async findByIdForDispute(id: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        dispatchedAt: true,
        fulfillmentType: true,
        listing: { select: { title: true } },
        seller: { select: { email: true, displayName: true } },
        buyer: { select: { displayName: true } },
      },
    });
  },

  async findByIdForCancel(id: string, userId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findFirst({
      where: {
        id,
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        createdAt: true,
        listingId: true,
      },
    });
  },

  async findByIdForCancellationEmail(id: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id },
      select: {
        totalNzd: true,
        buyer: { select: { email: true, displayName: true } },
        seller: { select: { email: true, displayName: true } },
        listing: { select: { title: true } },
      },
    });
  },

  async findSellerStripeAccount(sellerId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.user.findUnique({
      where: { id: sellerId },
      select: { stripeAccountId: true },
    });
  },

  async findListingTitle(listingId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.listing.findUnique({
      where: { id: listingId },
      select: { title: true },
    });
  },

  /** Mark payouts as PROCESSING inside a transaction */
  async markPayoutsProcessing(orderId: string, tx: DbClient) {
    return tx.payout.updateMany({
      where: { orderId },
      data: { status: "PROCESSING", initiatedAt: new Date() },
    });
  },

  /** Mark listing as SOLD inside a transaction */
  async markListingSold(listingId: string, tx: DbClient) {
    return tx.listing.update({
      where: { id: listingId },
      data: { status: "SOLD", soldAt: new Date() },
    });
  },

  /** Reactivate a reserved listing inside a transaction */
  async reactivateListingInTx(listingId: string, tx: DbClient) {
    return tx.listing.updateMany({
      where: { id: listingId, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
  },

  /** Run a callback inside a transaction */
  async $transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return db.$transaction(fn);
  },

  // ── Order Event methods (wired in order-event.service.ts) ───────────────

  createEvent(data: Prisma.OrderEventUncheckedCreateInput) {
    return db.orderEvent.create({ data });
  },

  async findEventsByOrderId(orderId: string) {
    return db.orderEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        actorRole: true,
        summary: true,
        metadata: true,
        createdAt: true,
        actor: {
          select: {
            id: true,
            displayName: true,
            username: true,
          },
        },
      },
    });
  },

  // ── Transition methods (wired in order.transitions.ts) ──────────────────

  async findByIdForTransition(id: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
  },

  async updateStatusOptimistic(
    id: string,
    currentStatus: string,
    newStatus: string,
    data: Record<string, unknown>,
    tx?: DbClient,
  ) {
    const client = tx ?? db;
    // Import OrderStatus dynamically to avoid circular dependency
    return client.order.updateMany({
      where: {
        id,
        status: currentStatus as Prisma.OrderGetPayload<
          Record<string, unknown>
        >["status"],
      },
      data: {
        status: newStatus as Prisma.OrderGetPayload<
          Record<string, unknown>
        >["status"],
        ...data,
      },
    });
  },

  // ── Phase 2B methods (wired from server actions) ───────────────────────

  async findByIdWithRelations(
    id: string,
    tx?: DbClient,
  ): Promise<OrderWithRelations | null> {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id },
      include: {
        listing: { include: { images: true, seller: true } },
        buyer: {
          select: { id: true, displayName: true, username: true, email: true },
        },
        seller: {
          select: {
            id: true,
            displayName: true,
            username: true,
            stripeAccountId: true,
          },
        },
        items: true,
      },
    }) as Promise<OrderWithRelations | null>;
  },

  async findByIdForStatus(
    id: string,
    tx?: DbClient,
  ): Promise<OrderForStatus | null> {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        createdAt: true,
        itemNzd: true,
        totalNzd: true,
        stripePaymentIntentId: true,
      },
    });
  },

  async findByIdForUser(
    id: string,
    userId: string,
    tx?: DbClient,
  ): Promise<OrderForStatus | null> {
    const client = tx ?? db;
    return client.order.findFirst({
      where: { id, OR: [{ buyerId: userId }, { sellerId: userId }] },
      select: {
        id: true,
        status: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        createdAt: true,
        itemNzd: true,
        totalNzd: true,
        stripePaymentIntentId: true,
      },
    });
  },

  async findByIdempotencyKey(key: string, buyerId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findFirst({
      where: { idempotencyKey: key, buyerId },
      select: {
        id: true,
        status: true,
        stripePaymentIntentId: true,
        listingId: true,
      },
    });
  },

  async createInTx(data: Prisma.OrderUncheckedCreateInput, tx: DbClient) {
    return tx.order.create({ data, select: { id: true } });
  },

  async setStripePaymentIntentId(
    id: string,
    stripePaymentIntentId: string,
    tx?: DbClient,
  ) {
    const client = tx ?? db;
    return client.order.update({
      where: { id },
      data: { stripePaymentIntentId },
    });
  },

  async findStripePaymentIntentId(id: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id },
      select: { stripePaymentIntentId: true },
    });
  },

  async findByBuyer(
    buyerId: string,
    take: number,
    cursor?: string,
    tx?: DbClient,
  ): Promise<OrderForStatus[]> {
    const client = tx ?? db;
    return client.order.findMany({
      where: { buyerId },
      select: {
        id: true,
        status: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        createdAt: true,
        itemNzd: true,
        totalNzd: true,
        stripePaymentIntentId: true,
      },
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  },

  async countRecentBuyerDisputes(
    buyerId: string,
    since: Date,
    tx?: DbClient,
  ): Promise<number> {
    const client = tx ?? db;
    return client.dispute.count({
      where: {
        order: { buyerId },
        openedAt: { gte: since },
      },
    });
  },

  // ── CreateOrder helpers ─────────────────────────────────────────────────

  async findListingForOrder(listingId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.listing.findUnique({
      where: { id: listingId, status: "ACTIVE", deletedAt: null },
      select: {
        id: true,
        title: true,
        priceNzd: true,
        shippingNzd: true,
        shippingOption: true,
        sellerId: true,
        seller: {
          select: {
            stripeAccountId: true,
            stripeOnboarded: true,
            displayName: true,
            email: true,
          },
        },
      },
    });
  },

  async reserveListing(listingId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.listing.updateMany({
      where: { id: listingId, status: "ACTIVE" },
      data: { status: "RESERVED" },
    });
  },

  async releaseListing(listingId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.listing.updateMany({
      where: { id: listingId, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
  },

  async findBuyerDisplayName(userId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
  },

  async updateScheduleDeadlineJobId(
    orderId: string,
    jobId: string,
    tx?: DbClient,
  ) {
    const client = tx ?? db;
    return client.order.update({
      where: { id: orderId },
      data: { scheduleDeadlineJobId: jobId },
    });
  },
};
