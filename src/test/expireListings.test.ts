// src/test/expireListings.test.ts
// ─── Tests for listing expiry and offer reservation release jobs ──────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { expireListings, releaseExpiredOfferReservations } from '@/server/jobs/expireListings'
import db from '@/lib/db'

describe('expireListings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('expires active listings past expiresAt', async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 3 } as never)

    const result = await expireListings()

    expect(result.expired).toBe(3)
    expect(result.errors).toBe(0)
    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: expect.any(Date) },
        deletedAt: null,
      },
      data: { status: 'EXPIRED' },
    })
  })

  it('returns 0 when no listings to expire', async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 0 } as never)

    const result = await expireListings()

    expect(result.expired).toBe(0)
    expect(result.errors).toBe(0)
  })

  it('handles database errors gracefully', async () => {
    vi.mocked(db.listing.updateMany).mockRejectedValue(new Error('Database connection lost'))

    const result = await expireListings()

    expect(result.errors).toBe(1)
    expect(result.expired).toBe(0)
  })
})

describe('releaseExpiredOfferReservations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 0 when no expired accepted offers', async () => {
    vi.mocked(db.offer.findMany).mockResolvedValue([] as never)

    const result = await releaseExpiredOfferReservations()

    expect(result.released).toBe(0)
    expect(result.errors).toBe(0)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('releases listing and expires offer when buyer has not paid', async () => {
    vi.mocked(db.offer.findMany).mockResolvedValue([
      { id: 'offer-1', listingId: 'listing-1' },
    ] as never)
    // No paid orders for this listing
    vi.mocked(db.order.findMany).mockResolvedValue([] as never)
    vi.mocked(db.$transaction).mockResolvedValue([{}, {}] as never)

    const result = await releaseExpiredOfferReservations()

    expect(result.released).toBe(1)
    expect(result.errors).toBe(0)
    expect(db.$transaction).toHaveBeenCalledTimes(1)
  })

  it('skips offers where buyer has already paid', async () => {
    vi.mocked(db.offer.findMany).mockResolvedValue([
      { id: 'offer-1', listingId: 'listing-paid' },
    ] as never)
    // A paid order exists for this listing
    vi.mocked(db.order.findMany).mockResolvedValue([
      { listingId: 'listing-paid' },
    ] as never)

    const result = await releaseExpiredOfferReservations()

    expect(result.released).toBe(0)
    // Transaction must NOT be called — buyer already paid
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('counts errors when transaction fails', async () => {
    vi.mocked(db.offer.findMany).mockResolvedValue([
      { id: 'offer-1', listingId: 'listing-1' },
    ] as never)
    vi.mocked(db.order.findMany).mockResolvedValue([] as never)
    vi.mocked(db.$transaction).mockRejectedValue(new Error('DB error'))

    const result = await releaseExpiredOfferReservations()

    expect(result.errors).toBe(1)
    expect(result.released).toBe(0)
  })
})
