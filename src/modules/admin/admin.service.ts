// src/modules/admin/admin.service.ts
// ─── Admin Service ───────────────────────────────────────────────────────────
// Admin-only operations. Framework-free. Takes adminUserId as parameter.

import db from '@/lib/db'
import { audit } from '@/server/lib/audit'
import { paymentService } from '@/modules/payments/payment.service'
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

    await db.report.update({
      where: { id: reportId },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedBy: adminUserId,
      },
    })

    if (action === 'remove' && report.listingId) {
      await db.listing.update({
        where: { id: report.listingId },
        data: { status: 'REMOVED' },
      })
    }

    if (action === 'ban' && report.targetUserId) {
      await db.user.update({
        where: { id: report.targetUserId },
        data: {
          isBanned: true,
          bannedAt: new Date(),
          bannedReason: 'Banned following report review.',
        },
      })
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

    if (favour === 'buyer') {
      // STRIPE REFUND FIRST via PaymentService — then DB
      await paymentService.refundPayment({
        paymentIntentId: order.stripePaymentIntentId,
        orderId,
      })

      await db.order.update({
        where: { id: orderId },
        data: { status: 'REFUNDED', disputeResolvedAt: new Date() },
      })
    } else {
      // STRIPE CAPTURE FIRST via PaymentService — then DB
      await paymentService.capturePayment({
        paymentIntentId: order.stripePaymentIntentId,
        orderId,
      })

      await db.$transaction([
        db.order.update({
          where: { id: orderId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            disputeResolvedAt: new Date(),
          },
        }),
        db.payout.updateMany({
          where: { orderId },
          data: { status: 'PROCESSING', initiatedAt: new Date() },
        }),
      ])
    }

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
