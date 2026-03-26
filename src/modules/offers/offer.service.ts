// src/modules/offers/offer.service.ts
// ─── Offer Service ───────────────────────────────────────────────────────────
// Offer lifecycle operations. Framework-free.

import db from '@/lib/db'
import { audit } from '@/server/lib/audit'
import { logger } from '@/shared/logger'
import { AppError } from '@/shared/errors'
import type { CreateOfferInput, RespondOfferInput } from './offer.types'

export class OfferService {
  async createOffer(input: CreateOfferInput, userId: string, ip: string): Promise<{ offerId: string }> {
    const listing = await db.listing.findUnique({
      where: { id: input.listingId, status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        sellerId: true,
        title: true,
        priceNzd: true,
        offersEnabled: true,
        seller: { select: { email: true, displayName: true } },
      },
    })

    if (!listing) throw AppError.notFound('Listing')
    if (!listing.offersEnabled) {
      throw AppError.validation('This seller is not accepting offers.')
    }
    if (listing.sellerId === userId) {
      throw AppError.validation('You cannot make an offer on your own listing.')
    }

    const amountCents = Math.round(input.amount * 100)
    if (amountCents >= listing.priceNzd) {
      throw AppError.validation('Your offer must be less than the asking price. Use "Buy Now" instead.')
    }
    if (amountCents < listing.priceNzd * 0.5) {
      throw AppError.validation('Offers below 50% of the asking price are not accepted.')
    }

    const existingOffer = await db.offer.findFirst({
      where: { listingId: input.listingId, buyerId: userId, status: 'PENDING' },
    })
    if (existingOffer) {
      throw AppError.validation('You already have a pending offer on this listing. Withdraw it to make a new one.')
    }

    const offer = await db.offer.create({
      data: {
        listingId: input.listingId,
        buyerId: userId,
        sellerId: listing.sellerId,
        amountNzd: amountCents,
        note: input.note ?? null,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
      select: { id: true },
    })

    // Notify seller
    const buyer = await db.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    })
    try {
      const { emailQueue } = await import('@/lib/queue')
      await emailQueue.add('offerReceived', {
        type: 'offerReceived' as const,
        payload: {
          to: listing.seller.email,
          sellerName: listing.seller.displayName,
          buyerName: buyer?.displayName ?? 'A buyer',
          listingTitle: listing.title,
          offerAmount: input.amount,
          listingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/listings/${input.listingId}`,
        },
      }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } })
    } catch {
      const { sendOfferReceivedEmail } = await import('@/server/email')
      sendOfferReceivedEmail({
        to: listing.seller.email,
        sellerName: listing.seller.displayName,
        buyerName: buyer?.displayName ?? 'A buyer',
        listingTitle: listing.title,
        offerAmount: input.amount,
        listingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/listings/${input.listingId}`,
      }).catch(() => {})
    }

    audit({
      userId,
      action: 'OFFER_CREATED',
      entityType: 'Offer',
      entityId: offer.id,
      metadata: { listingId: input.listingId, amountNzd: amountCents },
      ip,
    })

    logger.info('offer.created', { offerId: offer.id, listingId: input.listingId, userId })

    return { offerId: offer.id }
  }

  async respondOffer(input: RespondOfferInput, userId: string, ip: string): Promise<void> {
    const offer = await db.offer.findUnique({
      where: { id: input.offerId },
      include: {
        buyer: { select: { email: true, displayName: true } },
        listing: { select: { id: true, title: true } },
      },
    })

    if (!offer) throw AppError.notFound('Offer')
    if (offer.sellerId !== userId) {
      throw AppError.unauthorised('You do not have permission to respond to this offer.')
    }
    if (offer.status !== 'PENDING') {
      throw new AppError('ORDER_WRONG_STATE', 'This offer has already been responded to.', 400)
    }
    if (offer.expiresAt < new Date()) {
      throw new AppError('ORDER_WRONG_STATE', 'This offer has expired.', 400)
    }

    const newStatus = input.action === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED'
    await db.offer.update({
      where: { id: input.offerId },
      data: {
        status: newStatus,
        respondedAt: new Date(),
        declineNote: input.declineNote ?? null,
        // Give buyer 24 hours to complete payment after acceptance
        ...(input.action === 'ACCEPT' && {
          paymentDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }),
      },
    })

    if (input.action === 'ACCEPT') {
      await db.listing.update({
        where: { id: offer.listingId },
        data: { status: 'RESERVED' },
      })
      await db.offer.updateMany({
        where: {
          listingId: offer.listingId,
          id: { not: input.offerId },
          status: 'PENDING',
        },
        data: { status: 'DECLINED', respondedAt: new Date() },
      })
    }

    // Notify buyer
    try {
      const { emailQueue } = await import('@/lib/queue')
      await emailQueue.add('offerResponse', {
        type: 'offerResponse' as const,
        payload: {
          to: offer.buyer.email,
          buyerName: offer.buyer.displayName,
          listingTitle: offer.listing.title,
          accepted: input.action === 'ACCEPT',
          listingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/listings/${offer.listingId}`,
        },
      }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } })
    } catch {
      const { sendOfferResponseEmail } = await import('@/server/email')
      sendOfferResponseEmail({
        to: offer.buyer.email,
        buyerName: offer.buyer.displayName,
        listingTitle: offer.listing.title,
        accepted: input.action === 'ACCEPT',
        listingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/listings/${offer.listingId}`,
      }).catch(() => {})
    }

    audit({
      userId,
      action: input.action === 'ACCEPT' ? 'OFFER_ACCEPTED' : 'OFFER_DECLINED',
      entityType: 'Offer',
      entityId: input.offerId,
      ip,
    })

    logger.info('offer.responded', {
      offerId: input.offerId,
      action: input.action,
      userId,
    })
  }
}

export const offerService = new OfferService()
