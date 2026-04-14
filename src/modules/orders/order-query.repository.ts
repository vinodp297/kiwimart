// src/modules/orders/order-query.repository.ts
// ─── Real-time query methods (services, server actions, webhooks, workers) ────

import db, { getClient, type DbClient } from "@/lib/db";
import { Prisma } from "@prisma/client";

export type { DbClient };

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

export const orderQueryRepository = {
  async findByIdForDelivery(id: string, tx?: DbClient) {
    const client = getClient(tx);
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

  async findByIdForDispute(id: string, tx?: DbClient) {
    const client = getClient(tx);
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
    const client = getClient(tx);
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
        stripePaymentIntentId: true,
      },
    });
  },

  async findByIdForEmail(id: string, tx?: DbClient) {
    const client = getClient(tx);
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
    const client = getClient(tx);
    return client.user.findUnique({
      where: { id: sellerId },
      select: { stripeAccountId: true },
    });
  },

  async findListingTitle(listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: { id: listingId },
      select: { title: true },
    });
  },

  async findForAutoResolutionEvaluate(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        totalNzd: true,
        trackingNumber: true,
        dispatchedAt: true,
        completedAt: true,
        stripePaymentIntentId: true,
      },
    });
  },

  async findForAutoResolutionExecute(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        totalNzd: true,
        stripePaymentIntentId: true,
        listing: { select: { id: true, title: true } },
      },
    });
  },

  async findWithInconsistencyContext(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        trackingNumber: true,
        dispatchedAt: true,
        completedAt: true,
        dispute: {
          select: {
            reason: true,
            buyerStatement: true,
            openedAt: true,
            sellerStatement: true,
            sellerRespondedAt: true,
          },
        },
        listing: {
          select: {
            title: true,
            condition: true,
            description: true,
          },
        },
      },
    });
  },

  async findDeliveryOkEvent(orderId: string) {
    return db.orderEvent.findFirst({
      where: { orderId, type: "DELIVERY_CONFIRMED_OK" },
      select: { createdAt: true, metadata: true },
    });
  },

  async findDispatchEvent(orderId: string) {
    return db.orderEvent.findFirst({
      where: { orderId, type: "DISPATCHED" },
      select: { metadata: true },
    });
  },

  async findForWebhookStatus(
    orderId: string,
  ): Promise<{ status: string; fulfillmentType: string } | null> {
    return db.order.findUnique({
      where: { id: orderId },
      select: { status: true, fulfillmentType: true },
    });
  },

  async findByStripePaymentIntentId(
    stripePaymentIntentId: string,
    tx?: DbClient,
  ): Promise<{
    id: string;
    status: string;
    buyerId: string;
    sellerId: string;
    listingId: string | null;
  } | null> {
    const client = getClient(tx);
    return client.order.findFirst({
      where: { stripePaymentIntentId },
      select: {
        id: true,
        status: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
      },
    });
  },

  async findForSupportLookup(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      include: {
        listing: { select: { title: true, priceNzd: true } },
        buyer: { select: { displayName: true, email: true } },
        seller: { select: { displayName: true, email: true } },
      },
    });
  },

  async findQueuedAutoResolutionEvent(orderId: string) {
    return db.orderEvent.findFirst({
      where: {
        orderId,
        type: "AUTO_RESOLVED",
        metadata: { path: ["status"], equals: "QUEUED" },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async findForOrderDetail(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        itemNzd: true,
        shippingNzd: true,
        totalNzd: true,
        status: true,
        createdAt: true,
        dispatchedAt: true,
        deliveredAt: true,
        completedAt: true,
        trackingNumber: true,
        trackingUrl: true,
        dispute: {
          select: {
            reason: true,
            status: true,
            buyerStatement: true,
            sellerStatement: true,
            openedAt: true,
            sellerRespondedAt: true,
            resolvedAt: true,
          },
        },
        cancelledBy: true,
        cancelReason: true,
        cancelledAt: true,
        fulfillmentType: true,
        pickupStatus: true,
        pickupScheduledAt: true,
        pickupWindowExpiresAt: true,
        otpExpiresAt: true,
        rescheduleCount: true,
        listing: {
          select: {
            title: true,
            images: { where: { order: 0 }, select: { r2Key: true }, take: 1 },
          },
        },
        buyer: { select: { displayName: true, username: true } },
        seller: { select: { displayName: true, username: true } },
        reviews: {
          select: { id: true, reviewerRole: true },
        },
        payout: {
          select: {
            status: true,
            amountNzd: true,
            platformFeeNzd: true,
            stripeFeeNzd: true,
          },
        },
      },
    });
  },

  async findForProblemResolver(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        totalNzd: true,
        createdAt: true,
        stripePaymentIntentId: true,
        dispute: { select: { openedAt: true } },
        listing: { select: { title: true } },
        seller: { select: { displayName: true, email: true } },
      },
    });
  },

  async findForInitiateOTP(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        fulfillmentType: true,
        pickupStatus: true,
        pickupScheduledAt: true,
        pickupWindowExpiresAt: true,
        buyer: {
          select: { phone: true, displayName: true },
        },
        listing: { select: { title: true } },
      },
    });
  },

  async findForConfirmOTP(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        fulfillmentType: true,
        pickupStatus: true,
        stripePaymentIntentId: true,
        totalNzd: true,
        listingId: true,
        otpJobId: true,
        pickupWindowJobId: true,
        listing: { select: { title: true } },
        seller: { select: { stripeAccountId: true } },
      },
    });
  },

  async findForRejectAtPickup(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        fulfillmentType: true,
        pickupStatus: true,
        otpJobId: true,
        listingId: true,
        listing: { select: { title: true } },
      },
    });
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

  async findByIdForTransition(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.order.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
  },

  async findByIdWithRelations(
    id: string,
    tx?: DbClient,
  ): Promise<OrderWithRelations | null> {
    const client = getClient(tx);
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
    const client = getClient(tx);
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
    const client = getClient(tx);
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
    const client = getClient(tx);
    return client.order.findUnique({
      where: { buyerId_idempotencyKey: { buyerId, idempotencyKey: key } },
      select: {
        id: true,
        status: true,
        stripePaymentIntentId: true,
        listingId: true,
        totalNzd: true,
        sellerId: true,
        listing: { select: { title: true } },
      },
    });
  },

  async findStripePaymentIntentId(id: string, tx?: DbClient) {
    const client = getClient(tx);
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
    const client = getClient(tx);
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

  async countActiveOrdersForUser(userId: string): Promise<number> {
    return db.order.count({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
        status: {
          in: ["AWAITING_PAYMENT", "PAYMENT_HELD", "DISPATCHED", "DISPUTED"],
        },
      },
    });
  },

  async countRecentBuyerDisputes(
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

  async findListingForOrder(listingId: string, tx?: DbClient) {
    const client = getClient(tx);
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
            isStripeOnboarded: true,
            displayName: true,
            email: true,
          },
        },
      },
    });
  },

  async findBuyerDisplayName(userId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
  },

  async findWithDisputeContext(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        totalNzd: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        stripePaymentIntentId: true,
        buyer: { select: { email: true, displayName: true } },
        seller: { select: { email: true, displayName: true } },
        listing: { select: { title: true } },
      },
    });
  },

  async findWithPickupContext(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.order.findUnique({
      where: { id },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        fulfillmentType: true,
        pickupStatus: true,
        pickupScheduledAt: true,
        rescheduleCount: true,
        stripePaymentIntentId: true,
        totalNzd: true,
        listingId: true,
        listing: { select: { title: true, pickupAddress: true } },
      },
    });
  },

  async findWithReviewContext(
    id: string,
    reviewerRole: "BUYER" | "SELLER",
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.order.findUnique({
      where: { id },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        reviews: {
          where: { reviewerRole },
          select: { id: true },
        },
      },
    });
  },

  async findParties(id: string): Promise<{
    buyerId: string;
    sellerId: string;
  } | null> {
    return db.order.findUnique({
      where: { id },
      select: { buyerId: true, sellerId: true },
    });
  },

  async isUserPartyToOrder(orderId: string, userId: string): Promise<boolean> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { buyerId: true, sellerId: true },
    });
    if (!order) return false;
    return order.buyerId === userId || order.sellerId === userId;
  },

  async findByBuyerCursor(
    buyerId: string,
    limit: number,
    cursor?: string,
  ): Promise<
    {
      id: string;
      status: string;
      totalNzd: number;
      createdAt: Date;
      listing: { id: string; title: string };
    }[]
  > {
    return db.order.findMany({
      where: { buyerId },
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        status: true,
        totalNzd: true,
        createdAt: true,
        listing: { select: { id: true, title: true } },
      },
    });
  },

  async findForPickupHandler(orderId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        pickupStatus: true,
        totalNzd: true,
        stripePaymentIntentId: true,
        listingId: true,
        listing: { select: { title: true } },
      },
    });
  },
};
