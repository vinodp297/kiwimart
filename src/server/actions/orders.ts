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
//   • Only authenticated buyers can create orders
//   • Buyers cannot order their own listings
//   • Price is read from DB at order creation — never trusted from client
//   • Stripe PaymentIntent captures on confirmation (not immediately)

import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { audit } from '@/server/lib/audit';
import type { ActionResult } from '@/types';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
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
  const ip = reqHeaders.get('x-forwarded-for') ?? 'unknown';

  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Sign in to purchase items.' };
  }

  // 5a. Load listing — prices ALWAYS read from DB
  const listing = await db.listing.findUnique({
    where: { id: params.listingId, status: 'ACTIVE', deletedAt: null },
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
  if (listing.sellerId === session.user.id) {
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
      buyerId: session.user.id,
      sellerId: listing.sellerId,
      listingId: listing.id,
      itemNzd: listing.priceNzd,
      shippingNzd,
      totalNzd,
      status: 'AWAITING_PAYMENT',
      ...(params.shippingAddress
        ? {
            shippingName: params.shippingAddress.name,
            shippingLine1: params.shippingAddress.line1,
            shippingLine2: params.shippingAddress.line2,
            shippingCity: params.shippingAddress.city,
            shippingRegion: params.shippingAddress.region,
            shippingPostcode: params.shippingAddress.postcode,
          }
        : {}),
    },
    select: { id: true },
  });

  // 5d. Create Stripe PaymentIntent with Connect transfer
  // Platform fee = 0% during beta (KiwiMart's $0 fee promise)
  const paymentIntent = await stripe.paymentIntents.create({
    amount: totalNzd, // NZD cents
    currency: 'nzd',
    // Transfer to seller's Connect account after capture
    transfer_data: { destination: listing.seller.stripeAccountId },
    // Afterpay (BNPL) — enabled for eligible NZ orders
    payment_method_types: ['card', 'afterpay_clearpay'],
    metadata: {
      orderId: order.id,
      listingId: listing.id,
      buyerId: session.user.id,
      sellerId: listing.sellerId,
    },
    description: `KiwiMart: ${listing.title}`,
    statement_descriptor: 'KIWIMART NZ',
    // Capture manually after buyer confirms receipt (escrow model)
    capture_method: 'manual',
  });

  // 5e. Store PaymentIntent ID on order
  await db.order.update({
    where: { id: order.id },
    data: { stripePaymentIntentId: paymentIntent.id },
  });

  // 6. Audit
  audit({
    userId: session.user.id,
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
}

// ── confirmDelivery — releases escrow ────────────────────────────────────────

export async function confirmDelivery(
  orderId: string
): Promise<ActionResult<void>> {
  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  // 5a. Load order
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      status: true,
      stripePaymentIntentId: true,
      totalNzd: true,
      listing: { select: { title: true } },
    },
  });

  if (!order) return { success: false, error: 'Order not found.' };

  // 2. Authorise — only the buyer can confirm delivery
  if (order.buyerId !== session.user.id) {
    return { success: false, error: 'Only the buyer can confirm delivery.' };
  }
  if (order.status !== 'DISPATCHED' && order.status !== 'DELIVERED') {
    return { success: false, error: 'Order is not in a deliverable state.' };
  }

  // 5b. Capture the PaymentIntent (releases escrow → seller gets paid)
  if (order.stripePaymentIntentId) {
    await stripe.paymentIntents.capture(order.stripePaymentIntentId);
  }

  // 5c. Mark order as completed and update payout
  await db.$transaction([
    db.order.update({
      where: { id: orderId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    }),
    db.payout.updateMany({
      where: { orderId },
      data: { status: 'PROCESSING', initiatedAt: new Date() },
    }),
    // Mark listing as sold
    db.listing.update({
      where: { id: order.id },
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
          orderId,
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
    userId: session.user.id,
    action: 'ORDER_STATUS_CHANGED',
    entityType: 'Order',
    entityId: orderId,
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
  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  const order = await db.order.findUnique({
    where: { id: params.orderId },
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
  if (order.sellerId !== session.user.id) {
    return { success: false, error: 'Only the seller can mark an order as dispatched.' };
  }
  if (order.status !== 'PAYMENT_HELD') {
    return { success: false, error: 'Order must be in PAYMENT_HELD status to dispatch.' };
  }

  // 5. Update order
  await db.order.update({
    where: { id: params.orderId },
    data: {
      status: 'DISPATCHED',
      dispatchedAt: new Date(),
      trackingNumber: params.trackingNumber ?? null,
      trackingUrl: params.trackingUrl ?? null,
    },
  });

  // Notify buyer via email queue
  try {
    const { emailQueue } = await import('@/lib/queue');
    await emailQueue.add('orderDispatched', {
      type: 'orderDispatched' as const,
      payload: {
        to: order.buyer.email, buyerName: order.buyer.displayName,
        listingTitle: order.listing.title, trackingNumber: params.trackingNumber,
        trackingUrl: params.trackingUrl,
        orderUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/buyer`,
      },
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
  } catch {
    const { sendOrderDispatchedEmail } = await import('@/server/email');
    sendOrderDispatchedEmail({
      to: order.buyer.email, buyerName: order.buyer.displayName,
      listingTitle: order.listing.title, trackingNumber: params.trackingNumber,
      trackingUrl: params.trackingUrl, orderUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/buyer`,
    }).catch(() => {});
  }

  // 6. Audit
  audit({
    userId: session.user.id,
    action: 'ORDER_STATUS_CHANGED',
    entityType: 'Order',
    entityId: params.orderId,
    metadata: { newStatus: 'DISPATCHED', trackingNumber: params.trackingNumber },
  });

  return { success: true, data: undefined };
}

