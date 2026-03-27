// src/modules/orders/order.service.ts
// ─── Order Service ───────────────────────────────────────────────────────────
// All order lifecycle operations. Framework-free — no Next.js imports.
// Rule: Stripe FIRST, then DB.

import db from '@/lib/db'
import { audit } from '@/server/lib/audit'
import { paymentService } from '@/modules/payments/payment.service'
import { logger } from '@/shared/logger'
import { AppError } from '@/shared/errors'
import { createNotification } from '@/modules/notifications/notification.service'
import { sendDisputeOpenedEmail, sendOrderDispatchedEmail } from '@/server/email'
import type { DispatchOrderInput, OpenDisputeInput } from './order.types'

export class OrderService {
  async confirmDelivery(orderId: string, buyerId: string): Promise<void> {
    logger.info('order.confirm_delivery.attempting', { orderId, buyerId })

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        status: true,
        stripePaymentIntentId: true,
        totalNzd: true,
      },
    })

    if (!order) throw AppError.notFound('Order')

    if (order.buyerId !== buyerId) {
      throw AppError.unauthorised('Only the buyer can confirm delivery.')
    }

    if (order.status !== 'DISPATCHED' && order.status !== 'DELIVERED') {
      throw new AppError('ORDER_WRONG_STATE', 'Order is not in a deliverable state.', 400)
    }

    if (!order.stripePaymentIntentId) {
      logger.error('order.confirm_delivery.no_payment_intent', { orderId, buyerId })
      throw AppError.missingPaymentIntent()
    }

    // Stripe FIRST — then DB
    await paymentService.capturePayment({
      paymentIntentId: order.stripePaymentIntentId,
      orderId,
    })

    // DB update ONLY after Stripe success
    await db.$transaction([
      db.order.update({
        where: { id: orderId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      }),
      db.payout.updateMany({
        where: { orderId },
        data: { status: 'PROCESSING', initiatedAt: new Date() },
      }),
      db.listing.update({
        where: { id: order.listingId },
        data: { status: 'SOLD', soldAt: new Date() },
      }),
    ])

    // Queue payout processing (3 business days delay)
    try {
      const seller = await db.user.findUnique({
        where: { id: order.sellerId },
        select: { stripeAccountId: true },
      })
      if (seller?.stripeAccountId) {
        const { payoutQueue } = await import('@/lib/queue')
        await payoutQueue.add(
          'process-payout',
          {
            orderId,
            sellerId: order.sellerId,
            amountNzd: order.totalNzd,
            stripeAccountId: seller.stripeAccountId,
          },
          {
            delay: 3 * 24 * 60 * 60 * 1000,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          }
        )
      }
    } catch {
      logger.warn('order.payout_queue.failed', { orderId })
    }

    audit({
      userId: buyerId,
      action: 'ORDER_STATUS_CHANGED',
      entityType: 'Order',
      entityId: orderId,
      metadata: { newStatus: 'COMPLETED', previousStatus: order.status },
    })

    // Notify seller that payment has been released
    const listing = await db.listing.findUnique({
      where: { id: order.listingId },
      select: { title: true },
    })
    createNotification({
      userId:   order.sellerId,
      type:     'ORDER_COMPLETED',
      title:    'Payment released! 💰',
      body:     `Buyer confirmed delivery${listing ? ` of "${listing.title}"` : ''}. Your payout is being processed.`,
      listingId: order.listingId,
      orderId,
      link:     '/dashboard/seller?tab=orders',
    }).catch(() => {})

    logger.info('order.delivery_confirmed', { orderId, buyerId, sellerId: order.sellerId })
  }

  async markDispatched(input: DispatchOrderInput, sellerId: string): Promise<void> {
    logger.info('order.dispatch.attempting', { orderId: input.orderId, sellerId })

    const order = await db.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        sellerId: true,
        status: true,
        buyerId: true,
        listing: { select: { title: true } },
        buyer: { select: { email: true, displayName: true } },
      },
    })

    if (!order) throw AppError.notFound('Order')

    if (order.sellerId !== sellerId) {
      throw AppError.unauthorised('Only the seller can mark an order as dispatched.')
    }

    if (order.status !== 'PAYMENT_HELD') {
      throw new AppError('ORDER_WRONG_STATE', 'Order must be in PAYMENT_HELD status to dispatch.', 400)
    }

    await db.order.update({
      where: { id: input.orderId },
      data: {
        status: 'DISPATCHED',
        dispatchedAt: new Date(),
        trackingNumber: input.trackingNumber ?? null,
        trackingUrl: input.trackingUrl ?? null,
      },
    })

    // Notify buyer directly — BullMQ worker does not run on Vercel serverless
    try {
      await sendOrderDispatchedEmail({
        to: order.buyer.email,
        buyerName: order.buyer.displayName,
        listingTitle: order.listing.title,
        trackingNumber: input.trackingNumber,
        trackingUrl: input.trackingUrl,
        orderUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/buyer`,
      })
    } catch (err) {
      logger.warn('order.dispatch.email.failed', {
        orderId: input.orderId,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    audit({
      userId: sellerId,
      action: 'ORDER_STATUS_CHANGED',
      entityType: 'Order',
      entityId: input.orderId,
      metadata: { newStatus: 'DISPATCHED', trackingNumber: input.trackingNumber },
    })

    // Notify buyer that their item has been dispatched
    createNotification({
      userId:   order.buyerId,
      type:     'ORDER_DISPATCHED',
      title:    'Your item has been dispatched 📦',
      body:     `"${order.listing.title}" is on its way!${input.trackingNumber ? ` Tracking: ${input.trackingNumber}` : ''}`,
      orderId:  input.orderId,
      link:     '/dashboard/buyer?tab=orders',
    }).catch(() => {})

    logger.info('order.dispatched', { orderId: input.orderId, sellerId })
  }

  async openDispute(input: OpenDisputeInput, buyerId: string, ip: string): Promise<void> {
    logger.info('order.dispute.opening', { orderId: input.orderId, buyerId })

    const order = await db.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        dispatchedAt: true,
        disputeOpenedAt: true,
        listing: { select: { title: true } },
        seller: { select: { email: true, displayName: true } },
        buyer:  { select: { displayName: true } },
      },
    })

    if (!order) throw AppError.notFound('Order')

    if (order.buyerId !== buyerId) {
      throw AppError.unauthorised('Only the buyer can open a dispute.')
    }

    if (order.status !== 'DISPATCHED' && order.status !== 'DELIVERED') {
      throw new AppError(
        'ORDER_WRONG_STATE',
        'Disputes can only be opened for dispatched or delivered orders.',
        400
      )
    }

    if (order.disputeOpenedAt) {
      throw new AppError(
        'ORDER_WRONG_STATE',
        'A dispute has already been opened for this order.',
        400
      )
    }

    if (order.dispatchedAt) {
      const daysSinceDispatch =
        (Date.now() - order.dispatchedAt.getTime()) / (1000 * 60 * 60 * 24)
      if (daysSinceDispatch > 14) {
        throw new AppError(
          'ORDER_WRONG_STATE',
          'Disputes must be opened within 14 days of dispatch.',
          400
        )
      }
    }

    await db.order.update({
      where: { id: input.orderId },
      data: {
        status: 'DISPUTED',
        disputeReason: input.reason,
        disputeOpenedAt: new Date(),
        disputeNotes: input.description,
      },
    })

    // Notify seller directly — BullMQ worker does not run on Vercel serverless
    try {
      await sendDisputeOpenedEmail({
        to:           order.seller.email,
        sellerName:   order.seller.displayName,
        buyerName:    order.buyer?.displayName ?? 'A buyer',
        listingTitle: order.listing.title,
        orderId:      input.orderId,
        reason:       input.reason,
        description:  input.description,
      })
    } catch (err) {
      logger.warn('order.dispute.email.failed', {
        orderId: input.orderId,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    audit({
      userId: buyerId,
      action: 'DISPUTE_OPENED',
      entityType: 'Order',
      entityId: input.orderId,
      metadata: { reason: input.reason, description: input.description.slice(0, 100) },
      ip,
    })

    // Notify seller that a dispute has been opened
    createNotification({
      userId:  order.sellerId,
      type:    'ORDER_DISPUTED',
      title:   '⚠️ A dispute has been opened',
      body:    `A buyer opened a dispute on "${order.listing.title}". Please check your dashboard.`,
      orderId: input.orderId,
      link:    '/dashboard/seller?tab=orders',
    }).catch(() => {})

    logger.info('order.dispute.opened', { orderId: input.orderId, buyerId })
  }
}

export const orderService = new OrderService()
