// src/modules/orders/order.repository.ts
// ─── Order Repository — data access only, no business logic ─────────────────

import db, { getClient, type DbClient } from "@/lib/db";

export type { DbClient };
import { Prisma } from "@prisma/client";
import { fireAndForget } from "@/lib/fire-and-forget";

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

  // findByIdForDispatch — consolidated into findWithDisputeContext (superset)

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

  /** Fetch buyer + seller details and listing title for order-related emails.
   * Used by completion, cancellation, and dispute-resolution email flows. */
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

  /** Fetch the minimal order fields needed to evaluate a dispute. */
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

  /** Fetch order parties and listing title for cooling-period notification. */
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

  /** Fetch order with dispute + listing context for inconsistency analysis. */
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

  /** Fetch the DELIVERY_CONFIRMED_OK event for an order (inconsistency analysis). */
  async findDeliveryOkEvent(orderId: string) {
    return db.orderEvent.findFirst({
      where: { orderId, type: "DELIVERY_CONFIRMED_OK" },
      select: { createdAt: true, metadata: true },
    });
  },

  /** Fetch the DISPATCHED event for an order (inconsistency analysis). */
  async findDispatchEvent(orderId: string) {
    return db.orderEvent.findFirst({
      where: { orderId, type: "DISPATCHED" },
      select: { metadata: true },
    });
  },

  // ── Webhook helpers ───────────────────────────────────────────────────────

  /** Fetch order status and fulfilment type for webhook idempotency checks. */
  async findForWebhookStatus(
    orderId: string,
  ): Promise<{ status: string; fulfillmentType: string } | null> {
    return db.order.findUnique({
      where: { id: orderId },
      select: { status: true, fulfillmentType: true },
    });
  },

  /** Find an order by its Stripe PaymentIntent ID — used by charge.* webhook handlers. */
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

  /** Record a Stripe event ID to enable idempotent webhook processing. */
  async createStripeEvent(id: string, type: string): Promise<void> {
    await db.stripeEvent.create({ data: { id, type } });
  },

  /** Delete a Stripe event record when the handler fails (allows Stripe retry). */
  async deleteStripeEvent(id: string): Promise<void> {
    await db.stripeEvent.delete({ where: { id } });
  },

  /** Update a payout record when Stripe confirms a transfer has been created. */
  async updatePayoutByTransferId(transferId: string): Promise<void> {
    await db.payout.updateMany({
      where: { stripeTransferId: transferId },
      data: { status: "PROCESSING" },
    });
  },

  /** Fetch order for support admin lookup. */
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

  // findForCounterEvidence — consolidated into findWithDisputeContext (superset)

  /** Find the latest QUEUED auto-resolution event for an order. */
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

  /** Fetch order detail for the order detail page. */
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

  // findForDisputeResponse — consolidated into findWithDisputeContext (superset)

  /** Fetch order for problemResolver action. */
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

  /** Fetch order for initiatePickupOTP action (seller auth + OTP initiation). */
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

  /** Fetch order for confirmPickupOTP action (buyer OTP entry + payment capture). */
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

  /** Fetch order for rejectItemAtPickup action (buyer rejection + dispute creation). */
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

  /** Store the BullMQ job ID for the OTP expiry job (fire-and-forget). */
  async updateOtpJobId(orderId: string, otpJobId: string): Promise<void> {
    await db.order.update({
      where: { id: orderId },
      data: { otpJobId },
    });
  },

  /** Run a callback inside a transaction.
   *
   * @param options.timeout  Max ms the transaction may run (default: 5000).
   *   Set to 10 000 for complex multi-table transactions at risk of P2028.
   * @param options.maxWait  Max ms to wait for a connection slot (default: 2000).
   */
  async $transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T> {
    // Only forward options when explicitly provided — avoids passing `undefined`
    // as a second argument to db.$transaction, which some test assertions check.
    return options !== undefined
      ? db.$transaction(fn, options)
      : db.$transaction(fn);
  },

  // ── Order Event methods (wired in order-event.service.ts) ───────────────

  createEvent(data: Prisma.OrderEventUncheckedCreateInput, tx?: DbClient) {
    const client = getClient(tx);
    return client.orderEvent.create({ data });
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
    const client = getClient(tx);
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
    const client = getClient(tx);
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

  /** Attach a Stripe PaymentIntent to an order that was created without one. */
  async attachPaymentIntent(id: string, piId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.order.update({
      where: { id },
      data: { stripePaymentIntentId: piId },
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
    const client = getClient(tx);
    return client.order.update({
      where: { id },
      data: { stripePaymentIntentId },
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

  /** Count orders in active escrow states for a user (pre-flight check before account erasure). */
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

  // ── CreateOrder helpers ─────────────────────────────────────────────────

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

  /**
   * Reserve a listing for an in-flight checkout (Fix 10).
   *
   * Sets status=RESERVED and stamps a 10-minute reservation deadline. The
   * `where` clause matches either an ACTIVE listing OR a RESERVED listing
   * whose previous reservation has already lapsed — this lets a second buyer
   * recover inventory that the release-stale-reservations cron has not yet
   * swept up. updateMany returns count=0 if neither condition holds, which
   * the caller treats as "listing already taken".
   */
  async reserveListing(listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    const now = new Date();
    const reservedUntil = new Date(now.getTime() + 10 * 60 * 1000);
    return client.listing.updateMany({
      where: {
        id: listingId,
        OR: [
          { status: "ACTIVE" },
          { status: "RESERVED", reservedUntil: { lt: now } },
        ],
      },
      data: { status: "RESERVED", reservedUntil },
    });
  },

  async releaseListing(listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: { id: listingId, status: "RESERVED" },
      data: { status: "ACTIVE", reservedUntil: null },
    });
  },

  async findBuyerDisplayName(userId: string, tx?: DbClient) {
    const client = getClient(tx);
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
    const client = getClient(tx);
    return client.order.update({
      where: { id: orderId },
      data: { scheduleDeadlineJobId: jobId },
    });
  },

  // ── Consolidated context finders (Phase 2, sprint — Phase A) ────────────

  /** Fetch order context needed for any dispute-related admin flow
   * (resolve dispute, partial refund, dispute emails, request-info, pickup dispute).
   * Returns union of fields used across admin.service.ts dispute handlers. */
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

  /** Fetch order context needed by all pickup-flow services
   * (propose, accept, cancel, reschedule, reschedule-respond).
   * Union of fields read across src/server/services/pickup/*.service.ts. */
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

  /** Update pickup-related fields on an order (scheduling, cancellation). */
  async updatePickupFields(
    id: string,
    data: Prisma.OrderUncheckedUpdateInput,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.order.update({ where: { id }, data });
  },

  /** Fire-and-forget setter for the BullMQ pickup window job id. */
  setPickupWindowJobId(id: string, jobId: string): void {
    fireAndForget(
      db.order.update({ where: { id }, data: { pickupWindowJobId: jobId } }),
      "order.pickup.set_window_job_id",
      { orderId: id, jobId },
    );
  },

  /** Fetch order context needed when a user creates or views a review.
   * Returns parties + status + existing review ids for the given reviewerRole. */
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

  /** Fetch buyer and seller IDs for pickup role determination. */
  async findParties(id: string): Promise<{
    buyerId: string;
    sellerId: string;
  } | null> {
    return db.order.findUnique({
      where: { id },
      select: { buyerId: true, sellerId: true },
    });
  },

  /** Count orders in the DISPATCHED + cash-completed backlog potentially eligible
   * for auto-release. Used by autoReleaseEscrow to size the batch fetch adaptively.
   * Applies the same 30-day pre-filter as the main query. */
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

  /**
   * Returns true if userId is the buyer or seller for the given order.
   * Single efficient query — used by the image proxy auth layer.
   */
  async isUserPartyToOrder(orderId: string, userId: string): Promise<boolean> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { buyerId: true, sellerId: true },
    });
    if (!order) return false;
    return order.buyerId === userId || order.sellerId === userId;
  },

  /** Cursor-paginated buyer order list for /api/v1/orders. */
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

  /**
   * Find PAYMENT_HELD orders older than the cutoff — used by the dispatch
   * reminder cron to surface orders the seller has not yet dispatched.
   */
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

  /**
   * Find DISPATCHED orders eligible for the auto-release escrow cron. Pre-
   * filters by `dispatchedAt >= cutoff` so we don't scan the full history;
   * the cron does an in-memory business-day check on the result.
   */
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

  /**
   * Find CASH_ON_PICKUP orders that have completed and whose PENDING payout
   * is awaiting cash-escrow release. Used by autoReleaseEscrow's second loop.
   */
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

  /**
   * Look up just the listing title for an order — used by the payout worker
   * to construct the seller payout-initiated email body.
   */
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

  /**
   * Find DISPATCHED orders for the daily delivery-reminder cron. Returns
   * the buyer/seller/listing context the cron needs to evaluate
   * estimatedDeliveryDate and send reminders.
   */
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

  /**
   * Bulk-fetch DISPATCHED + DELIVERY_REMINDER_SENT events for a list of
   * order ids — used by the delivery-reminder cron to avoid an N+1 query
   * per order.
   */
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

  /**
   * Find DISPATCHED orders whose dispatchedAt falls in the given window —
   * used by the buyer-delivery-reminder cron to identify orders that need a
   * "please confirm delivery" nudge.
   */
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

  /**
   * Find listing IDs that already have an in-flight (paid/dispatched/etc.)
   * order. Used by the offer reservation cron to avoid releasing a listing
   * that the buyer has actually paid for in the meantime.
   */
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

  // ── Auto-resolution / dispute cron methods ─────────────────────────────────

  /** Find queued AUTO_RESOLVED order events past their cooling period (cron). */
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

  /** Bulk-fetch order id+status for the given ids (cron N+1 elimination). */
  async findStatusesByIds(orderIds: string[], tx?: DbClient) {
    const client = getClient(tx);
    return client.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, status: true },
    });
  },

  /** Bulk-fetch DISPUTE_RESPONDED events for the given orders (cron N+1 elimination). */
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

  /** Update an order event's metadata (used by the auto-resolution cooling cron). */
  async updateOrderEventMetadata(
    eventId: string,
    metadata: Prisma.InputJsonValue,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.orderEvent.update({
      where: { id: eventId },
      data: { metadata },
    });
  },

  /** Find DISPUTED orders whose seller has not responded by the deadline. */
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

  /** Fetch the order context needed by the pickup worker handlers. */
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

  /** Upsert a payout to PROCESSING for a pickup order completing on the spot. */
  async upsertPickupPayoutProcessing(
    orderId: string,
    sellerId: string,
    amountNzd: number,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.payout.upsert({
      where: { orderId },
      create: {
        orderId,
        userId: sellerId,
        amountNzd,
        platformFeeNzd: 0,
        stripeFeeNzd: 0,
        status: "PROCESSING",
        initiatedAt: new Date(),
      },
      update: {
        status: "PROCESSING",
        initiatedAt: new Date(),
      },
    });
  },

  /** Find PAYMENT_HELD orders with a Stripe PI created since the cutoff (reconciliation). */
  async findPaymentHeldWithPiSince(since: Date, take: number, tx?: DbClient) {
    const client = getClient(tx);
    return client.order.findMany({
      where: {
        status: "PAYMENT_HELD",
        stripePaymentIntentId: { not: null },
        createdAt: { gte: since },
      },
      select: { id: true, stripePaymentIntentId: true },
      take,
    });
  },

  /** Find AWAITING_PAYMENT orders with a PI created before the cutoff (reconciliation check 1). */
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

  /** Find PAYMENT_HELD orders with a PI created before the cutoff (reconciliation check 2). */
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
      select: { id: true, stripePaymentIntentId: true },
      take,
      orderBy: { createdAt: "asc" },
    });
  },

  /** Count metrics for the admin metrics endpoint (avoids db import in route files). */
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

  /** Bulk-fetch already-queued auto-resolution events for the given orders. */
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
