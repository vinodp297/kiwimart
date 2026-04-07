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

  // ── Auto-resolution helpers ───────────────────────────────────────────────

  /** Fetch the minimal order fields needed to evaluate a dispute.
   * @source src/modules/disputes/auto-resolution.service.ts — evaluateDispute */
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

  /** Fetch order parties and listing title for cooling-period notification.
   * @source src/modules/disputes/auto-resolution.service.ts — queueAutoResolution, executeDecision */
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

  // ── Inconsistency-analysis helpers ────────────────────────────────────────

  /** Fetch order with dispute + listing context for inconsistency analysis.
   * @source src/modules/disputes/inconsistency-analysis.service.ts */
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

  /** Fetch the DELIVERY_CONFIRMED_OK event for an order (inconsistency analysis).
   * @source src/modules/disputes/inconsistency-analysis.service.ts */
  async findDeliveryOkEvent(orderId: string) {
    return db.orderEvent.findFirst({
      where: { orderId, type: "DELIVERY_CONFIRMED_OK" },
      select: { createdAt: true, metadata: true },
    });
  },

  /** Fetch the DISPATCHED event for an order (inconsistency analysis).
   * @source src/modules/disputes/inconsistency-analysis.service.ts */
  async findDispatchEvent(orderId: string) {
    return db.orderEvent.findFirst({
      where: { orderId, type: "DISPATCHED" },
      select: { metadata: true },
    });
  },

  // ── Webhook helpers ───────────────────────────────────────────────────────

  /** Fetch order status and fulfilment type for webhook idempotency checks.
   * @source src/modules/payments/webhook.service.ts */
  async findForWebhookStatus(
    orderId: string,
  ): Promise<{ status: string; fulfillmentType: string } | null> {
    return db.order.findUnique({
      where: { id: orderId },
      select: { status: true, fulfillmentType: true },
    });
  },

  /** Record a Stripe event ID to enable idempotent webhook processing.
   * @source src/modules/payments/webhook.service.ts */
  async createStripeEvent(id: string, type: string): Promise<void> {
    await db.stripeEvent.create({ data: { id, type } });
  },

  /** Delete a Stripe event record when the handler fails (allows Stripe retry).
   * @source src/modules/payments/webhook.service.ts */
  async deleteStripeEvent(id: string): Promise<void> {
    await db.stripeEvent.delete({ where: { id } });
  },

  /** Update a payout record when Stripe confirms a transfer has been created.
   * @source src/modules/payments/webhook.service.ts */
  async updatePayoutByTransferId(transferId: string): Promise<void> {
    await db.payout.updateMany({
      where: { stripeTransferId: transferId },
      data: { status: "PROCESSING" },
    });
  },

  /** Fetch order for support admin lookup.
   * @source src/server/actions/support.ts — lookupOrder */
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

  /** Fetch order for counter-evidence auth + status check.
   * @source src/server/actions/counterEvidence.ts — submitCounterEvidence */
  async findForCounterEvidence(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        listing: { select: { title: true } },
      },
    });
  },

  /** Find the latest QUEUED auto-resolution event for an order.
   * @source src/server/actions/counterEvidence.ts — submitCounterEvidence */
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

  /** Fetch order detail for the order detail page.
   * @source src/server/actions/orderDetail.ts — fetchOrderDetail */
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
      },
    });
  },

  /** Fetch order for dispute response (respondToDispute action).
   * @source src/server/actions/disputes.ts — respondToDispute */
  async findForDisputeResponse(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        sellerId: true,
        buyerId: true,
        status: true,
        listing: { select: { title: true } },
        seller: { select: { displayName: true } },
      },
    });
  },

  /** Fetch order for problemResolver action.
   * @source src/server/actions/problemResolver.ts — submitProblem */
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

  /** Fetch order for initiatePickupOTP action (seller auth + OTP initiation).
   * @source src/server/actions/pickup.actions.ts — initiatePickupOTP */
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

  /** Fetch order for confirmPickupOTP action (buyer OTP entry + payment capture).
   * @source src/server/actions/pickup.actions.ts — confirmPickupOTP */
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

  /** Fetch order for rejectItemAtPickup action (buyer rejection + dispute creation).
   * @source src/server/actions/pickup.actions.ts — rejectItemAtPickup */
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

  /** Store the BullMQ job ID for the OTP expiry job (fire-and-forget).
   * @source src/server/actions/pickup.actions.ts — initiatePickupOTP */
  async updateOtpJobId(orderId: string, otpJobId: string): Promise<void> {
    await db.order.update({
      where: { id: orderId },
      data: { otpJobId },
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

  /** Count orders in active escrow states for a user (pre-flight check before account erasure).
   * @source src/modules/users/erasure.service.ts — performAccountErasure */
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
            isStripeOnboarded: true,
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

  // ── Consolidated context finders (Phase 2, sprint — Phase A) ────────────

  /** Fetch order context needed for any dispute-related admin flow
   * (resolve dispute, partial refund, dispute emails, request-info, pickup dispute).
   * Returns union of fields used across admin.service.ts dispute handlers.
   * @source src/modules/admin/admin.service.ts, src/server/services/pickup/pickup-dispute-resolver.service.ts */
  async findWithDisputeContext(id: string, tx?: DbClient) {
    const client = tx ?? db;
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

  /** Fetch order context needed by all pickup-flow services
   * (propose, accept, cancel, reschedule, reschedule-respond).
   * Union of fields read across src/server/services/pickup/*.service.ts. */
  async findWithPickupContext(id: string, tx?: DbClient) {
    const client = tx ?? db;
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

  /** Update pickup-related fields on an order (scheduling, cancellation).
   * @source src/server/services/pickup/*.service.ts */
  async updatePickupFields(
    id: string,
    data: Prisma.OrderUncheckedUpdateInput,
    tx?: DbClient,
  ): Promise<void> {
    const client = tx ?? db;
    await client.order.update({ where: { id }, data });
  },

  /** Fire-and-forget setter for the BullMQ pickup window job id.
   * @source src/server/services/pickup/pickup-proposal.service.ts */
  setPickupWindowJobId(id: string, jobId: string): void {
    db.order
      .update({ where: { id }, data: { pickupWindowJobId: jobId } })
      .catch(() => {});
  },

  /** Fetch order context needed when a user creates or views a review.
   * Returns parties + status + existing review ids for the given reviewerRole.
   * @source src/modules/reviews/review.service.ts — createReview */
  async findWithReviewContext(
    id: string,
    reviewerRole: "BUYER" | "SELLER",
    tx?: DbClient,
  ) {
    const client = tx ?? db;
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
};
