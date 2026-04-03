"use server";
// src/server/actions/support.ts
// ─── Support Admin Search Actions ────────────────────────────────────────────

import { requirePermission } from "@/shared/auth/requirePermission";
import db from "@/lib/db";
import { userRepository } from "@/modules/users/user.repository";

export async function lookupUser(query: string) {
  await requirePermission("VIEW_USER_PII");

  if (!query.trim()) return null;

  return userRepository.findForSupport(query.trim());
}

export async function lookupOrder(orderId: string) {
  await requirePermission("VIEW_ORDER_DETAILS");

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
