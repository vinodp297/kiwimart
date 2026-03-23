'use server';
// src/server/actions/admin.ts  (Sprint 7 — admin actions)
// ─── Admin Server Actions ─────────────────────────────────────────────────────
// All actions check session.user.isAdmin === true before proceeding.

import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { audit } from '@/server/lib/audit';
import type { ActionResult } from '@/types';

// ── Guard helper ──────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<{ userId: string } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'Authentication required.' };
  const isAdmin = (session.user as { isAdmin?: boolean }).isAdmin;
  if (!isAdmin) return { error: 'Unauthorised.' };
  return { userId: session.user.id };
}

// ── banUser ────────────────────────────────────────────────────────────────────

export async function banUser(
  userId: string,
  reason: string
): Promise<ActionResult<void>> {
  const guard = await requireAdmin();
  if ('error' in guard) return { success: false, error: guard.error };

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
  ]);

  audit({
    userId: guard.userId,
    action: 'ADMIN_ACTION',
    entityType: 'User',
    entityId: userId,
    metadata: { action: 'ban', reason },
  });

  return { success: true, data: undefined };
}

// ── unbanUser ──────────────────────────────────────────────────────────────────

export async function unbanUser(userId: string): Promise<ActionResult<void>> {
  const guard = await requireAdmin();
  if ('error' in guard) return { success: false, error: guard.error };

  await db.user.update({
    where: { id: userId },
    data: { isBanned: false, bannedAt: null, bannedReason: null },
  });

  audit({
    userId: guard.userId,
    action: 'ADMIN_ACTION',
    entityType: 'User',
    entityId: userId,
    metadata: { action: 'unban' },
  });

  return { success: true, data: undefined };
}

// ── toggleSellerEnabled ────────────────────────────────────────────────────────

export async function toggleSellerEnabled(
  userId: string
): Promise<ActionResult<void>> {
  const guard = await requireAdmin();
  if ('error' in guard) return { success: false, error: guard.error };

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { sellerEnabled: true },
  });
  if (!user) return { success: false, error: 'User not found.' };

  await db.user.update({
    where: { id: userId },
    data: { sellerEnabled: !user.sellerEnabled },
  });

  audit({
    userId: guard.userId,
    action: 'ADMIN_ACTION',
    entityType: 'User',
    entityId: userId,
    metadata: { action: 'toggle_seller', newValue: !user.sellerEnabled },
  });

  return { success: true, data: undefined };
}

// ── resolveReport ──────────────────────────────────────────────────────────────

export async function resolveReport(
  reportId: string,
  action: 'dismiss' | 'remove' | 'ban'
): Promise<ActionResult<void>> {
  const guard = await requireAdmin();
  if ('error' in guard) return { success: false, error: guard.error };

  const report = await db.report.findUnique({
    where: { id: reportId },
    select: { id: true, listingId: true, targetUserId: true, status: true },
  });
  if (!report) return { success: false, error: 'Report not found.' };

  await db.report.update({
    where: { id: reportId },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolvedBy: guard.userId,
    },
  });

  if (action === 'remove' && report.listingId) {
    await db.listing.update({
      where: { id: report.listingId },
      data: { status: 'REMOVED' },
    });
  }

  if (action === 'ban' && report.targetUserId) {
    await db.user.update({
      where: { id: report.targetUserId },
      data: {
        isBanned: true,
        bannedAt: new Date(),
        bannedReason: 'Banned following report review.',
      },
    });
    await db.session.deleteMany({ where: { userId: report.targetUserId } });
  }

  audit({
    userId: guard.userId,
    action: 'ADMIN_ACTION',
    entityType: 'Report',
    entityId: reportId,
    metadata: { action },
  });

  return { success: true, data: undefined };
}

// ── resolveDispute ─────────────────────────────────────────────────────────────

export async function resolveDispute(
  orderId: string,
  favour: 'buyer' | 'seller'
): Promise<ActionResult<void>> {
  const guard = await requireAdmin();
  if ('error' in guard) return { success: false, error: guard.error };

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      stripePaymentIntentId: true,
    },
  });

  if (!order) return { success: false, error: 'Order not found.' };
  if (order.status !== 'DISPUTED') {
    return { success: false, error: 'Order is not in dispute.' };
  }

  if (favour === 'buyer') {
    await db.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });

    if (order.stripePaymentIntentId) {
      try {
        const { default: StripeLib } = await import('stripe');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stripe = new StripeLib(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' as any });
        await stripe.refunds.create({
          payment_intent: order.stripePaymentIntentId,
        });
      } catch (err) {
        console.error('[Admin] Stripe refund failed:', err);
      }
    }
  } else {
    await db.order.update({
      where: { id: orderId },
      data: { status: 'COMPLETED' },
    });

    if (order.stripePaymentIntentId) {
      try {
        const { default: StripeLib } = await import('stripe');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stripe = new StripeLib(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' as any });
        await stripe.paymentIntents.capture(order.stripePaymentIntentId);
      } catch (err) {
        console.error('[Admin] Stripe capture failed:', err);
      }
    }
  }

  audit({
    userId: guard.userId,
    action: 'ADMIN_ACTION',
    entityType: 'Order',
    entityId: orderId,
    metadata: { action: 'resolve_dispute', favour },
  });

  return { success: true, data: undefined };
}
