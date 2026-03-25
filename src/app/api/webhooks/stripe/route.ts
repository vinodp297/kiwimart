// src/app/api/webhooks/stripe/route.ts
// ─── Stripe Webhook Handler ───────────────────────────────────────────────────
// Thin route handler — all business logic delegated to WebhookService.
// Only responsibilities: verify signature, delegate to service, return status.

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripe } from '@/infrastructure/stripe/client';
import { webhookService } from '@/modules/payments/webhook.service';
import { logger } from '@/shared/logger';

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.text();
  const signature = (await headers()).get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    logger.error('stripe.webhook.signature_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    await webhookService.processEvent(event);
  } catch (err) {
    logger.error('stripe.webhook.failed', {
      eventId: event.id,
      type: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
