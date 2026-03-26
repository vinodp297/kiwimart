'use server';
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

import { headers } from 'next/headers';
import db from '@/lib/db';
import { audit } from '@/server/lib/audit';
import { requireUser } from '@/server/lib/requireUser';
import { rateLimit, getClientIp } from '@/server/lib/rateLimit';
import type { ActionResult } from '@/types';
import { stripe } from '@/infrastructure/stripe/client';
import { paymentService } from '@/modules/payments/payment.service';
import { orderService } from '@/modules/orders/order.service';
import { createNotification } from '@/modules/notifications/notification.service';
import { sendOrderConfirmationEmail } from '@/server/email';
import { z } from 'zod';

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const CreateOrderSchema = z.object({
  listingId: z.string().min(1, 'Listing ID is required'),
  shippingAddress: z.object({
    name: z.string().min(2, 'Name is required').max(100),
    line1: z.string().min(5, 'Street address is required').max(200),
    line2: z.string().max(200).optional(),
    city: z.string().min(2, 'City is required').max(100),
    region: z.string().min(2, 'Region is required').max(100),
    postcode: z.string().regex(/^\d{4}$/, 'Invalid NZ postcode'),
  }).optional(),
});

const ConfirmDeliverySchema = z.object({
  orderId: z.string().min(1, 'Order ID is required'),
});

const MarkDispatchedSchema = z.object({
  orderId: z.string().min(1, 'Order ID is required'),
  trackingNumber: z.string().max(100).optional(),
  trackingUrl: z.string().max(500).optional(),
});

// ── createOrder ───────────────────────────────────────────────────────────────

export async function createOrder(params: {
  listingId: string;
  shippingAddress?: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postcode: string;
  };
}): Promise<ActionResult<{ orderId: string; clientSecret: string }>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders as unknown as Headers);

  // 1. Authenticate + ban check
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Authentication required.' };
  }

  // 2. Rate limit — 5 orders per hour per user
  const limit = await rateLimit('order', user.id);
  if (!limit.success) {
    return { success: false, error: 'Too many orders placed. Please wait before trying again.' };
  }

  // 3. Validate input
  const parsed = CreateOrderSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  // 5a. Load listing — prices ALWAYS read from DB
  const listing = await db.listing.findUnique({
    where: { id: parsed.data.listingId, status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      title: true,
      priceNzd: true,
      shippingNzd: true,
      shippingOption: true,
      sellerId: true,
      seller: { select: { stripeAccountId: true, stripeOnboarded: true, displayName: true, email: true } },
    },
  });

  if (!listing) return { success: false, error: 'Listing not available.' };

  // 2. Authorise — cannot buy own listing
  if (listing.sellerId === user.id) {
    return { success: false, error: 'You cannot purchase your own listing.' };
  }

  if (!listing.seller.stripeAccountId || !listing.seller.stripeOnboarded) {
    return {
      success: false,
      error: 'This seller has not completed payment setup. Contact them directly.',
    };
  }

  // 5b-pre. Atomically reserve the listing — prevents double-buy race condition.
  // Two buyers both seeing status=ACTIVE will race here; only one updateMany wins
  // (count === 1). The loser gets count === 0 and bails out before touching the DB.
  const reservation = await db.listing.updateMany({
    where: { id: parsed.data.listingId, status: 'ACTIVE' },
    data: { status: 'RESERVED' },
  });
  if (reservation.count === 0) {
    return { success: false, error: 'This listing is no longer available.' };
  }

  // 5b. Calculate totals (server-side — never trust client prices)
  const shippingNzd =
    listing.shippingOption === 'PICKUP' ? 0 : (listing.shippingNzd ?? 0);
  const totalNzd = listing.priceNzd + shippingNzd;

  // 5c. Create order row (status: AWAITING_PAYMENT until Stripe confirms)
  const order = await db.order.create({
    data: {
      buyerId: user.id,
      sellerId: listing.sellerId,
      listingId: listing.id,
      itemNzd: listing.priceNzd,
      shippingNzd,
      totalNzd,
      status: 'AWAITING_PAYMENT',
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

  // 5d. Create Stripe PaymentIntent — FIX 7: clean up order on failure
  // FIX A: Hard-fail if seller's Connect account is invalid.
  // Never silently omit transfer_data — that would send money to the platform
  // instead of the seller.
  const isRealConnectAccount =
    typeof listing.seller.stripeAccountId === 'string' &&
    /^acct_[A-Za-z0-9]{16,}$/.test(listing.seller.stripeAccountId);

  if (!isRealConnectAccount) {
    // Cancel orphan order — seller account is not valid
    await db.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED' },
    });

    audit({
      userId: user.id,
      action: 'ORDER_STATUS_CHANGED',
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        trigger: 'INVALID_CONNECT_ACCOUNT',
        sellerStripeAccountId: listing.seller.stripeAccountId,
      },
      ip,
    });

    return {
      success: false,
      error: 'Seller payment account is not properly configured. Please contact support.',
    };
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalNzd,
      currency: 'nzd',
      transfer_data: { destination: listing.seller.stripeAccountId! },
      payment_method_types: ['card', 'afterpay_clearpay'],
      metadata: {
        orderId: order.id,
        listingId: listing.id,
        buyerId: user.id,
        sellerId: listing.sellerId,
      },
      description: `KiwiMart: ${listing.title}`,
      statement_descriptor_suffix: 'KIWIMART',
      capture_method: 'manual',
    });

    // SUCCESS: update order with payment intent ID
    await db.order.update({
      where: { id: order.id },
      data: { stripePaymentIntentId: paymentIntent.id },
    });

    // 6. Audit
    audit({
      userId: user.id,
      action: 'ORDER_CREATED',
      entityType: 'Order',
      entityId: order.id,
      metadata: { listingId: listing.id, totalNzd },
      ip,
    });

    // Notify seller of new order + send buyer confirmation (fire-and-forget)
    db.user.findUnique({ where: { id: user.id }, select: { displayName: true } })
      .then((buyer) => {
        const buyerName = buyer?.displayName ?? user.email.split('@')[0];
        createNotification({
          userId:    listing.sellerId,
          type:      'ORDER_PLACED',
          title:     'New order received! 🎉',
          body:      `${buyerName} purchased "${listing.title}" for $${(totalNzd / 100).toFixed(2)} NZD`,
          listingId: listing.id,
          orderId:   order.id,
          link:      '/dashboard/seller?tab=orders',
        }).catch(() => {});
        sendOrderConfirmationEmail({
          to:           user.email,
          buyerName,
          sellerName:   listing.seller.displayName ?? 'the seller',
          listingTitle: listing.title,
          totalNzd,
          orderId:      order.id,
          listingId:    listing.id,
        }).catch(() => {});
      })
      .catch(() => {});

    return {
      success: true,
      data: { orderId: order.id, clientSecret: paymentIntent.client_secret! },
    };
  } catch (stripeErr) {
    // FIX 7: Stripe failed — cancel the orphan order immediately
    await db.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED' },
    });

    // Release reservation — only if still RESERVED (guard against races)
    await db.listing.updateMany({
      where: { id: parsed.data.listingId, status: 'RESERVED' },
      data: { status: 'ACTIVE' },
    }).catch(() => {});

    audit({
      userId: user.id,
      action: 'ORDER_STATUS_CHANGED',
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        trigger: 'STRIPE_CREATION_FAILED',
        error: stripeErr instanceof Error ? stripeErr.message : String(stripeErr),
      },
      ip,
    });

    return {
      success: false,
      error: 'Payment setup failed. Please try again.',
    };
  }
}

// ── confirmDelivery — releases escrow ────────────────────────────────────────

export async function confirmDelivery(
  orderId: string
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = ConfirmDeliverySchema.safeParse({ orderId });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }
    await orderService.confirmDelivery(parsed.data.orderId, user.id);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}

// ── markDispatched — seller marks order dispatched ───────────────────────────

export async function markDispatched(params: {
  orderId: string;
  trackingNumber?: string;
  trackingUrl?: string;
}): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = MarkDispatchedSchema.safeParse(params);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }
    await orderService.markDispatched(parsed.data, user.id);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}
