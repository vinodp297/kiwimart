// src/test/offer.service.test.ts
// ─── Tests for OfferService ─────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import './setup'
import { offerService } from '@/modules/offers/offer.service'
import db from '@/lib/db'
import { AppError } from '@/shared/errors'

describe('OfferService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockListing = {
    id: 'listing-1',
    sellerId: 'seller-1',
    title: 'iPhone 15',
    priceNzd: 100000, // $1000.00 in cents
    offersEnabled: true,
    seller: { email: 'seller@test.com', displayName: 'Seller' },
  }

  // ── createOffer ───────────────────────────────────────────────────────────

  describe('createOffer', () => {
    it('creates valid offer at 80% of price', async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never)
      vi.mocked(db.offer.findFirst).mockResolvedValue(null)
      vi.mocked(db.offer.create).mockResolvedValue({ id: 'offer-1' } as never)
      vi.mocked(db.user.findUnique).mockResolvedValue({ displayName: 'Buyer' } as never)

      const result = await offerService.createOffer(
        { listingId: 'listing-1', amount: 800 },
        'buyer-1',
        '127.0.0.1'
      )

      expect(result.offerId).toBe('offer-1')
      expect(db.offer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountNzd: 80000,
            buyerId: 'buyer-1',
            sellerId: 'seller-1',
          }),
        })
      )
    })

    it('rejects offer on own listing', async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never)

      await expect(
        offerService.createOffer(
          { listingId: 'listing-1', amount: 800 },
          'seller-1', // same as listing.sellerId
          '127.0.0.1'
        )
      ).rejects.toThrow('own listing')
    })

    it('rejects offer below 50% floor', async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never)

      await expect(
        offerService.createOffer(
          { listingId: 'listing-1', amount: 400 }, // 40% of $1000
          'buyer-1',
          '127.0.0.1'
        )
      ).rejects.toThrow('50%')
    })

    it('rejects offer equal to or above asking price', async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never)

      await expect(
        offerService.createOffer(
          { listingId: 'listing-1', amount: 1000 }, // 100% = asking price
          'buyer-1',
          '127.0.0.1'
        )
      ).rejects.toThrow('Buy Now')
    })

    it('rejects offer when listings not found', async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(null)

      await expect(
        offerService.createOffer(
          { listingId: 'listing-nope', amount: 800 },
          'buyer-1',
          '127.0.0.1'
        )
      ).rejects.toThrow(AppError)
    })

    it('rejects offer when offers disabled on listing', async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue({
        ...mockListing,
        offersEnabled: false,
      } as never)

      await expect(
        offerService.createOffer(
          { listingId: 'listing-1', amount: 800 },
          'buyer-1',
          '127.0.0.1'
        )
      ).rejects.toThrow('not accepting offers')
    })

    it('rejects duplicate pending offer', async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never)
      vi.mocked(db.offer.findFirst).mockResolvedValue({ id: 'existing' } as never)

      await expect(
        offerService.createOffer(
          { listingId: 'listing-1', amount: 800 },
          'buyer-1',
          '127.0.0.1'
        )
      ).rejects.toThrow('already have a pending offer')
    })
  })

  // ── respondOffer ──────────────────────────────────────────────────────────

  describe('respondOffer', () => {
    const mockOffer = {
      id: 'offer-1',
      sellerId: 'seller-1',
      status: 'PENDING',
      listingId: 'listing-1',
      amountNzd: 80000,
      expiresAt: new Date(Date.now() + 86400000), // tomorrow
      buyer: { email: 'buyer@test.com', displayName: 'Buyer' },
      listing: { id: 'listing-1', title: 'iPhone 15' },
    }

    it('accepts offer and reserves listing', async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(mockOffer as never)
      vi.mocked(db.offer.update).mockResolvedValue({} as never)
      vi.mocked(db.listing.update).mockResolvedValue({} as never)
      vi.mocked(db.offer.updateMany).mockResolvedValue({ count: 0 } as never)

      await offerService.respondOffer(
        { offerId: 'offer-1', action: 'ACCEPT' },
        'seller-1',
        '127.0.0.1'
      )

      expect(db.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ACCEPTED' }),
        })
      )
      expect(db.listing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'RESERVED' },
        })
      )
    })

    it('declines offer without changing listing', async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(mockOffer as never)
      vi.mocked(db.offer.update).mockResolvedValue({} as never)

      await offerService.respondOffer(
        { offerId: 'offer-1', action: 'DECLINE' },
        'seller-1',
        '127.0.0.1'
      )

      expect(db.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DECLINED' }),
        })
      )
      expect(db.listing.update).not.toHaveBeenCalled()
    })

    it('rejects if seller does not own offer', async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(mockOffer as never)

      await expect(
        offerService.respondOffer(
          { offerId: 'offer-1', action: 'ACCEPT' },
          'wrong-seller',
          '127.0.0.1'
        )
      ).rejects.toThrow('permission')
    })

    it('rejects if offer already responded', async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue({
        ...mockOffer,
        status: 'ACCEPTED',
      } as never)

      await expect(
        offerService.respondOffer(
          { offerId: 'offer-1', action: 'DECLINE' },
          'seller-1',
          '127.0.0.1'
        )
      ).rejects.toThrow('already been responded')
    })

    it('rejects if offer has expired', async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue({
        ...mockOffer,
        expiresAt: new Date(Date.now() - 86400000), // yesterday
      } as never)

      await expect(
        offerService.respondOffer(
          { offerId: 'offer-1', action: 'ACCEPT' },
          'seller-1',
          '127.0.0.1'
        )
      ).rejects.toThrow('expired')
    })

    it('throws NOT_FOUND when offer does not exist', async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(null)

      await expect(
        offerService.respondOffer(
          { offerId: 'nope', action: 'ACCEPT' },
          'seller-1',
          '127.0.0.1'
        )
      ).rejects.toThrow(AppError)
    })

    it('declines all other pending offers when accepting', async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(mockOffer as never)
      vi.mocked(db.offer.update).mockResolvedValue({} as never)
      vi.mocked(db.listing.update).mockResolvedValue({} as never)
      vi.mocked(db.offer.updateMany).mockResolvedValue({ count: 3 } as never)

      await offerService.respondOffer(
        { offerId: 'offer-1', action: 'ACCEPT' },
        'seller-1',
        '127.0.0.1'
      )

      expect(db.offer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            listingId: 'listing-1',
            id: { not: 'offer-1' },
            status: 'PENDING',
          }),
          data: expect.objectContaining({ status: 'DECLINED' }),
        })
      )
    })
  })
})
