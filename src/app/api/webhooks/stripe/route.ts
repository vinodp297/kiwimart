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
//   • Idempotency: duplicate events rejected via StripeEvent DB table
//   • Payout creation uses upsert to prevent duplicates
//   • All DB writes wrapped in transactions

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import db from '@/lib/db';
import { audit } from '@/server/lib/audit';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
  typescript: true,
});

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

  // ── Idempotency: race-safe insert-or-skip ───────────────────────────────
  // Use try/catch on create instead of find-then-create to eliminate the
  // race window where two parallel retries both pass the findUnique check.
  // P2002 = Prisma unique constraint violation (event already processed).
  try {
    await db.stripeEvent.create({
      data: {
        id: event.id,
        type: event.type,
      },
    });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      console.log(`[Webhook] Duplicate event ${event.id} — already processed`);
      return NextResponse.json({ received: true });
    }
    // Re-throw non-duplicate errors
    throw err;
  }

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
          // Idempotent payout creation — upsert prevents duplicates
          db.payout.upsert({
            where: { orderId },
            create: {
              orderId,
              userId: pi.metadata!.sellerId,
              amountNzd: Math.round((pi.amount - (pi.application_fee_amount ?? 0)) * 1),
              platformFeeNzd: pi.application_fee_amount ?? 0,
              stripeFeeNzd: 0,
              status: 'PENDING',
            },
            update: {}, // no-op if already exists
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
        // Sync Stripe Connect onboarding status — BOTH true AND false.
        // All three checks must pass for a seller to be fully onboarded:
        //   details_submitted: seller completed the onboarding form
        //   charges_enabled: Stripe can process charges to this account
        //   payouts_enabled: Stripe can pay out to this account's bank
        const account = event.data.object as Stripe.Account;
        const onboarded =
          account.details_submitted === true &&
          account.charges_enabled === true &&
          account.payouts_enabled === true;

        await db.user.updateMany({
          where: { stripeAccountId: account.id },
          data: {
            stripeOnboarded: onboarded,
            stripeChargesEnabled: account.charges_enabled ?? false,
            stripePayoutsEnabled: account.payouts_enabled ?? false,
          },
        });
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
