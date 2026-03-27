// src/infrastructure/stripe/client.ts
// ─── Stripe Singleton Client ──────────────────────────────────────────────────
// Single Stripe instance for the entire codebase.
// Import { stripe } from here instead of creating new Stripe() locally.

import Stripe from 'stripe'

// Stripe API version: cast required because the beta clover version string is
// not in the SDK's union type. This is the correct version for Stripe 2026.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover' as Stripe.LatestApiVersion,
  typescript: true,
  appInfo: {
    name: 'KiwiMart',
    version: '1.0.0',
  },
})

export type { Stripe }
