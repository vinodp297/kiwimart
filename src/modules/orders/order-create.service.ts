// src/modules/orders/order-create.service.ts
// ─── Order creation ───────────────────────────────────────────────────────────
// Exports: createOrder

import { audit } from "@/server/lib/audit";
import { formatCentsAsNzd } from "@/lib/currency";
import { paymentService } from "@/modules/payments/payment.service";
import { stripe } from "@/infrastructure/stripe/client";
import { withStripeTimeout } from "@/infrastructure/stripe/with-timeout";
import { transitionOrder } from "./order.transitions";
import { logger } from "@/shared/logger";
import { userRepository } from "@/modules/users/user.repository";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "./order-event.service";
import { captureListingSnapshot } from "@/server/services/listing-snapshot.service";
import { orderRepository } from "./order.repository";
import {
  handleCashOnPickup,
  notifyOrderCreated,
  schedulePickupDeadline,
} from "./order-create-helpers";

// ── createOrder ───────────────────────────────────────────────────────────────

export async function createOrder(
  userId: string,
  userEmail: string,
  params: {
    listingId: string;
    idempotencyKey?: string;
    fulfillmentType?: "SHIPPED" | "CASH_ON_PICKUP" | "ONLINE_PAYMENT_PICKUP";
    shippingAddress?: {
      name: string;
      line1: string;
      line2?: string;
      city: string;
      region: string;
      postcode: string;
    };
  },
  ip: string,
): Promise<
  | { ok: true; orderId: string; clientSecret: string | null }
  | { ok: false; error: string; reason?: string }
> {
  const { listingId, idempotencyKey, shippingAddress } = params;
  const fulfillmentType = params.fulfillmentType ?? "SHIPPED";

  // Email verification check
  const buyer = await userRepository.findEmailVerified(userId);
  if (!buyer?.emailVerified) {
    return {
      ok: false,
      error: "Please verify your email address before placing an order.",
      reason: "email_not_verified",
    };
  }

  // Idempotency check
  if (idempotencyKey) {
    const existingOrder = await orderRepository.findByIdempotencyKey(
      idempotencyKey,
      userId,
    );
    if (
      existingOrder &&
      existingOrder.status === "AWAITING_PAYMENT" &&
      existingOrder.stripePaymentIntentId &&
      existingOrder.listingId === listingId
    ) {
      const clientSecret = await paymentService.getClientSecret(
        existingOrder.stripePaymentIntentId,
      );
      if (clientSecret) {
        return { ok: true, orderId: existingOrder.id, clientSecret };
      }
    }
  }

  // Load listing
  const listing = await orderRepository.findListingForOrder(listingId);
  if (!listing) {
    return {
      ok: false,
      error: "Listing not available.",
      reason: "listing_unavailable",
    };
  }

  if (listing.sellerId === userId) {
    return {
      ok: false,
      error: "You cannot purchase your own listing.",
      reason: "own_listing",
    };
  }

  if (!listing.seller.stripeAccountId || !listing.seller.isStripeOnboarded) {
    return {
      ok: false,
      error:
        "This seller has not completed payment setup. Contact them directly.",
      reason: "seller_not_configured",
    };
  }

  // Reserve listing atomically
  const reservation = await orderRepository.reserveListing(listingId);
  if (reservation.count === 0) {
    return {
      ok: false,
      error: "This listing is no longer available.",
      reason: "listing_unavailable",
    };
  }

  // Calculate totals
  const isPickupOrder =
    fulfillmentType === "CASH_ON_PICKUP" ||
    fulfillmentType === "ONLINE_PAYMENT_PICKUP";
  const shippingNzd = isPickupOrder
    ? 0
    : listing.shippingOption === "PICKUP"
      ? 0
      : (listing.shippingNzd ?? 0);
  const totalNzd = listing.priceNzd + shippingNzd;

  // Create order + snapshot in transaction.
  // timeout: 10 000 ms — touches 3 tables (order, listingSnapshot, payout).
  let order: { id: string };
  try {
    order = await orderRepository.$transaction(
      async (tx) => {
        const initialStatus =
          fulfillmentType === "CASH_ON_PICKUP"
            ? "AWAITING_PICKUP"
            : "AWAITING_PAYMENT";

        const created = await orderRepository.createInTx(
          {
            buyerId: userId,
            sellerId: listing.sellerId,
            listingId: listing.id,
            itemNzd: listing.priceNzd,
            shippingNzd,
            totalNzd,
            status: initialStatus,
            fulfillmentType,
            ...(isPickupOrder ? { pickupStatus: "AWAITING_SCHEDULE" } : {}),
            ...(idempotencyKey ? { idempotencyKey } : {}),
            ...(shippingAddress
              ? {
                  shippingName: shippingAddress.name,
                  shippingLine1: shippingAddress.line1,
                  shippingLine2: shippingAddress.line2,
                  shippingCity: shippingAddress.city,
                  shippingRegion: shippingAddress.region,
                  shippingPostcode: shippingAddress.postcode,
                }
              : {}),
          } as Parameters<typeof orderRepository.createInTx>[0],
          tx,
        );

        await captureListingSnapshot(created.id, listing.id, tx);

        // CASH_ON_PICKUP — create a Payout record immediately so the escrow
        // auto-release job has something to act on once the order is completed.
        // No Stripe IDs are set because cash orders have no platform payment.
        if (fulfillmentType === "CASH_ON_PICKUP") {
          await tx.payout.upsert({
            where: { orderId: created.id },
            create: {
              orderId: created.id,
              userId: listing.sellerId,
              amountNzd: totalNzd,
              platformFeeNzd: 0,
              stripeFeeNzd: 0,
              status: "PENDING",
            },
            update: {},
          });
        }

        return created;
      },
      { timeout: 10_000, maxWait: 5_000 },
    );
  } catch (txErr) {
    await orderRepository.releaseListing(listingId).catch((err: unknown) => {
      logger.error("order.listing.release_after_tx_failure.failed", {
        error: err instanceof Error ? err.message : String(err),
        listingId,
      });
    });
    logger.error("order.create.transaction-failed", {
      listingId: listing.id,
      userId,
      error: txErr instanceof Error ? txErr.message : String(txErr),
    });
    return {
      ok: false,
      error: "Order could not be created. Please try again.",
      reason: "order_creation_failed",
    };
  }

  // CASH_ON_PICKUP — no payment, return immediately
  if (fulfillmentType === "CASH_ON_PICKUP") {
    handleCashOnPickup(order.id, userId, listing, totalNzd, ip);
    return { ok: true, orderId: order.id, clientSecret: null };
  }

  // Validate seller's Connect account
  const isRealConnectAccount =
    typeof listing.seller.stripeAccountId === "string" &&
    /^acct_[A-Za-z0-9]{16,}$/.test(listing.seller.stripeAccountId);

  if (!isRealConnectAccount) {
    // CRITICAL: status transition, listing release, and event are atomic —
    // a crash after the transaction commits but before the event write would
    // leave the order in CANCELLED state with no explanation in the timeline.
    // timeout: 10 000 ms — touches 3 tables (order, listing, orderEvent).
    await orderRepository.$transaction(
      async (tx) => {
        await transitionOrder(
          order.id,
          "CANCELLED",
          {},
          { tx, fromStatus: "AWAITING_PAYMENT" },
        );
        await orderRepository.releaseListing(listingId, tx);
        await orderEventService.recordEvent({
          orderId: order.id,
          type: ORDER_EVENT_TYPES.CANCELLED,
          actorId: null,
          actorRole: ACTOR_ROLES.SYSTEM,
          summary:
            "Order cancelled: seller payment account not properly configured",
          metadata: { trigger: "INVALID_CONNECT_ACCOUNT" },
          tx,
        });
      },
      { timeout: 10_000, maxWait: 5_000 },
    );

    // audit() is fire-and-forget — no tx parameter available at this point.
    audit({
      userId,
      action: "ORDER_STATUS_CHANGED",
      entityType: "Order",
      entityId: order.id,
      metadata: {
        trigger: "INVALID_CONNECT_ACCOUNT",
        sellerStripeAccountId: listing.seller.stripeAccountId,
      },
      ip,
    });

    return {
      ok: false,
      error:
        "Seller payment account is not properly configured. Please contact the seller.",
      reason: "seller_not_configured",
    };
  }

  // Create Stripe PaymentIntent
  try {
    const paymentResult = await paymentService.createPaymentIntent({
      amountNzd: totalNzd,
      sellerId: listing.sellerId,
      sellerStripeAccountId: listing.seller.stripeAccountId!,
      orderId: order.id,
      listingId: listing.id,
      listingTitle: listing.title,
      buyerId: userId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });

    // CRITICAL: storing the PaymentIntent ID and the ORDER_CREATED event are
    // atomic — a crash between the two would leave the order with no PI and no
    // timeline entry, requiring manual reconciliation.
    await orderRepository.$transaction(async (tx) => {
      await orderRepository.setStripePaymentIntentId(
        order.id,
        paymentResult.paymentIntentId,
        tx,
      );
      await orderEventService.recordEvent({
        orderId: order.id,
        type: ORDER_EVENT_TYPES.ORDER_CREATED,
        actorId: userId,
        actorRole: ACTOR_ROLES.BUYER,
        summary: `Order placed for "${listing.title}" — ${formatCentsAsNzd(totalNzd)}`,
        metadata: { listingId: listing.id, totalNzd },
        tx,
      });
    });

    // audit() is fire-and-forget — called after the transaction so the
    // audit entry does not block the Stripe response being returned to the buyer.
    audit({
      userId,
      action: "ORDER_CREATED",
      entityType: "Order",
      entityId: order.id,
      metadata: { listingId: listing.id, totalNzd },
      ip,
    });

    // Notifications (fire-and-forget)
    notifyOrderCreated(
      order.id,
      userId,
      userEmail,
      listing,
      totalNzd,
      fulfillmentType,
    );

    // Schedule pickup deadline for ONLINE_PAYMENT_PICKUP
    if (fulfillmentType === "ONLINE_PAYMENT_PICKUP") {
      schedulePickupDeadline(order.id);
    }

    return {
      ok: true,
      orderId: order.id,
      clientSecret: paymentResult.clientSecret,
    };
  } catch (stripeErr) {
    // Cleanup orphan PI
    try {
      const orphanOrder = await orderRepository.findStripePaymentIntentId(
        order.id,
      );
      if (orphanOrder?.stripePaymentIntentId) {
        const piId = orphanOrder.stripePaymentIntentId;
        await withStripeTimeout(
          () => stripe.paymentIntents.cancel(piId),
          "paymentIntents.cancel",
        );
        logger.info("order.orphan_pi.cancelled", {
          orderId: order.id,
          paymentIntentId: orphanOrder.stripePaymentIntentId,
        });
      }
    } catch (cancelErr) {
      logger.warn("order.orphan_pi.cancel_failed", {
        orderId: order.id,
        error:
          cancelErr instanceof Error ? cancelErr.message : String(cancelErr),
      });
    }

    await transitionOrder(
      order.id,
      "CANCELLED",
      {},
      { fromStatus: "AWAITING_PAYMENT" },
    );
    await orderRepository.releaseListing(listingId).catch((err: unknown) => {
      logger.error("order.listing.release_after_stripe_failure.failed", {
        error: err instanceof Error ? err.message : String(err),
        listingId,
        orderId: order.id,
      });
    });

    audit({
      userId,
      action: "ORDER_STATUS_CHANGED",
      entityType: "Order",
      entityId: order.id,
      metadata: {
        trigger: "STRIPE_CREATION_FAILED",
        error:
          stripeErr instanceof Error ? stripeErr.message : String(stripeErr),
      },
      ip,
    });

    // Fire-and-forget: the transitionOrder() and releaseListing() above are
    // standalone calls (no $transaction wrapper) in the Stripe-failure cleanup
    // path. Wrapping them here would require restructuring this error branch —
    // acceptable risk given this path is already an error recovery scenario.
    orderEventService.recordEvent({
      orderId: order.id,
      type: ORDER_EVENT_TYPES.CANCELLED,
      actorId: null,
      actorRole: ACTOR_ROLES.SYSTEM,
      summary: "Order cancelled: payment setup failed",
      metadata: { trigger: "STRIPE_CREATION_FAILED" },
    });

    return {
      ok: false,
      error: "Payment setup failed. Please try again.",
      reason: "stripe_unavailable",
    };
  }
}
