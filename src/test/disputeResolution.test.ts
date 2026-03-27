// src/test/disputeResolution.test.ts
// ─── Tests for dispute resolution atomicity (Stripe before DB) ───────────────
// Verifies the correct order of operations and failure handling.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { auth } from '@/lib/auth'
import db from '@/lib/db'
import { mockStripeRefund, mockStripeCapture } from './setup'

// We import resolveDispute from admin.ts
// The module-level Stripe instance is created at import time
import { resolveDispute } from '@/server/actions/admin'

// Helper to safely extract error from ActionResult
function getError(result: { success: boolean; error?: string }): string {
  return (result as { error: string }).error ?? ''
}

describe('Dispute resolution atomicity', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: authenticated admin
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'admin-1', isAdmin: true },
    } as never)

    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'admin-1',
      email: 'admin@kiwimart.test',
      displayName: 'Admin',
      isAdmin: true,
      adminRole: 'SUPER_ADMIN',
      isBanned: false,
    } as never)
  })

  it('returns error when order has no payment intent', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: 'order-no-pi',
      status: 'DISPUTED',
      stripePaymentIntentId: null,
    } as never)

    const result = await resolveDispute('order-no-pi', 'buyer')
    expect(result.success).toBe(false)
    expect(getError(result)).toContain('Payment reference missing')

    // DB should never be updated
    expect(db.order.update).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('returns error when order is not DISPUTED', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: 'order-completed',
      status: 'COMPLETED',
      stripePaymentIntentId: 'pi_123',
    } as never)

    const result = await resolveDispute('order-completed', 'buyer')
    expect(result.success).toBe(false)
    expect(getError(result)).toContain('not in dispute')
  })

  it('returns error when order not found', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(null as never)

    const result = await resolveDispute('order-missing', 'seller')
    expect(result.success).toBe(false)
    expect(getError(result)).toContain('Order not found')
  })

  it('still updates DB even if Stripe refund fails — DB-first pattern (buyer favour)', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: 'order-dispute-1',
      status: 'DISPUTED',
      stripePaymentIntentId: 'pi_refund_fail',
    } as never)
    vi.mocked(db.order.update).mockResolvedValue({} as never)

    // Stripe refund will fail — use shared mock
    mockStripeRefund.mockRejectedValueOnce(new Error('Stripe: card_declined'))

    // Should succeed — Stripe error is swallowed and logged for manual retry
    const result = await resolveDispute('order-dispute-1', 'buyer')
    expect(result.success).toBe(true)

    // DB IS updated (optimistic pattern — admin can retry Stripe manually)
    expect(db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REFUNDED' }),
      })
    )
  })

  it('does NOT update DB if Stripe capture fails (seller favour)', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: 'order-dispute-2',
      status: 'DISPUTED',
      stripePaymentIntentId: 'pi_capture_fail',
    } as never)

    // Stripe capture will fail — use shared mock
    mockStripeCapture.mockRejectedValueOnce(new Error('Stripe: charge_expired'))

    const result = await resolveDispute('order-dispute-2', 'seller')
    expect(result.success).toBe(false)
    expect(getError(result)).toContain('Payment capture failed')

    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('updates DB to REFUNDED after successful Stripe refund', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: 'order-refund-ok',
      status: 'DISPUTED',
      stripePaymentIntentId: 'pi_refund_ok',
    } as never)

    vi.mocked(db.order.update).mockResolvedValue({
      id: 'order-refund-ok',
      status: 'REFUNDED',
    } as never)

    // Stripe refund succeeds — use shared mock
    mockStripeRefund.mockResolvedValueOnce({ id: 'refund_123' })

    const result = await resolveDispute('order-refund-ok', 'buyer')
    expect(result.success).toBe(true)

    // DB WAS updated after Stripe success
    expect(db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-refund-ok' },
        data: expect.objectContaining({ status: 'REFUNDED' }),
      })
    )
  })

  it('updates DB to COMPLETED after successful Stripe capture', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: 'order-capture-ok',
      status: 'DISPUTED',
      stripePaymentIntentId: 'pi_capture_ok',
    } as never)

    vi.mocked(db.$transaction).mockResolvedValue([] as never)

    // Stripe capture succeeds — use shared mock
    mockStripeCapture.mockResolvedValueOnce({ id: 'pi_capture_ok' })

    const result = await resolveDispute('order-capture-ok', 'seller')
    expect(result.success).toBe(true)

    // DB transaction was called (order update + payout update)
    expect(db.$transaction).toHaveBeenCalled()
  })

  it('rejects non-admin callers', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'non-admin' },
    } as never)

    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'non-admin',
      email: 'user@test.com',
      displayName: 'User',
      isAdmin: false,
      adminRole: null,
      isBanned: false,
    } as never)

    const result = await resolveDispute('order-1', 'buyer')
    expect(result.success).toBe(false)
    // Should not even look up the order
    expect(db.order.findUnique).not.toHaveBeenCalled()
  })
})
