'use server';
// src/server/actions/admin.ts  (Sprint 8 — hardened admin actions)
// ─── Admin Server Actions ─────────────────────────────────────────────────────
// All actions do a FRESH DB check on every call — never trust JWT alone.

import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { audit } from '@/server/lib/audit';
import type { ActionResult } from '@/types';
import Stripe from 'stripe';
import { z } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' as any });

// ── Zod schemas for admin actions ────────────────────────────────────────────

const BanUserSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  reason: z.string().min(10, 'Ban reason must be at least 10 characters').max(500),
});

const ResolveReportSchema = z.object({
  reportId: z.string().min(1, 'Report ID is required'),
  action: z.enum(['dismiss', 'remove', 'ban']),
});

const ResolveDisputeSchema = z.object({
  orderId: z.string().min(1, 'Order ID is required'),
  favour: z.enum(['buyer', 'seller']),
});

// ── Guard helper — DB-backed, never trusts token alone ──────────────────────

async function requireAdmin(): Promise<{ userId: string } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'Authentication required.' };

  // ALWAYS check DB — never trust JWT isAdmin claim
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      isAdmin: true,
      isBanned: true,
    },
  });

  if (!user) return { error: 'User not found.' };

  if (user.isBanned) return { error: 'Account suspended.' };

  if (!user.isAdmin) {
    // Audit attempted admin access with stale/invalid token
    audit({
      userId: session.user.id,
      action: 'ADMIN_ACTION',
      entityType: 'User',
      entityId: session.user.id,
      metadata: {
        denied: true,
        reason: 'not_admin_in_db',
        tokenClaim: (session.user as { isAdmin?: boolean }).isAdmin,
      },
    });
    return { error: 'Unauthorised.' };
  }

  return { userId: user.id };
}

// ── banUser ────────────────────────────────────────────────────────────────────

export async function banUser(
  userId: string,
  reason: string
): Promise<ActionResult<void>> {
  const guard = await requireAdmin();
  if ('error' in guard) return { success: false, error: guard.error };

  const parsed = BanUserSchema.safeParse({ userId, reason });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  await db.$transaction([
    db.user.update({
      where: { id: parsed.data.userId },
      data: {
        isBanned: true,
        bannedAt: new Date(),
        bannedReason: parsed.data.reason,
      },
    }),
    db.session.deleteMany({ where: { userId: parsed.data.userId } }),
  ]);

  audit({
    userId: guard.userId,
    action: 'ADMIN_ACTION',
    entityType: 'User',
    entityId: parsed.data.userId,
    metadata: { action: 'ban', reason: parsed.data.reason },
  });

  return { success: true, data: undefined };
}

// ── unbanUser ──────────────────────────────────────────────────────────────────

export async function unbanUser(userId: string): Promise<ActionResult<void>> {
  const guard = await requireAdmin();
  if ('error' in guard) return { success: false, error: guard.error };

  if (!userId || typeof userId !== 'string') {
    return { success: false, error: 'Invalid user ID.' };
  }

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

  const parsed = ResolveReportSchema.safeParse({ reportId, action });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const report = await db.report.findUnique({
    where: { id: parsed.data.reportId },
    select: { id: true, listingId: true, targetUserId: true, status: true },
  });
  if (!report) return { success: false, error: 'Report not found.' };

  await db.report.update({
    where: { id: parsed.data.reportId },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolvedBy: guard.userId,
    },
  });

  if (parsed.data.action === 'remove' && report.listingId) {
    await db.listing.update({
      where: { id: report.listingId },
      data: { status: 'REMOVED' },
    });
  }

  if (parsed.data.action === 'ban' && report.targetUserId) {
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
    entityId: parsed.data.reportId,
    metadata: { action: parsed.data.action },
  });

  return { success: true, data: undefined };
}

// ── resolveDispute — FIX 4: Stripe FIRST then DB ─────────────────────────────

export async function resolveDispute(
  orderId: string,
  favour: 'buyer' | 'seller'
): Promise<ActionResult<void>> {
  const guard = await requireAdmin();
  if ('error' in guard) return { success: false, error: guard.error };

  const parsed = ResolveDisputeSchema.safeParse({ orderId, favour });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const order = await db.order.findUnique({
    where: { id: parsed.data.orderId },
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
  if (!order.stripePaymentIntentId) {
    return { success: false, error: 'Cannot resolve — no payment intent found.' };
  }

  if (parsed.data.favour === 'buyer') {
    // STRIPE REFUND FIRST — then DB
    try {
      await stripe.refunds.create({
        payment_intent: order.stripePaymentIntentId,
      });
    } catch (stripeErr) {
      const msg = String(stripeErr);
      audit({
        userId: guard.userId,
        action: 'ADMIN_ACTION',
        entityType: 'Order',
        entityId: parsed.data.orderId,
        metadata: { action: 'dispute_refund_failed', error: msg },
      });
      return {
        success: false,
        error: 'Stripe refund failed — order remains disputed.',
      };
    }

    // DB update ONLY after Stripe success
    await db.order.update({
      where: { id: parsed.data.orderId },
      data: {
        status: 'REFUNDED',
        disputeResolvedAt: new Date(),
      },
    });
  } else {
    // STRIPE CAPTURE FIRST — then DB
    try {
      await stripe.paymentIntents.capture(order.stripePaymentIntentId);
    } catch (stripeErr) {
      const msg = String(stripeErr);
      // Allow if already captured
      if (!msg.includes('already_captured') && !msg.includes('amount_capturable') && !msg.includes('already captured')) {
        audit({
          userId: guard.userId,
          action: 'ADMIN_ACTION',
          entityType: 'Order',
          entityId: parsed.data.orderId,
          metadata: { action: 'dispute_capture_failed', error: msg },
        });
        return {
          success: false,
          error: 'Stripe capture failed — order remains disputed.',
        };
      }
    }

    // DB update ONLY after Stripe success
    await db.$transaction([
      db.order.update({
        where: { id: parsed.data.orderId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          disputeResolvedAt: new Date(),
        },
      }),
      db.payout.updateMany({
        where: { orderId: parsed.data.orderId },
        data: {
          status: 'PROCESSING',
          initiatedAt: new Date(),
        },
      }),
    ]);
  }

  audit({
    userId: guard.userId,
    action: 'DISPUTE_RESOLVED',
    entityType: 'Order',
    entityId: parsed.data.orderId,
    metadata: { favour: parsed.data.favour, resolvedAt: new Date().toISOString() },
  });

  return { success: true, data: undefined };
}
