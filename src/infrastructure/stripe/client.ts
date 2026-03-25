// src/infrastructure/stripe/client.ts
// ─── Stripe Singleton Client ──────────────────────────────────────────────────
// Single Stripe instance for the entire codebase.
// Import { stripe } from here instead of creating new Stripe() locally.

import Stripe from 'stripe'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover' as any,
  typescript: true,
  appInfo: {
    name: 'KiwiMart',
    version: '1.0.0',
  },
})

export type { Stripe }
