"use server";
// src/server/actions/support.ts
// ─── Support Admin Search Actions ────────────────────────────────────────────

import { requirePermission } from "@/shared/auth/requirePermission";
import { orderRepository } from "@/modules/orders/order.repository";
import { userRepository } from "@/modules/users/user.repository";

export async function lookupUser(query: string) {
  await requirePermission("VIEW_USER_PII");

  if (!query.trim()) return null;

  return userRepository.findForSupport(query.trim());
}

export async function lookupOrder(orderId: string) {
  await requirePermission("VIEW_ORDER_DETAILS");

  if (!orderId.trim()) return null;

  return orderRepository.findForSupportLookup(orderId);
}
