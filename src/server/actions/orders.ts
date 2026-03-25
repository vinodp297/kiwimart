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
import Stripe from 'stripe';
import { z } from 'zod';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
});

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
      seller: { select: { stripeAccountId: true, stripeOnboarded: true } },
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

    // Re-make listing available (it may have been reserved)
    await db.listing.update({
      where: { id: parsed.data.listingId },
      data: { status: 'ACTIVE' },
    }).catch(() => {}); // listing may already be ACTIVE

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
  // 1. Authenticate + ban check
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Authentication required.' };
  }

  // 3. Validate
  const parsed = ConfirmDeliverySchema.safeParse({ orderId });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  // 5a. Load order
  const order = await db.order.findUnique({
    where: { id: parsed.data.orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      listingId: true,
      status: true,
      stripePaymentIntentId: true,
      totalNzd: true,
      listing: { select: { title: true } },
    },
  });

  if (!order) return { success: false, error: 'Order not found.' };

  // 2. Authorise — only the buyer can confirm delivery
  if (order.buyerId !== user.id) {
    return { success: false, error: 'Only the buyer can confirm delivery.' };
  }
  if (order.status !== 'DISPATCHED' && order.status !== 'DELIVERED') {
    return { success: false, error: 'Order is not in a deliverable state.' };
  }

  // 5b. Hard-fail guard — never complete an order with no payment reference
  if (!order.stripePaymentIntentId) {
    return {
      success: false,
      error: 'Cannot confirm delivery — payment reference missing. Please contact support@kiwimart.co.nz',
    };
  }

  // Capture the PaymentIntent (releases escrow → seller gets paid)
  try {
    await stripe.paymentIntents.capture(order.stripePaymentIntentId);
  } catch (stripeErr: unknown) {
    const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr);
    if (!msg.includes('already_captured') && !msg.includes('amount_capturable')) {
      return { success: false, error: 'Payment capture failed. Please try again.' };
    }
    // Already captured — safe to continue
  }

  // 5c. Mark order as completed and update payout (ONLY after Stripe success)
  await db.$transaction([
    db.order.update({
      where: { id: parsed.data.orderId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    }),
    db.payout.updateMany({
      where: { orderId: parsed.data.orderId },
      data: { status: 'PROCESSING', initiatedAt: new Date() },
    }),
    // Mark listing as sold
    db.listing.update({
      where: { id: order.listingId },
      data: { status: 'SOLD', soldAt: new Date() },
    }),
  ]);

  // 5d. Queue payout processing (3 business days delay)
  try {
    const seller = await db.user.findUnique({
      where: { id: order.sellerId },
      select: { stripeAccountId: true },
    });
    if (seller?.stripeAccountId) {
      const { payoutQueue } = await import('@/lib/queue');
      await payoutQueue.add(
        'process-payout',
        {
          orderId: parsed.data.orderId,
          sellerId: order.sellerId,
          amountNzd: order.totalNzd,
          stripeAccountId: seller.stripeAccountId,
        },
        {
          delay: 3 * 24 * 60 * 60 * 1000, // 3 days
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        }
      );
    }
  } catch {
    console.warn('[Orders] Failed to queue payout — will need manual processing');
  }

  // 6. Audit
  audit({
    userId: user.id,
    action: 'ORDER_STATUS_CHANGED',
    entityType: 'Order',
    entityId: parsed.data.orderId,
    metadata: { newStatus: 'COMPLETED', previousStatus: order.status },
  });

  return { success: true, data: undefined };
}

// ── markDispatched — seller marks order dispatched ───────────────────────────

export async function markDispatched(params: {
  orderId: string;
  trackingNumber?: string;
  trackingUrl?: string;
}): Promise<ActionResult<void>> {
  // 1. Authenticate + ban check
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Authentication required.' };
  }

  // 3. Validate
  const parsed = MarkDispatchedSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const order = await db.order.findUnique({
    where: { id: parsed.data.orderId },
    select: {
      id: true,
      sellerId: true,
      status: true,
      buyerId: true,
      listing: { select: { title: true } },
      buyer: { select: { email: true, displayName: true } },
    },
  });

  if (!order) return { success: false, error: 'Order not found.' };

  // 2. Authorise
  if (order.sellerId !== user.id) {
    return { success: false, error: 'Only the seller can mark an order as dispatched.' };
  }
  if (order.status !== 'PAYMENT_HELD') {
    return { success: false, error: 'Order must be in PAYMENT_HELD status to dispatch.' };
  }

  // 5. Update order
  await db.order.update({
    where: { id: parsed.data.orderId },
    data: {
      status: 'DISPATCHED',
      dispatchedAt: new Date(),
      trackingNumber: parsed.data.trackingNumber ?? null,
      trackingUrl: parsed.data.trackingUrl ?? null,
    },
  });

  // Notify buyer via email queue
  try {
    const { emailQueue } = await import('@/lib/queue');
    await emailQueue.add('orderDispatched', {
      type: 'orderDispatched' as const,
      payload: {
        to: order.buyer.email, buyerName: order.buyer.displayName,
        listingTitle: order.listing.title, trackingNumber: parsed.data.trackingNumber,
        trackingUrl: parsed.data.trackingUrl,
        orderUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/buyer`,
      },
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
  } catch {
    const { sendOrderDispatchedEmail } = await import('@/server/email');
    sendOrderDispatchedEmail({
      to: order.buyer.email, buyerName: order.buyer.displayName,
      listingTitle: order.listing.title, trackingNumber: parsed.data.trackingNumber,
      trackingUrl: parsed.data.trackingUrl, orderUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/buyer`,
    }).catch(() => {});
  }

  // 6. Audit
  audit({
    userId: user.id,
    action: 'ORDER_STATUS_CHANGED',
    entityType: 'Order',
    entityId: parsed.data.orderId,
    metadata: { newStatus: 'DISPATCHED', trackingNumber: parsed.data.trackingNumber },
  });

  return { success: true, data: undefined };
}
