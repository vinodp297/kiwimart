// src/test/order.service.test.ts
// ─── Tests for OrderService ──────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockStripeCapture } from './setup'
import { orderService } from '@/modules/orders/order.service'
import db from '@/lib/db'

describe('OrderService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('confirmDelivery', () => {
    it('succeeds for valid dispatched order', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: 'order-1',
        buyerId: 'buyer-1',
        sellerId: 'seller-1',
        listingId: 'listing-1',
        status: 'DISPATCHED',
        stripePaymentIntentId: 'pi_test',
        totalNzd: 5000,
      } as never)

      mockStripeCapture.mockResolvedValueOnce({ id: 'pi_test', status: 'succeeded' })
      vi.mocked(db.$transaction).mockResolvedValue([] as never)
      vi.mocked(db.user.findUnique).mockResolvedValue({
        stripeAccountId: 'acct_test123456789',
      } as never)

      await expect(
        orderService.confirmDelivery('order-1', 'buyer-1')
      ).resolves.toBeUndefined()

      expect(mockStripeCapture).toHaveBeenCalledWith('pi_test')
      expect(db.$transaction).toHaveBeenCalled()
    })

    it('throws for null payment intent', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: 'order-no-pi',
        buyerId: 'buyer-1',
        sellerId: 'seller-1',
        listingId: 'listing-1',
        status: 'DISPATCHED',
        stripePaymentIntentId: null,
        totalNzd: 5000,
      } as never)

      await expect(
        orderService.confirmDelivery('order-no-pi', 'buyer-1')
      ).rejects.toThrow('Payment reference missing')
    })

    it('throws for wrong buyer', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: 'order-1',
        buyerId: 'buyer-1',
        sellerId: 'seller-1',
        listingId: 'listing-1',
        status: 'DISPATCHED',
        stripePaymentIntentId: 'pi_test',
        totalNzd: 5000,
      } as never)

      await expect(
        orderService.confirmDelivery('order-1', 'wrong-buyer')
      ).rejects.toThrow('Only the buyer can confirm delivery')
    })

    it('throws for wrong order status', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: 'order-1',
        buyerId: 'buyer-1',
        sellerId: 'seller-1',
        listingId: 'listing-1',
        status: 'PAYMENT_HELD',
        stripePaymentIntentId: 'pi_test',
        totalNzd: 5000,
      } as never)

      await expect(
        orderService.confirmDelivery('order-1', 'buyer-1')
      ).rejects.toThrow('not in a deliverable state')
    })

    it('throws for non-existent order', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(null as never)

      await expect(
        orderService.confirmDelivery('order-missing', 'buyer-1')
      ).rejects.toThrow('Order not found')
    })

    it('does not update DB if Stripe capture fails', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: 'order-1',
        buyerId: 'buyer-1',
        sellerId: 'seller-1',
        listingId: 'listing-1',
        status: 'DISPATCHED',
        stripePaymentIntentId: 'pi_fail',
        totalNzd: 5000,
      } as never)

      mockStripeCapture.mockRejectedValueOnce(new Error('charge_expired'))

      await expect(
        orderService.confirmDelivery('order-1', 'buyer-1')
      ).rejects.toThrow()

      expect(db.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('markDispatched', () => {
    it('succeeds for valid order', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: 'order-1',
        sellerId: 'seller-1',
        status: 'PAYMENT_HELD',
        buyerId: 'buyer-1',
        listing: { title: 'Test Item' },
        buyer: { email: 'buyer@test.com', displayName: 'Buyer' },
      } as never)

      vi.mocked(db.order.update).mockResolvedValue({} as never)

      await expect(
        orderService.markDispatched(
          { orderId: 'order-1', trackingNumber: '123ABC' },
          'seller-1'
        )
      ).resolves.toBeUndefined()

      expect(db.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: expect.objectContaining({ status: 'DISPATCHED' }),
        })
      )
    })

    it('throws for wrong seller', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: 'order-1',
        sellerId: 'seller-1',
        status: 'PAYMENT_HELD',
        buyerId: 'buyer-1',
        listing: { title: 'Test' },
        buyer: { email: 'b@t.com', displayName: 'B' },
      } as never)

      await expect(
        orderService.markDispatched({ orderId: 'order-1' }, 'wrong-seller')
      ).rejects.toThrow('Only the seller')
    })

    it('throws for wrong status', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: 'order-1',
        sellerId: 'seller-1',
        status: 'DISPATCHED',
        buyerId: 'buyer-1',
        listing: { title: 'Test' },
        buyer: { email: 'b@t.com', displayName: 'B' },
      } as never)

      await expect(
        orderService.markDispatched({ orderId: 'order-1' }, 'seller-1')
      ).rejects.toThrow('PAYMENT_HELD')
    })
  })
})
