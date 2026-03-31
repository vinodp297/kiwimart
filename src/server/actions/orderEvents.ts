"use server";
// src/server/actions/orderEvents.ts
// ─── Order Event Server Actions ─────────────────────────────────────────────
// Thin wrapper around orderEventService with authorization checks.

import { requireUser } from "@/server/lib/requireUser";
import { orderEventService } from "@/modules/orders/order-event.service";
import db from "@/lib/db";
import type { ActionResult } from "@/types";

export interface TimelineEventData {
  id: string;
  type: string;
  actorRole: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { displayName: string | null; username: string } | null;
}

export async function getOrderTimeline(
  orderId: string,
): Promise<ActionResult<TimelineEventData[]>> {
  try {
    const user = await requireUser();

    // Authorization: only buyer, seller, or admin can view the timeline
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { buyerId: true, sellerId: true },
    });

    if (!order) {
      return { success: false, error: "Order not found." };
    }

    const isParty =
      order.buyerId === user.id || order.sellerId === user.id || user.isAdmin;

    if (!isParty) {
      return { success: false, error: "You do not have access to this order." };
    }

    const events = await orderEventService.getOrderTimeline(orderId);

    return {
      success: true,
      data: events.map((e) => ({
        id: e.id,
        type: e.type,
        actorRole: e.actorRole,
        summary: e.summary,
        metadata: e.metadata as Record<string, unknown> | null,
        createdAt: e.createdAt.toISOString(),
        actor: e.actor
          ? { displayName: e.actor.displayName, username: e.actor.username }
          : null,
      })),
    };
  } catch {
    return {
      success: false,
      error: "Could not load order timeline.",
    };
  }
}
