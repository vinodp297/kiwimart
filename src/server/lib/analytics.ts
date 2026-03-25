// src/server/lib/analytics.ts
// ─── Server-Side Analytics (PostHog) ─────────────────────────────────────────
// Server-side PostHog client for tracking events that shouldn't go through
// the browser (order completions, payouts, admin actions, etc.)
//
// Privacy:
//   • Only userId is sent as distinctId — no PII (email, name, phone)
//   • Events are batched and flushed asynchronously
//   • Disabled in development unless POSTHOG_KEY is set

import { PostHog } from 'posthog-node';

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

// Only use PostHog when a real project key is present — placeholder values
// ('phc_placeholder', etc.) cause 401/404 errors on every analytics call.
const isConfigured =
  typeof POSTHOG_KEY === 'string' &&
  POSTHOG_KEY.startsWith('phc_') &&
  !POSTHOG_KEY.toLowerCase().includes('placeholder');

let posthogClient: PostHog | null = null;

function getPostHog(): PostHog | null {
  if (!isConfigured) {
    return null;
  }

  if (!posthogClient) {
    posthogClient = new PostHog(POSTHOG_KEY!, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      // Batch events — flush every 30 seconds or 20 events
      flushAt: 20,
      flushInterval: 30000,
    });
  }

  return posthogClient;
}

/**
 * Track a server-side event in PostHog.
 * Fire-and-forget — never blocks the main action.
 *
 * @param userId - The user ID (only identifier sent — no PII)
 * @param event - Event name (e.g., 'order_completed', 'listing_created')
 * @param properties - Event properties (no PII allowed)
 *
 * @example
 * trackEvent(userId, 'order_completed', { orderId, totalNzd });
 */
export function trackEvent(
  userId: string,
  event: string,
  properties?: Record<string, unknown>
): void {
  try {
    const ph = getPostHog();
    if (!ph) return;

    ph.capture({
      distinctId: userId,
      event,
      properties: {
        ...properties,
        source: 'server',
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    // Analytics failures are non-fatal — log and continue
    // Analytics failures are non-fatal — swallowed silently
  }
}

/**
 * Identify a user in PostHog (set user properties).
 * Only call with non-PII properties (region, seller status, etc.)
 *
 * @example
 * identifyUser(userId, { region: 'Auckland', sellerEnabled: true });
 */
export function identifyUser(
  userId: string,
  properties: Record<string, unknown>
): void {
  try {
    const ph = getPostHog();
    if (!ph) return;

    ph.identify({
      distinctId: userId,
      properties,
    });
  } catch {
    // Analytics identify failed — non-fatal
  }
}

/**
 * Flush pending events. Call during graceful shutdown.
 */
export async function flushAnalytics(): Promise<void> {
  try {
    const ph = getPostHog();
    if (ph) await ph.flush();
  } catch {
    // Non-fatal
  }
}
