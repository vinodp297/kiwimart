// src/modules/orders/order-event.service.ts
// ─── Order Event Service ────────────────────────────────────────────────────
// Records state transitions and significant actions on orders.
// Every event write is fire-and-forget — a failed write never blocks
// or breaks an order state transition.

import db from "@/lib/db";
import { logger } from "@/shared/logger";
import type { Prisma } from "@prisma/client";

// ── Event type constants ────────────────────────────────────────────────────
// Plain strings (not a Prisma enum) so new types can be added without migrations.

export const ORDER_EVENT_TYPES = {
  ORDER_CREATED: "ORDER_CREATED",
  PAYMENT_HELD: "PAYMENT_HELD",
  PAYMENT_CAPTURED: "PAYMENT_CAPTURED",
  DISPATCHED: "DISPATCHED",
  DELIVERED: "DELIVERED",
  COMPLETED: "COMPLETED",
  CANCEL_REQUESTED: "CANCEL_REQUESTED",
  CANCEL_APPROVED: "CANCEL_APPROVED",
  CANCEL_REJECTED: "CANCEL_REJECTED",
  CANCEL_AUTO_APPROVED: "CANCEL_AUTO_APPROVED",
  DISPUTE_OPENED: "DISPUTE_OPENED",
  DISPUTE_RESPONDED: "DISPUTE_RESPONDED",
  DISPUTE_RESOLVED: "DISPUTE_RESOLVED",
  REFUNDED: "REFUNDED",
  CANCELLED: "CANCELLED",
  RETURN_REQUESTED: "RETURN_REQUESTED",
  RETURN_APPROVED: "RETURN_APPROVED",
  RETURN_REJECTED: "RETURN_REJECTED",
  PARTIAL_REFUND_REQUESTED: "PARTIAL_REFUND_REQUESTED",
  PARTIAL_REFUND_APPROVED: "PARTIAL_REFUND_APPROVED",
  SHIPPING_DELAY_NOTIFIED: "SHIPPING_DELAY_NOTIFIED",
  INTERACTION_EXPIRED: "INTERACTION_EXPIRED",
  REVIEW_SUBMITTED: "REVIEW_SUBMITTED",
} as const;

export type OrderEventType =
  (typeof ORDER_EVENT_TYPES)[keyof typeof ORDER_EVENT_TYPES];

export const ACTOR_ROLES = {
  BUYER: "BUYER",
  SELLER: "SELLER",
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
} as const;

export type ActorRole = (typeof ACTOR_ROLES)[keyof typeof ACTOR_ROLES];

// ── Service ─────────────────────────────────────────────────────────────────

export interface RecordEventInput {
  orderId: string;
  type: OrderEventType;
  actorId?: string | null;
  actorRole: ActorRole;
  summary: string;
  metadata?: Record<string, unknown>;
}

export class OrderEventService {
  /**
   * Record an order event.
   *
   * Fire-and-forget — do NOT await this. Matches the `audit()` pattern
   * in src/server/lib/audit.ts. Silently catches errors so a failed
   * event write never blocks an order state transition.
   */
  recordEvent(input: RecordEventInput): void {
    db.orderEvent
      .create({
        data: {
          orderId: input.orderId,
          type: input.type,
          actorId: input.actorId ?? null,
          actorRole: input.actorRole,
          summary: input.summary,
          metadata: (input.metadata ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
        },
      })
      .catch((err) => {
        logger.error("order-event.write.failed", {
          error: err instanceof Error ? err.message : String(err),
          orderId: input.orderId,
          type: input.type,
        });
      });

    logger.info("order-event.recorded", {
      orderId: input.orderId,
      type: input.type,
      actorRole: input.actorRole,
      actorId: input.actorId ?? undefined,
    });
  }

  /**
   * Fetch the full event timeline for an order.
   * Returns events ordered by createdAt ascending with actor details.
   */
  async getOrderTimeline(orderId: string) {
    return db.orderEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        actorRole: true,
        summary: true,
        metadata: true,
        createdAt: true,
        actor: {
          select: {
            id: true,
            displayName: true,
            username: true,
          },
        },
      },
    });
  }
}

export const orderEventService = new OrderEventService();
