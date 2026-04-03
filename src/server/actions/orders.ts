"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/orders.ts
// ─── Order Server Actions ─────────────────────────────────────────────────────
// Escrow payment flow:
//   1. createOrder    → creates Order row + Stripe PaymentIntent
//   2. Stripe webhook → marks order PAYMENT_HELD when payment succeeds
//   3. Seller marks dispatched → order moves to DISPATCHED
//   4. confirmDelivery → releases escrow, triggers payout to seller
//
// Security:
//   • requireUser() — fresh DB check on every call, rejects banned users
//   • Buyers cannot order their own listings
//   • Price is read from DB at order creation — never trusted from client
//   • Stripe PaymentIntent captures on confirmation (not immediately)
//   • Zod validation on all inputs
//   • Orphan order cleanup on Stripe failure (FIX 7)

import { headers } from "next/headers";
import db from "@/lib/db";
import { userRepository } from "@/modules/users/user.repository";
import { audit } from "@/server/lib/audit";
import { requireUser } from "@/server/lib/requireUser";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import type { ActionResult } from "@/types";
import { paymentService } from "@/modules/payments/payment.service";
import { stripe } from "@/infrastructure/stripe/client";
import { logger } from "@/shared/logger";
import { orderService } from "@/modules/orders/order.service";
import { createNotification } from "@/modules/notifications/notification.service";
import { sendOrderConfirmationEmail } from "@/server/email";
import { transitionOrder } from "@/modules/orders/order.transitions";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import {
  createOrderSchema as CreateOrderSchema,
  confirmDeliverySchema as ConfirmDeliverySchema,
  markDispatchedSchema as MarkDispatchedSchema,
  cancelOrderSchema as CancelOrderSchema,
} from "@/server/validators";

import { captureListingSnapshot } from "@/server/services/listing-snapshot.service";
import { pickupQueue } from "@/lib/queue";
import { getListValues } from "@/lib/dynamic-lists";

// ── createOrder ───────────────────────────────────────────────────────────────

export async function createOrder(params: {
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
}): Promise<ActionResult<{ orderId: string; clientSecret: string | null }>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders as unknown as Headers);

  // 1. Authenticate + ban check
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Authentication required."),
      reason: "auth_required",
    };
  }

  // 2. Rate limit — 5 orders per hour per user
  const limit = await rateLimit("order", user.id);
  if (!limit.success) {
    return {
      success: false,
      error: "Too many orders placed. Please wait before trying again.",
      reason: "rate_limited",
    };
  }

  // 2b. Email verification check
  // Note: requireUser() already hits the DB but doesn't return emailVerified.
  // A future optimisation would be to include it in the requireUser() select.
  const buyer = await userRepository.findEmailVerified(user.id);
  if (!buyer?.emailVerified) {
    return {
      success: false,
      error: "Please verify your email address before placing an order.",
      reason: "email_not_verified",
    };
  }

  // 3. Validate input
  const parsed = CreateOrderSchema.safeParse(params);
  if (!parsed.success) {
    return {
      success: false,
      error:
        parsed.error.issues[0]?.message ??
        "Please check your input and try again.",
      reason: "validation_error",
    };
  }

  // 4. Idempotency check — return existing order if same key already created one.
  // Prevents duplicate orders from double-clicks or retried form submissions.
  // SECURITY: Lookup MUST include buyerId to prevent another user from
  // retrieving a victim's orderId + clientSecret by knowing their key.
  const idempotencyKey = parsed.data.idempotencyKey;
  if (idempotencyKey) {
    const existingOrder = await db.order.findFirst({
      where: { idempotencyKey, buyerId: user.id },
      select: {
        id: true,
        status: true,
        stripePaymentIntentId: true,
        listingId: true,
      },
    });
    if (
      existingOrder &&
      existingOrder.status === "AWAITING_PAYMENT" &&
      existingOrder.stripePaymentIntentId &&
      existingOrder.listingId === parsed.data.listingId
    ) {
      const clientSecret = await paymentService.getClientSecret(
        existingOrder.stripePaymentIntentId,
      );
      if (clientSecret) {
        return {
          success: true,
          data: { orderId: existingOrder.id, clientSecret },
        };
      }
    }
  }

  // 5a. Load listing — prices ALWAYS read from DB
  const listing = await db.listing.findUnique({
    where: { id: parsed.data.listingId, status: "ACTIVE", deletedAt: null },
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

  if (!listing)
    return {
      success: false,
      error: "Listing not available.",
      reason: "listing_unavailable",
    };

  // 2. Authorise — cannot buy own listing
  if (listing.sellerId === user.id) {
    return {
      success: false,
      error: "You cannot purchase your own listing.",
      reason: "own_listing",
    };
  }

  if (!listing.seller.stripeAccountId || !listing.seller.stripeOnboarded) {
    return {
      success: false,
      error:
        "This seller has not completed payment setup. Contact them directly.",
      reason: "seller_not_configured",
    };
  }

  // 5b-pre. Atomically reserve the listing — prevents double-buy race condition.
  // Two buyers both seeing status=ACTIVE will race here; only one updateMany wins
  // (count === 1). The loser gets count === 0 and bails out before touching the DB.
  const reservation = await db.listing.updateMany({
    where: { id: parsed.data.listingId, status: "ACTIVE" },
    data: { status: "RESERVED" },
  });
  if (reservation.count === 0) {
    return {
      success: false,
      error: "This listing is no longer available.",
      reason: "listing_unavailable",
    };
  }

  // 5b. Calculate totals (server-side — never trust client prices)
  const fulfillmentType = parsed.data.fulfillmentType ?? "SHIPPED";
  const isPickupOrder =
    fulfillmentType === "CASH_ON_PICKUP" ||
    fulfillmentType === "ONLINE_PAYMENT_PICKUP";
  const shippingNzd = isPickupOrder
    ? 0
    : listing.shippingOption === "PICKUP"
      ? 0
      : (listing.shippingNzd ?? 0);
  const totalNzd = listing.priceNzd + shippingNzd;

  // 5c. Create order row + freeze listing snapshot — both atomic inside one
  //     transaction. If captureListingSnapshot throws (listing missing, DB error),
  //     the entire transaction rolls back and no order is persisted.
  let order: { id: string };
  try {
    order = await db.$transaction(async (tx) => {
      // CASH_ON_PICKUP skips payment — starts directly as AWAITING_PICKUP
      // ONLINE_PAYMENT_PICKUP starts as AWAITING_PAYMENT (webhook transitions to AWAITING_PICKUP)
      // SHIPPED follows the normal flow
      const initialStatus =
        fulfillmentType === "CASH_ON_PICKUP"
          ? "AWAITING_PICKUP"
          : "AWAITING_PAYMENT";

      const created = await tx.order.create({
        data: {
          buyerId: user.id,
          sellerId: listing.sellerId,
          listingId: listing.id,
          itemNzd: listing.priceNzd,
          shippingNzd,
          totalNzd,
          status: initialStatus,
          fulfillmentType,
          ...(isPickupOrder ? { pickupStatus: "AWAITING_SCHEDULE" } : {}),
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(parsed.data.shippingAddress
            ? {
                shippingName: parsed.data.shippingAddress.name,
                shippingLine1: parsed.data.shippingAddress.line1,
                shippingLine2: parsed.data.shippingAddress.line2,
                shippingCity: parsed.data.shippingAddress.city,
                shippingRegion: parsed.data.shippingAddress.region,
                shippingPostcode: parsed.data.shippingAddress.postcode,
              }
            : {}),
        },
        select: { id: true },
      });

      // Capture listing state at purchase time — immutable evidence for disputes
      await captureListingSnapshot(created.id, listing.id, tx);

      return created;
    });
  } catch (txErr) {
    // Snapshot or order creation failed — release the reservation so other
    // buyers can still purchase this listing.
    await db.listing
      .updateMany({
        where: { id: parsed.data.listingId, status: "RESERVED" },
        data: { status: "ACTIVE" },
      })
      .catch(() => {});

    logger.error("order.create.transaction-failed", {
      listingId: listing.id,
      userId: user.id,
      error: txErr instanceof Error ? txErr.message : String(txErr),
    });

    return {
      success: false,
      error: "Order could not be created. Please try again.",
      reason: "order_creation_failed" as const,
    };
  }

  // ── CASH_ON_PICKUP — no payment, return immediately ───────────────────────
  if (fulfillmentType === "CASH_ON_PICKUP") {
    audit({
      userId: user.id,
      action: "ORDER_CREATED",
      entityType: "Order",
      entityId: order.id,
      metadata: { listingId: listing.id, totalNzd, fulfillmentType },
      ip,
    });

    orderEventService.recordEvent({
      orderId: order.id,
      type: ORDER_EVENT_TYPES.ORDER_CREATED,
      actorId: user.id,
      actorRole: ACTOR_ROLES.BUYER,
      summary: `Cash-on-pickup order placed for "${listing.title}" — $${(totalNzd / 100).toFixed(2)} NZD`,
      metadata: { listingId: listing.id, totalNzd, fulfillmentType },
    });

    // Notify both parties (fire-and-forget)
    createNotification({
      userId: user.id,
      type: "ORDER_PLACED",
      title: "Order placed",
      body: `Order placed. Now arrange a pickup time with the seller.`,
      orderId: order.id,
      link: `/orders/${order.id}`,
    }).catch(() => {});

    createNotification({
      userId: listing.sellerId,
      type: "ORDER_PLACED",
      title: "New pickup order received!",
      body: `New cash-on-pickup order for "${listing.title}". Arrange a pickup time with the buyer.`,
      orderId: order.id,
      link: `/orders/${order.id}`,
    }).catch(() => {});

    // Schedule pickup deadline job (48 hours)
    const deadlineJobId = `pickup-deadline-${order.id}`;
    pickupQueue
      .add(
        "PICKUP_JOB",
        { type: "PICKUP_SCHEDULE_DEADLINE" as const, orderId: order.id },
        { delay: 48 * 60 * 60 * 1000, jobId: deadlineJobId },
      )
      .then(() => {
        db.order
          .update({
            where: { id: order.id },
            data: { scheduleDeadlineJobId: deadlineJobId },
          })
          .catch(() => {});
      })
      .catch(() => {});

    return {
      success: true,
      data: { orderId: order.id, clientSecret: null },
    };
  }

  // 5d. Create Stripe PaymentIntent — FIX 7: clean up order on failure
  // FIX A: Hard-fail if seller's Connect account is invalid.
  // Never silently omit transfer_data — that would send money to the platform
  // instead of the seller.
  const isRealConnectAccount =
    typeof listing.seller.stripeAccountId === "string" &&
    /^acct_[A-Za-z0-9]{16,}$/.test(listing.seller.stripeAccountId);

  if (!isRealConnectAccount) {
    // BUG-1 FIX: Atomically cancel orphan order AND restore listing to ACTIVE.
    // Previously the listing was left RESERVED permanently on this early return.
    await db.$transaction(async (tx) => {
      await transitionOrder(
        order.id,
        "CANCELLED",
        {},
        { tx, fromStatus: "AWAITING_PAYMENT" },
      );
      // Restore listing so other buyers can purchase it
      await tx.listing.updateMany({
        where: { id: parsed.data.listingId, status: "RESERVED" },
        data: { status: "ACTIVE" },
      });
    });

    audit({
      userId: user.id,
      action: "ORDER_STATUS_CHANGED",
      entityType: "Order",
      entityId: order.id,
      metadata: {
        trigger: "INVALID_CONNECT_ACCOUNT",
        sellerStripeAccountId: listing.seller.stripeAccountId,
      },
      ip,
    });

    orderEventService.recordEvent({
      orderId: order.id,
      type: ORDER_EVENT_TYPES.CANCELLED,
      actorId: null,
      actorRole: ACTOR_ROLES.SYSTEM,
      summary:
        "Order cancelled: seller payment account not properly configured",
      metadata: { trigger: "INVALID_CONNECT_ACCOUNT" },
    });

    return {
      success: false,
      error:
        "Seller payment account is not properly configured. Please contact the seller.",
      reason: "seller_not_configured",
    };
  }

  // QUALITY-1 FIX: Route through PaymentService instead of calling Stripe inline.
  // Previously this file had its own stripe.paymentIntents.create() call that
  // duplicated logic from payment.service.ts. One place to update if Stripe
  // config ever changes (API version, metadata, statement descriptor, etc.).
  try {
    const paymentResult = await paymentService.createPaymentIntent({
      amountNzd: totalNzd,
      sellerId: listing.sellerId,
      sellerStripeAccountId: listing.seller.stripeAccountId!,
      orderId: order.id,
      listingId: listing.id,
      listingTitle: listing.title,
      buyerId: user.id,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });

    // SUCCESS: persist the PaymentIntent ID so the webhook can match it back
    await db.order.update({
      where: { id: order.id },
      data: { stripePaymentIntentId: paymentResult.paymentIntentId },
    });

    // 6. Audit
    audit({
      userId: user.id,
      action: "ORDER_CREATED",
      entityType: "Order",
      entityId: order.id,
      metadata: { listingId: listing.id, totalNzd },
      ip,
    });

    orderEventService.recordEvent({
      orderId: order.id,
      type: ORDER_EVENT_TYPES.ORDER_CREATED,
      actorId: user.id,
      actorRole: ACTOR_ROLES.BUYER,
      summary: `Order placed for "${listing.title}" — $${(totalNzd / 100).toFixed(2)} NZD`,
      metadata: { listingId: listing.id, totalNzd },
    });

    // Notify seller of new order + send buyer confirmation (fire-and-forget)
    db.user
      .findUnique({ where: { id: user.id }, select: { displayName: true } })
      .then((buyer) => {
        const buyerName =
          buyer?.displayName ?? user.email.split("@")[0] ?? "Buyer";

        if (fulfillmentType === "ONLINE_PAYMENT_PICKUP") {
          // Pickup-specific notifications
          createNotification({
            userId: user.id,
            type: "ORDER_PLACED",
            title: "Order placed",
            body: `Order placed. Now arrange a pickup time with the seller.`,
            orderId: order.id,
            link: `/orders/${order.id}`,
          }).catch(() => {});
          createNotification({
            userId: listing.sellerId,
            type: "ORDER_PLACED",
            title: "New pickup order received!",
            body: `${buyerName} placed a pickup order for "${listing.title}". Agree a pickup time within 24 hours.`,
            orderId: order.id,
            link: `/orders/${order.id}`,
          }).catch(() => {});
        } else {
          // Standard shipping notification
          createNotification({
            userId: listing.sellerId,
            type: "ORDER_PLACED",
            title: "New order received! 🎉",
            body: `${buyerName} purchased "${listing.title}" for $${(totalNzd / 100).toFixed(2)} NZD`,
            listingId: listing.id,
            orderId: order.id,
            link: "/dashboard/seller?tab=orders",
          }).catch(() => {});
        }

        sendOrderConfirmationEmail({
          to: user.email,
          buyerName,
          sellerName: listing.seller.displayName ?? "the seller",
          listingTitle: listing.title,
          totalNzd,
          orderId: order.id,
          listingId: listing.id,
        }).catch(() => {});
      })
      .catch(() => {});

    // Schedule pickup deadline for ONLINE_PAYMENT_PICKUP orders
    if (fulfillmentType === "ONLINE_PAYMENT_PICKUP") {
      const deadlineJobId = `pickup-deadline-${order.id}`;
      pickupQueue
        .add(
          "PICKUP_JOB",
          { type: "PICKUP_SCHEDULE_DEADLINE" as const, orderId: order.id },
          { delay: 48 * 60 * 60 * 1000, jobId: deadlineJobId },
        )
        .then(() => {
          db.order
            .update({
              where: { id: order.id },
              data: { scheduleDeadlineJobId: deadlineJobId },
            })
            .catch(() => {});
        })
        .catch(() => {});
    }

    return {
      success: true,
      data: { orderId: order.id, clientSecret: paymentResult.clientSecret },
    };
  } catch (stripeErr) {
    // Cancel any orphaned Stripe PI that was created before the failure.
    // If createPaymentIntent() succeeded but db.order.update() failed,
    // the PI exists in Stripe but the order doesn't reference it.
    // Look up the order to check if a PI was persisted.
    try {
      const orphanOrder = await db.order.findUnique({
        where: { id: order.id },
        select: { stripePaymentIntentId: true },
      });
      if (orphanOrder?.stripePaymentIntentId) {
        await stripe.paymentIntents.cancel(orphanOrder.stripePaymentIntentId);
        logger.info("order.orphan_pi.cancelled", {
          orderId: order.id,
          paymentIntentId: orphanOrder.stripePaymentIntentId,
        });
      }
    } catch (cancelErr) {
      // PI may not exist yet, or may be in a non-cancellable state — that's fine
      logger.warn("order.orphan_pi.cancel_failed", {
        orderId: order.id,
        error:
          cancelErr instanceof Error ? cancelErr.message : String(cancelErr),
      });
    }

    // Cancel the orphan order and restore the listing so other buyers can purchase.
    await transitionOrder(
      order.id,
      "CANCELLED",
      {},
      { fromStatus: "AWAITING_PAYMENT" },
    );

    // Release reservation — only if still RESERVED (guard against races)
    await db.listing
      .updateMany({
        where: { id: parsed.data.listingId, status: "RESERVED" },
        data: { status: "ACTIVE" },
      })
      .catch(() => {});

    audit({
      userId: user.id,
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

    orderEventService.recordEvent({
      orderId: order.id,
      type: ORDER_EVENT_TYPES.CANCELLED,
      actorId: null,
      actorRole: ACTOR_ROLES.SYSTEM,
      summary: "Order cancelled: payment setup failed",
      metadata: { trigger: "STRIPE_CREATION_FAILED" },
    });

    return {
      success: false,
      error: "Payment setup failed. Please try again.",
      reason: "stripe_unavailable",
    };
  }
}

// ── confirmDelivery — releases escrow ────────────────────────────────────────

export async function confirmDelivery(
  orderId: string,
  feedback?: {
    itemAsDescribed: boolean;
    issueType?: string;
    deliveryPhotos?: string[];
    notes?: string;
  },
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = ConfirmDeliverySchema.safeParse({
      orderId,
      itemAsDescribed: feedback?.itemAsDescribed ?? true,
      issueType: feedback?.issueType,
      deliveryPhotos: feedback?.deliveryPhotos,
      notes: feedback?.notes,
    });
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    // Always confirm delivery (buyer received the item)
    await orderService.confirmDelivery(parsed.data.orderId, user.id, {
      itemAsDescribed: parsed.data.itemAsDescribed,
      issueType: parsed.data.issueType,
      deliveryPhotos: parsed.data.deliveryPhotos,
      notes: parsed.data.notes,
    });
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't confirm delivery. Please try again.",
      ),
    };
  }
}

// ── cancelOrder — buyer/seller cancels order within time window ──────────────

export async function cancelOrder(params: {
  orderId: string;
  reason?: string;
}): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = CancelOrderSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }
    await orderService.cancelOrder(
      parsed.data.orderId,
      user.id,
      parsed.data.reason,
    );
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't cancel this order. Please try again or contact support.",
      ),
    };
  }
}

// ── markDispatched — seller marks order dispatched ───────────────────────────

export async function markDispatched(params: {
  orderId: string;
  trackingNumber: string;
  courier: string;
  trackingUrl?: string;
  estimatedDeliveryDate: string;
  dispatchPhotos: string[];
}): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = MarkDispatchedSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    // Validate courier against the dynamic COURIERS list
    const validCouriers = await getListValues("COURIERS");
    if (!validCouriers.includes(parsed.data.courier)) {
      return { success: false, error: "Invalid courier selection." };
    }

    await orderService.markDispatched(parsed.data, user.id);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't update the dispatch status. Please try again.",
      ),
    };
  }
}

// ── Upload order evidence photos (dispatch/delivery) ────────────────────────
// Reuses the dispute evidence pattern: server-side upload to R2 with magic byte
// validation. Returns R2 keys (not public URLs) for storage in event metadata.

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2, R2_BUCKET } from "@/infrastructure/storage/r2";
import { validateImageFile } from "@/server/lib/fileValidation";

const EVIDENCE_MAX_SIZE = 5 * 1024 * 1024; // 5MB
const EVIDENCE_MAX_FILES = parseInt(
  process.env.DISPUTE_EVIDENCE_MAX_FILES ?? "4",
  10,
);

export async function uploadOrderEvidence(
  formData: FormData,
  context: "dispatch" | "delivery",
): Promise<ActionResult<{ keys: string[] }>> {
  try {
    const user = await requireUser();

    const limit = await rateLimit("order", user.id);
    if (!limit.success) {
      return {
        success: false,
        error: "Too many uploads. Please try again later.",
      };
    }

    const files = formData.getAll("files") as File[];
    if (files.length === 0) {
      return { success: false, error: "No files provided." };
    }
    if (files.length > EVIDENCE_MAX_FILES) {
      return {
        success: false,
        error: `Maximum ${EVIDENCE_MAX_FILES} photos allowed.`,
      };
    }

    const uploadedKeys: string[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());

      const validation = validateImageFile({
        buffer,
        mimetype: file.type,
        size: file.size,
        originalname: file.name,
      });
      if (!validation.valid) {
        return { success: false, error: validation.error ?? "Invalid file." };
      }

      if (file.size > EVIDENCE_MAX_SIZE) {
        return { success: false, error: "Each photo must be under 5MB." };
      }

      const ext =
        file.type === "image/jpeg"
          ? "jpg"
          : file.type === "image/png"
            ? "png"
            : "webp";
      const key = `${context}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: file.type,
        }),
      );

      uploadedKeys.push(key);
    }

    logger.info(`order.${context}_evidence.uploaded`, {
      userId: user.id,
      count: uploadedKeys.length,
    });

    return { success: true, data: { keys: uploadedKeys } };
  } catch (err) {
    logger.error(`order.${context}_evidence.upload.failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: "Failed to upload photos. Please try again.",
    };
  }
}
