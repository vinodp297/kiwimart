// src/modules/admin/admin.service.ts
// ─── Admin Service ───────────────────────────────────────────────────────────
// Admin-only operations. Framework-free. Takes adminUserId as parameter.

import db from '@/lib/db'
import { audit } from '@/server/lib/audit'
import { paymentService } from '@/modules/payments/payment.service'
import { transitionOrder } from '@/modules/orders/order.transitions'
import { withLock } from '@/server/lib/distributedLock'
import { logger } from '@/shared/logger'
import { AppError } from '@/shared/errors'
import type { ReportAction, DisputeFavour } from './admin.types'

export class AdminService {
  async banUser(userId: string, reason: string, adminUserId: string): Promise<void> {
    await db.$transaction([
      db.user.update({
        where: { id: userId },
        data: {
          isBanned: true,
          bannedAt: new Date(),
          bannedReason: reason,
        },
      }),
      db.session.deleteMany({ where: { userId } }),
    ])

    audit({
      userId: adminUserId,
      action: 'ADMIN_ACTION',
      entityType: 'User',
      entityId: userId,
      metadata: { action: 'ban', reason },
    })

    logger.info('admin.user.banned', { userId, adminUserId })
  }

  async unbanUser(userId: string, adminUserId: string): Promise<void> {
    await db.user.update({
      where: { id: userId },
      data: { isBanned: false, bannedAt: null, bannedReason: null },
    })

    audit({
      userId: adminUserId,
      action: 'ADMIN_ACTION',
      entityType: 'User',
      entityId: userId,
      metadata: { action: 'unban' },
    })

    logger.info('admin.user.unbanned', { userId, adminUserId })
  }

  async toggleSellerEnabled(userId: string, adminUserId: string): Promise<void> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { sellerEnabled: true },
    })
    if (!user) throw AppError.notFound('User')

    await db.user.update({
      where: { id: userId },
      data: { sellerEnabled: !user.sellerEnabled },
    })

    audit({
      userId: adminUserId,
      action: 'ADMIN_ACTION',
      entityType: 'User',
      entityId: userId,
      metadata: { action: 'toggle_seller', newValue: !user.sellerEnabled },
    })
  }

  async resolveReport(
    reportId: string,
    action: ReportAction,
    adminUserId: string
  ): Promise<void> {
    const report = await db.report.findUnique({
      where: { id: reportId },
      select: { id: true, listingId: true, targetUserId: true, status: true },
    })
    if (!report) throw AppError.notFound('Report')

    // Wrap all DB mutations in a transaction for atomicity
    await db.$transaction(async (tx) => {
      await tx.report.update({
        where: { id: reportId },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedBy: adminUserId,
        },
      })

      if (action === 'remove' && report.listingId) {
        await tx.listing.update({
          where: { id: report.listingId },
          data: { status: 'REMOVED' },
        })
      }

      if (action === 'ban' && report.targetUserId) {
        await tx.user.update({
          where: { id: report.targetUserId },
          data: {
            isBanned: true,
            bannedAt: new Date(),
            bannedReason: 'Banned following report review.',
          },
        })
      }
    })

    // Delete sessions outside transaction — can't rollback session deletion anyway
    if (action === 'ban' && report.targetUserId) {
      await db.session.deleteMany({ where: { userId: report.targetUserId } })
    }

    audit({
      userId: adminUserId,
      action: 'ADMIN_ACTION',
      entityType: 'Report',
      entityId: reportId,
      metadata: { action },
    })

    logger.info('admin.report.resolved', { reportId, action, adminUserId })
  }

  async resolveDispute(
    orderId: string,
    favour: DisputeFavour,
    adminUserId: string
  ): Promise<void> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        stripePaymentIntentId: true,
      },
    })

    if (!order) throw AppError.notFound('Order')
    if (order.status !== 'DISPUTED') {
      throw new AppError('ORDER_WRONG_STATE', 'Order is not in dispute.', 400)
    }
    if (!order.stripePaymentIntentId) {
      throw AppError.missingPaymentIntent()
    }

    // Extract after null check so TypeScript narrows the type inside the async callback
    const paymentIntentId = order.stripePaymentIntentId

    await withLock(`dispute:${orderId}`, async () => {
      if (favour === 'buyer') {
        // DB first (optimistic) — then Stripe refund.
        // If Stripe fails, the order is already REFUNDED in DB so admin can retry Stripe.
        await transitionOrder(orderId, 'REFUNDED', { disputeResolvedAt: new Date() }, { fromStatus: order.status })

        try {
          await paymentService.refundPayment({
            paymentIntentId,
            orderId,
          })
        } catch (stripeError) {
          // Log for manual intervention — DB already updated
          logger.error('admin.dispute.refund_failed', {
            orderId,
            stripePaymentIntentId: paymentIntentId,
            error: stripeError instanceof Error ? stripeError.message : String(stripeError),
          })
          // Don't re-throw — admin sees REFUNDED status and can retry Stripe manually
        }
      } else {
        // Seller wins — capture first, then atomically update DB
        await paymentService.capturePayment({
          paymentIntentId,
          orderId,
        })

        await db.$transaction(async (tx) => {
          await transitionOrder(orderId, 'COMPLETED', {
            completedAt: new Date(),
            disputeResolvedAt: new Date(),
          }, { tx, fromStatus: order.status })
          await tx.payout.updateMany({
            where: { orderId },
            data: { status: 'PROCESSING', initiatedAt: new Date() },
          })
        })
      }
    })

    audit({
      userId: adminUserId,
      action: 'DISPUTE_RESOLVED',
      entityType: 'Order',
      entityId: orderId,
      metadata: { favour, resolvedAt: new Date().toISOString() },
    })

    logger.info('admin.dispute.resolved', { orderId, favour, adminUserId })
  }
}

export const adminService = new AdminService()
