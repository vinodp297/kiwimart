// src/app/api/webhooks/stripe/route.ts
// ─── Stripe Webhook Handler ───────────────────────────────────────────────────
// Thin route handler — all business logic delegated to WebhookService.
// Only responsibilities: verify signature, check idempotency, delegate to
// service, mark as processed, return status.

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { stripe } from "@/infrastructure/stripe/client";
import { webhookService } from "@/modules/payments/webhook.service";
import { logger } from "@/shared/logger";
import { getRedisClient } from "@/infrastructure/redis/client";
import { getRequestContext } from "@/lib/request-context";
import { env } from "@/env";

// Stripe retries for up to 72 hours — keep keys for the full window.
const WEBHOOK_IDEMPOTENCY_TTL = 259_200; // seconds (72 hours)

function webhookRedisKey(eventId: string): string {
  return `stripe:webhook:processed:${eventId}`;
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.text();
  const signature = (await headers()).get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // ── 1. Verify signature (always first) ──────────────────────────────────────
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    logger.error("stripe.webhook.signature_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // ── 2. Redis idempotency check (after signature, before business logic) ──────
  // Fail OPEN: if Redis is unavailable we process the event anyway — missing a
  // payment notification is worse than an occasional duplicate notification.
  try {
    const redis = getRedisClient();
    const alreadyProcessed = await redis.get(webhookRedisKey(event.id));
    if (alreadyProcessed) {
      logger.info("stripe.webhook.duplicate", {
        eventId: event.id,
        type: event.type,
      });
      // Return 200 — non-200 causes Stripe to retry, defeating the purpose.
      return NextResponse.json({ received: true });
    }
  } catch (err) {
    logger.warn("stripe.webhook.idempotency_check_failed", {
      eventId: event.id,
      type: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
    // Fail open — fall through and process anyway.
  }

  // ── 3. Business logic ────────────────────────────────────────────────────────
  try {
    await webhookService.processEvent(event);
  } catch (err) {
    logger.error("stripe.webhook.failed", {
      eventId: event.id,
      type: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
    // Do NOT mark as processed — let Stripe retry.
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }

  // ── 4. Mark as processed AFTER successful handling only ──────────────────────
  try {
    const redis = getRedisClient();
    await redis.set(
      webhookRedisKey(event.id),
      JSON.stringify({
        processedAt: new Date().toISOString(),
        eventType: event.type,
        correlationId: getRequestContext()?.correlationId ?? "webhook",
      }),
      { ex: WEBHOOK_IDEMPOTENCY_TTL },
    );
  } catch (err) {
    logger.error("stripe.webhook.idempotency_mark_failed", {
      eventId: event.id,
      type: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
    // Event was already processed — still return 200.
  }

  return NextResponse.json({ received: true });
}
