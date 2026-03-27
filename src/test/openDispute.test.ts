// src/test/openDispute.test.ts
// ─── Tests for OrderService.openDispute ─────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import './setup'
import { orderService } from '@/modules/orders/order.service'
import db from '@/lib/db'
import { AppError } from '@/shared/errors'

describe('OrderService.openDispute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockOrder = {
    id: 'order-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    status: 'DISPATCHED',
    dispatchedAt: new Date(Date.now() - 2 * 86400000), // 2 days ago
    disputeOpenedAt: null,
    listing: { title: 'Test Item' },
    seller: { email: 'seller@test.com', displayName: 'Seller' },
  }

  it('opens dispute for dispatched order', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder as never)
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 } as never)

    await orderService.openDispute(
      { orderId: 'order-1', reason: 'ITEM_NOT_RECEIVED', description: 'Never arrived' },
      'buyer-1',
      '127.0.0.1'
    )

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'order-1', status: 'DISPATCHED' }),
        data: expect.objectContaining({
          status: 'DISPUTED',
          disputeReason: 'ITEM_NOT_RECEIVED',
        }),
      })
    )
  })

  it('rejects dispute from non-buyer', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder as never)

    await expect(
      orderService.openDispute(
        { orderId: 'order-1', reason: 'ITEM_DAMAGED', description: 'Broken' },
        'wrong-buyer',
        '127.0.0.1'
      )
    ).rejects.toThrow('Only the buyer')
  })

  it('rejects dispute for non-dispatched order', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      ...mockOrder,
      status: 'PAYMENT_HELD',
    } as never)

    await expect(
      orderService.openDispute(
        { orderId: 'order-1', reason: 'ITEM_DAMAGED', description: 'Broken' },
        'buyer-1',
        '127.0.0.1'
      )
    ).rejects.toThrow('dispatched or delivered')
  })

  it('rejects dispute when already disputed', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      ...mockOrder,
      disputeOpenedAt: new Date(),
    } as never)

    await expect(
      orderService.openDispute(
        { orderId: 'order-1', reason: 'ITEM_DAMAGED', description: 'Broken' },
        'buyer-1',
        '127.0.0.1'
      )
    ).rejects.toThrow('already been opened')
  })

  it('rejects dispute after 14 days', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      ...mockOrder,
      dispatchedAt: new Date(Date.now() - 15 * 86400000), // 15 days ago
    } as never)

    await expect(
      orderService.openDispute(
        { orderId: 'order-1', reason: 'ITEM_DAMAGED', description: 'Broken' },
        'buyer-1',
        '127.0.0.1'
      )
    ).rejects.toThrow('14 days')
  })

  it('throws NOT_FOUND when order does not exist', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(null)

    await expect(
      orderService.openDispute(
        { orderId: 'nope', reason: 'ITEM_DAMAGED', description: 'Broken' },
        'buyer-1',
        '127.0.0.1'
      )
    ).rejects.toThrow(AppError)
  })
})
