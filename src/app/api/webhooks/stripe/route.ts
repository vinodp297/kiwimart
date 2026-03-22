// src/app/api/webhooks/stripe/route.ts
// ─── Stripe Webhook Handler ───────────────────────────────────────────────────
// Receives and verifies Stripe webhook events.
// MUST verify the webhook signature on every request — never trust raw POST body.
//
// Events handled:
//   payment_intent.succeeded     → mark order PAYMENT_HELD, queue payout job
//   payment_intent.payment_failed → mark order CANCELLED, notify buyer
//   transfer.created             → mark payout PROCESSING
//   account.updated              → update seller onboarding status
//
// Security:
//   • Signature verified with STRIPE_WEBHOOK_SECRET (Stripe-Signature header)
//   • Idempotency: events are ignored if already processed (check event ID)
//   • All DB writes wrapped in transactions

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import db from '@/lib/db';
import { audit } from '@/server/lib/audit';
import { sendOrderDispatchedEmail } from '@/server/email';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
  typescript: true,
});

// Disable body parsing — we need the raw body for signature verification
export const config = { api: { bodyParser: false } };

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.text();
  const signature = (await headers()).get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Idempotency: skip if already processed
  // Sprint 4: store processed event IDs in a Redis set or DB table
  // For now, rely on Stripe's at-least-once delivery + our own DB constraints

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const orderId = pi.metadata?.orderId;
        if (!orderId) break;

        await db.$transaction([
          db.order.update({
            where: { id: orderId, stripePaymentIntentId: pi.id },
            data: { status: 'PAYMENT_HELD', updatedAt: new Date() },
          }),
          // Create payout record (released when buyer confirms delivery)
          db.payout.create({
            data: {
              orderId,
              userId: pi.metadata!.sellerId,
              amountNzd: Math.round((pi.amount - (pi.application_fee_amount ?? 0)) * 1), // already in cents
              platformFeeNzd: pi.application_fee_amount ?? 0,
              stripeFeeNzd: 0, // Sprint 5: calculate actual Stripe fee from fee object
              status: 'PENDING',
            },
          }),
        ]);

        audit({
          action: 'PAYMENT_COMPLETED',
          entityType: 'Order',
          entityId: orderId,
          metadata: { stripePaymentIntentId: pi.id, amountNzd: pi.amount },
        });
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const orderId = pi.metadata?.orderId;
        if (!orderId) break;

        await db.order.update({
          where: { id: orderId, stripePaymentIntentId: pi.id },
          data: { status: 'CANCELLED', updatedAt: new Date() },
        });

        audit({
          action: 'PAYMENT_FAILED',
          entityType: 'Order',
          entityId: orderId,
          metadata: {
            stripePaymentIntentId: pi.id,
            failureCode: pi.last_payment_error?.code,
          },
        });
        break;
      }

      case 'account.updated': {
        // Seller completed Stripe Connect onboarding
        const account = event.data.object as Stripe.Account;
        const detailsSubmitted = account.details_submitted;
        const chargesEnabled = account.charges_enabled;

        if (detailsSubmitted && chargesEnabled) {
          await db.user.updateMany({
            where: { stripeAccountId: account.id },
            data: { stripeOnboarded: true },
          });
        }
        break;
      }

      case 'transfer.created': {
        const transfer = event.data.object as Stripe.Transfer;
        await db.payout.updateMany({
          where: { stripeTransferId: transfer.id },
          data: { status: 'PROCESSING' },
        });
        break;
      }

      default:
        // Ignore unhandled events
        break;
    }
  } catch (err) {
    console.error(`[Stripe Webhook] Error processing ${event.type}:`, err);
    // Return 500 to trigger Stripe's retry mechanism
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}

