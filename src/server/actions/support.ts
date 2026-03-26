'use server';
// src/server/actions/support.ts
// ─── Support Admin Search Actions ────────────────────────────────────────────

import { requirePermission } from '@/shared/auth/requirePermission';
import db from '@/lib/db';

export async function lookupUser(query: string) {
  await requirePermission('VIEW_USER_PII');

  if (!query.trim()) return null;

  return db.user.findFirst({
    where: {
      OR: [
        { email: { contains: query, mode: 'insensitive' } },
        { username: { contains: query, mode: 'insensitive' } },
        { displayName: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, email: true, username: true, displayName: true,
      emailVerified: true, phoneVerified: true, idVerified: true,
      sellerEnabled: true, stripeOnboarded: true, isBanned: true,
      createdAt: true, region: true,
      _count: { select: { listings: true, buyerOrders: true, sellerOrders: true } },
    },
  });
}

export async function lookupOrder(orderId: string) {
  await requirePermission('VIEW_ORDER_DETAILS');

  if (!orderId.trim()) return null;

  return db.order.findUnique({
    where: { id: orderId },
    include: {
      listing: { select: { title: true, priceNzd: true } },
      buyer: { select: { displayName: true, email: true } },
      seller: { select: { displayName: true, email: true } },
    },
  });
}
