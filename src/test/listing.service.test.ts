// src/test/listing.service.test.ts
// ─── Tests for ListingService ───────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import './setup'
import { listingService } from '@/modules/listings/listing.service'
import db from '@/lib/db'
import { AppError } from '@/shared/errors'

describe('ListingService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── deleteListing ─────────────────────────────────────────────────────────

  describe('deleteListing', () => {
    const mockListing = {
      id: 'listing-1',
      sellerId: 'seller-1',
      status: 'ACTIVE',
      title: 'Test Item',
    }

    it('soft-deletes listing owned by user', async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never)
      vi.mocked(db.listing.update).mockResolvedValue({} as never)

      await listingService.deleteListing('listing-1', 'seller-1', false)

      expect(db.listing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'listing-1' },
          data: expect.objectContaining({
            status: 'REMOVED',
          }),
        })
      )
    })

    it('allows admin to delete any listing', async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never)
      vi.mocked(db.listing.update).mockResolvedValue({} as never)

      await listingService.deleteListing('listing-1', 'admin-user', true)

      expect(db.listing.update).toHaveBeenCalled()
    })

    it('rejects if non-owner and not admin', async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never)

      await expect(
        listingService.deleteListing('listing-1', 'wrong-user', false)
      ).rejects.toThrow('permission')
    })

    it('rejects deletion of SOLD listing', async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue({
        ...mockListing,
        status: 'SOLD',
      } as never)

      await expect(
        listingService.deleteListing('listing-1', 'seller-1', false)
      ).rejects.toThrow('Sold listings')
    })

    it('throws NOT_FOUND for missing listing', async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(null)

      await expect(
        listingService.deleteListing('nope', 'seller-1', false)
      ).rejects.toThrow(AppError)
    })

    it('rejects empty listing ID', async () => {
      await expect(
        listingService.deleteListing('', 'seller-1', false)
      ).rejects.toThrow('Invalid listing ID')
    })
  })

  // ── toggleWatch ───────────────────────────────────────────────────────────

  describe('toggleWatch', () => {
    it('adds listing to watchlist when not watching', async () => {
      vi.mocked(db.watchlistItem.findUnique).mockResolvedValue(null)
      vi.mocked(db.listing.findUnique).mockResolvedValue({ id: 'listing-1' } as never)
      vi.mocked(db.$transaction).mockResolvedValue([] as never)

      const result = await listingService.toggleWatch('listing-1', 'user-1')

      expect(result.watching).toBe(true)
    })

    it('removes listing from watchlist when already watching', async () => {
      vi.mocked(db.watchlistItem.findUnique).mockResolvedValue({
        userId: 'user-1',
        listingId: 'listing-1',
      } as never)
      vi.mocked(db.$transaction).mockResolvedValue([] as never)

      const result = await listingService.toggleWatch('listing-1', 'user-1')

      expect(result.watching).toBe(false)
    })

    it('throws NOT_FOUND when listing does not exist', async () => {
      vi.mocked(db.watchlistItem.findUnique).mockResolvedValue(null)
      vi.mocked(db.listing.findUnique).mockResolvedValue(null)

      await expect(
        listingService.toggleWatch('nope', 'user-1')
      ).rejects.toThrow(AppError)
    })
  })

  // ── getListingById ────────────────────────────────────────────────────────

  describe('getListingById', () => {
    it('returns listing with seller info', async () => {
      const mockListing = {
        id: 'listing-1',
        title: 'Test Item',
        seller: { id: 'seller-1', displayName: 'Seller' },
        images: [],
        attrs: [],
      }
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never)
      vi.mocked(db.listing.update).mockResolvedValue({} as never) // view count increment

      const result = await listingService.getListingById('listing-1')

      expect(result).toBeTruthy()
      expect(result!.id).toBe('listing-1')
    })

    it('returns null for deleted/missing listing', async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(null)

      const result = await listingService.getListingById('nope')

      expect(result).toBeNull()
    })
  })
})
