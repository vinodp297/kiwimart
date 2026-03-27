// src/test/admin.service.test.ts
// ─── Tests for AdminService ─────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockStripeCapture, mockStripeRefund } from './setup'
import { adminService } from '@/modules/admin/admin.service'
import db from '@/lib/db'
import { AppError } from '@/shared/errors'

describe('AdminService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── banUser ───────────────────────────────────────────────────────────────

  describe('banUser', () => {
    it('bans user and deletes sessions via transaction', async () => {
      vi.mocked(db.$transaction).mockResolvedValue([] as never)

      await adminService.banUser('user-123', 'Violated terms', 'admin-1')

      expect(db.$transaction).toHaveBeenCalled()
    })

    it('calls $transaction with an array', async () => {
      vi.mocked(db.$transaction).mockResolvedValue([] as never)

      await adminService.banUser('user-123', 'Spam', 'admin-1')

      // $transaction is called with an array of Prisma promises
      const call = vi.mocked(db.$transaction).mock.calls[0]
      expect(call).toBeDefined()
      expect(Array.isArray(call[0])).toBe(true)
    })
  })

  // ── unbanUser ─────────────────────────────────────────────────────────────

  describe('unbanUser', () => {
    it('unbans user by clearing ban fields', async () => {
      vi.mocked(db.user.update).mockResolvedValue({} as never)

      await adminService.unbanUser('user-123', 'admin-1')

      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-123' },
          data: expect.objectContaining({
            isBanned: false,
            bannedAt: null,
            bannedReason: null,
          }),
        })
      )
    })
  })

  // ── toggleSellerEnabled ───────────────────────────────────────────────────

  describe('toggleSellerEnabled', () => {
    it('enables seller when currently disabled', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        sellerEnabled: false,
      } as never)
      vi.mocked(db.user.update).mockResolvedValue({} as never)

      await adminService.toggleSellerEnabled('user-123', 'admin-1')

      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { sellerEnabled: true },
        })
      )
    })

    it('disables seller when currently enabled', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        sellerEnabled: true,
      } as never)
      vi.mocked(db.user.update).mockResolvedValue({} as never)

      await adminService.toggleSellerEnabled('user-123', 'admin-1')

      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { sellerEnabled: false },
        })
      )
    })

    it('throws NOT_FOUND when user does not exist', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue(null)

      await expect(
        adminService.toggleSellerEnabled('ghost', 'admin-1')
      ).rejects.toThrow(AppError)
    })
  })

  // ── resolveReport ─────────────────────────────────────────────────────────

  describe('resolveReport', () => {
    const mockReport = {
      id: 'report-1',
      listingId: 'listing-1',
      targetUserId: 'user-bad',
      status: 'OPEN',
    }

    it('resolves report with dismiss action', async () => {
      vi.mocked(db.report.findUnique).mockResolvedValue(mockReport as never)
      // Transaction callback pattern — execute the callback with a mock tx
      vi.mocked(db.$transaction).mockImplementation(async (cb) => {
        if (typeof cb === 'function') return await cb(db as never)
        return [] as never
      })
      vi.mocked(db.report.update).mockResolvedValue({} as never)

      await adminService.resolveReport('report-1', 'dismiss', 'admin-1')

      expect(db.$transaction).toHaveBeenCalled()
      // Should NOT ban user on dismiss
      expect(db.session.deleteMany).not.toHaveBeenCalled()
    })

    it('removes listing when action is remove', async () => {
      vi.mocked(db.report.findUnique).mockResolvedValue(mockReport as never)
      vi.mocked(db.$transaction).mockImplementation(async (cb) => {
        if (typeof cb === 'function') return await cb(db as never)
        return [] as never
      })
      vi.mocked(db.report.update).mockResolvedValue({} as never)
      vi.mocked(db.listing.update).mockResolvedValue({} as never)

      await adminService.resolveReport('report-1', 'remove', 'admin-1')

      expect(db.$transaction).toHaveBeenCalled()
    })

    it('bans target user when action is ban', async () => {
      vi.mocked(db.report.findUnique).mockResolvedValue(mockReport as never)
      vi.mocked(db.$transaction).mockImplementation(async (cb) => {
        if (typeof cb === 'function') return await cb(db as never)
        return [] as never
      })
      vi.mocked(db.report.update).mockResolvedValue({} as never)
      vi.mocked(db.user.update).mockResolvedValue({} as never)
      vi.mocked(db.session.deleteMany).mockResolvedValue({} as never)

      await adminService.resolveReport('report-1', 'ban', 'admin-1')

      expect(db.$transaction).toHaveBeenCalled()
      // Session deletion happens OUTSIDE the transaction
      expect(db.session.deleteMany).toHaveBeenCalled()
    })

    it('throws NOT_FOUND when report does not exist', async () => {
      vi.mocked(db.report.findUnique).mockResolvedValue(null)

      await expect(
        adminService.resolveReport('report-nope', 'dismiss', 'admin-1')
      ).rejects.toThrow(AppError)
    })
  })

  // ── resolveDispute ────────────────────────────────────────────────────────

  describe('resolveDispute', () => {
    const mockOrder = {
      id: 'order-123',
      status: 'DISPUTED',
      stripePaymentIntentId: 'pi_test_123',
    }

    it('refunds buyer when favour=buyer — DB first then Stripe', async () => {
      const callOrder: string[] = []
      vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder as never)
      vi.mocked(db.order.update).mockImplementation((() => {
        callOrder.push('db')
        return Promise.resolve({}) as never
      }) as never)
      mockStripeRefund.mockImplementation(async () => {
        callOrder.push('stripe')
        return { id: 're_mock' }
      })

      await adminService.resolveDispute('order-123', 'buyer', 'admin-1')

      expect(callOrder[0]).toBe('db')
      expect(callOrder[1]).toBe('stripe')
    })

    it('captures for seller when favour=seller — Stripe before DB', async () => {
      const callOrder: string[] = []
      vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder as never)
      mockStripeCapture.mockImplementation(async () => {
        callOrder.push('stripe')
        return { id: 'pi_mock', status: 'succeeded' }
      })
      vi.mocked(db.$transaction).mockImplementation(async () => {
        callOrder.push('db')
        return [] as never
      })

      await adminService.resolveDispute('order-123', 'seller', 'admin-1')

      expect(callOrder[0]).toBe('stripe')
      expect(callOrder[1]).toBe('db')
    })

    it('still updates DB even if Stripe refund fails (DB-first pattern)', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder as never)
      vi.mocked(db.order.update).mockResolvedValue({} as never)
      mockStripeRefund.mockRejectedValueOnce(new Error('Refund declined'))

      // Should NOT throw — Stripe error is swallowed and logged for manual retry
      await adminService.resolveDispute('order-123', 'buyer', 'admin-1')

      // DB IS updated (optimistic pattern)
      expect(db.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REFUNDED' }),
        })
      )
    })

    it('does NOT update DB if capture fails', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder as never)
      mockStripeCapture.mockRejectedValueOnce(new Error('Capture failed'))

      await expect(
        adminService.resolveDispute('order-123', 'seller', 'admin-1')
      ).rejects.toThrow()

      expect(db.$transaction).not.toHaveBeenCalled()
    })

    it('throws when no payment intent', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        ...mockOrder,
        stripePaymentIntentId: null,
      } as never)

      await expect(
        adminService.resolveDispute('order-123', 'buyer', 'admin-1')
      ).rejects.toThrow('Payment reference missing')
    })

    it('throws when order is not DISPUTED', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        ...mockOrder,
        status: 'COMPLETED',
      } as never)

      await expect(
        adminService.resolveDispute('order-123', 'buyer', 'admin-1')
      ).rejects.toThrow('not in dispute')
    })

    it('throws when order not found', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(null)

      await expect(
        adminService.resolveDispute('order-nope', 'buyer', 'admin-1')
      ).rejects.toThrow(AppError)
    })
  })
})
