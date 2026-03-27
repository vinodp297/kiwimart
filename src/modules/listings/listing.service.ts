// src/modules/listings/listing.service.ts
// ─── Listing Service ─────────────────────────────────────────────────────────
// Listing CRUD and watchlist operations. Framework-free.

import db from '@/lib/db'
import { audit } from '@/server/lib/audit'
import { logger } from '@/shared/logger'
import { AppError } from '@/shared/errors'

export class ListingService {
  async deleteListing(listingId: string, userId: string, isAdmin: boolean): Promise<void> {
    if (!listingId) throw AppError.validation('Invalid listing ID.')

    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true, status: true, title: true },
    })
    if (!listing) throw AppError.notFound('Listing')

    if (listing.sellerId !== userId && !isAdmin) {
      throw AppError.unauthorised('You do not have permission to delete this listing.')
    }
    if (listing.status === 'SOLD') {
      throw new AppError('ORDER_WRONG_STATE', 'Sold listings cannot be deleted.', 400)
    }

    await db.listing.update({
      where: { id: listingId },
      data: { deletedAt: new Date(), status: 'REMOVED' },
    })

    audit({
      userId,
      action: 'LISTING_DELETED',
      entityType: 'Listing',
      entityId: listingId,
      metadata: { title: listing.title },
    })

    logger.info('listing.deleted', { listingId, userId })
  }

  async toggleWatch(listingId: string, userId: string): Promise<{ watching: boolean }> {
    const existing = await db.watchlistItem.findUnique({
      where: { userId_listingId: { userId, listingId } },
    })

    if (existing) {
      await db.$transaction([
        db.watchlistItem.delete({
          where: { userId_listingId: { userId, listingId } },
        }),
        db.listing.update({
          where: { id: listingId },
          data: { watcherCount: { decrement: 1 } },
        }),
      ])
      return { watching: false }
    }

    const listing = await db.listing.findUnique({
      where: { id: listingId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    })
    if (!listing) throw AppError.notFound('Listing')

    await db.$transaction([
      db.watchlistItem.create({ data: { userId, listingId } }),
      db.listing.update({
        where: { id: listingId },
        data: { watcherCount: { increment: 1 } },
      }),
    ])
    return { watching: true }
  }

  async getListingById(id: string) {
    const listing = await db.listing.findUnique({
      where: {
        id,
        status: { in: ['ACTIVE', 'RESERVED', 'SOLD'] },
        deletedAt: null,
      },
      include: {
        seller: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarKey: true,
            bio: true,
            region: true,
            suburb: true,
            idVerified: true,
            createdAt: true,
            _count: {
              select: {
                sellerOrders: { where: { status: 'COMPLETED' } },
                listings: { where: { status: 'ACTIVE' } },
                reviews: true,
              },
            },
            reviews: {
              select: { rating: true },
            },
          },
        },
        images: { orderBy: { order: 'asc' } },
        attrs: { orderBy: { order: 'asc' } },
      },
    })

    if (!listing) return null

    // Increment view count (fire-and-forget)
    db.listing
      .update({ where: { id }, data: { viewCount: { increment: 1 } } })
      .catch(() => {})

    return listing
  }
}

export const listingService = new ListingService()
