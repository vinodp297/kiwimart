// src/test/confirmDelivery.test.ts
// Unit tests for the confirmDelivery server action — focuses on the
// null payment-intent guard (FIX 1) and happy-path escrow release.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import '../test/setup'

// Pull in mocks exposed by setup.ts
import { mockStripeCapture } from '../test/setup'

// Mock requireUser — must be done before importing the action
vi.mock('@/server/lib/requireUser', () => ({
  requireUser: vi.fn().mockResolvedValue({ id: 'user_buyer', email: 'buyer@test.com' }),
}))

// Lazy-import the action AFTER mocks are in place
const { confirmDelivery } = await import('@/server/actions/orders')

// Grab the mocked Prisma db
const { default: db } = await import('@/lib/db')

// ── helpers ───────────────────────────────────────────────────────────────────

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order_1',
    buyerId: 'user_buyer',
    sellerId: 'user_seller',
    listingId: 'listing_1',
    status: 'DISPATCHED',
    stripePaymentIntentId: 'pi_test_123',
    totalNzd: 5000,
    listing: { title: 'Test Listing' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: $transaction resolves successfully
  vi.mocked(db.$transaction).mockResolvedValue([])
  // Default: user lookup for queue (returns no stripe account)
  vi.mocked(db.user.findUnique).mockResolvedValue(null as never)
})

// ── FIX 1: null payment intent guard ─────────────────────────────────────────

describe('confirmDelivery — null payment intent guard', () => {
  it('returns error when stripePaymentIntentId is null', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder({ stripePaymentIntentId: null }) as never)

    const result = await confirmDelivery('order_1')

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/payment reference missing/i)
    // Must NOT call Stripe
    expect(mockStripeCapture).not.toHaveBeenCalled()
    // Must NOT write to DB
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('returns error when stripePaymentIntentId is undefined', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder({ stripePaymentIntentId: undefined }) as never)

    const result = await confirmDelivery('order_1')

    expect(result.success).toBe(false)
    expect(mockStripeCapture).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('confirmDelivery — happy path', () => {
  it('captures Stripe PI and completes the order', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder() as never)

    const result = await confirmDelivery('order_1')

    expect(result.success).toBe(true)
    expect(mockStripeCapture).toHaveBeenCalledWith('pi_test_123')
    expect(db.$transaction).toHaveBeenCalled()
  })

  it('succeeds even if Stripe says already captured', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder() as never)
    mockStripeCapture.mockRejectedValueOnce(
      Object.assign(new Error('PaymentIntent already_captured'), {
        code: 'charge_already_captured',
        type: 'invalid_request_error',
      })
    )

    const result = await confirmDelivery('order_1')

    expect(result.success).toBe(true)
    expect(db.$transaction).toHaveBeenCalled()
  })
})

// ── Auth / validation guards ──────────────────────────────────────────────────

describe('confirmDelivery — auth & validation', () => {
  it('returns error if order not found', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(null as never)

    const result = await confirmDelivery('order_missing')

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/not found/i)
  })

  it('returns error if caller is not the buyer', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder({ buyerId: 'user_other' }) as never)

    const result = await confirmDelivery('order_1')

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/buyer/i)
  })

  it('returns error if order is not in deliverable state', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder({ status: 'AWAITING_PAYMENT' }) as never)

    const result = await confirmDelivery('order_1')

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/deliverable state/i)
  })
})
