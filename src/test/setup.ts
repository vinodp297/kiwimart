// src/test/setup.ts
// ─── Global test setup for Vitest ────────────────────────────────────────────
// Mocks all external dependencies so unit tests run without DB, Stripe, etc.

import { vi } from 'vitest'

// ── Mock Stripe ──────────────────────────────────────────────────────────────
// Use shared mock functions so ALL instances (including module-level ones in
// the source files) reference the same mocks. This lets tests control them.
const mockStripeCapture = vi.fn().mockResolvedValue({ id: 'pi_mock', status: 'succeeded' })
const mockStripeCreate = vi.fn().mockResolvedValue({ id: 'pi_mock', client_secret: 'cs_mock' })
const mockStripeRefund = vi.fn().mockResolvedValue({ id: 're_mock' })

vi.mock('stripe', () => {
  class MockStripe {
    paymentIntents = {
      create: mockStripeCreate,
      capture: mockStripeCapture,
    }
    refunds = {
      create: mockStripeRefund,
    }
    webhooks = {
      constructEvent: vi.fn(),
    }
  }
  return { default: MockStripe }
})

// Export for test access (tests can import from this file)
export { mockStripeCapture, mockStripeCreate, mockStripeRefund }

// ── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock('@/lib/db', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    session: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    listing: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    stripeEvent: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    payout: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    report: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

// ── Mock Auth.js ─────────────────────────────────────────────────────────────
vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

// ── Mock audit ───────────────────────────────────────────────────────────────
vi.mock('@/server/lib/audit', () => ({
  audit: vi.fn(),
}))

// ── Mock next/headers ────────────────────────────────────────────────────────
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue('127.0.0.1'),
  }),
}))

// ── Mock next/cache ──────────────────────────────────────────────────────────
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

// ── Mock queue ───────────────────────────────────────────────────────────────
vi.mock('@/lib/queue', () => ({
  payoutQueue: { add: vi.fn() },
  emailQueue: { add: vi.fn() },
}))
