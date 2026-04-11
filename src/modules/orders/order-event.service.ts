// src/modules/orders/order-event.service.ts
// ─── Order Event Service ────────────────────────────────────────────────────
// Records state transitions and significant actions on orders.
// Every event write is fire-and-forget — a failed write never blocks
// or breaks an order state transition.

import { logger } from "@/shared/logger";
import type { Prisma } from "@prisma/client";
import { orderRepository, type DbClient } from "./order.repository";

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
  DELIVERY_ISSUE_REPORTED: "DELIVERY_ISSUE_REPORTED",
  DELIVERY_CONFIRMED_OK: "DELIVERY_CONFIRMED_OK",
  AUTO_RESOLVED: "AUTO_RESOLVED",
  FRAUD_FLAGGED: "FRAUD_FLAGGED",
  DELIVERY_REMINDER_SENT: "DELIVERY_REMINDER_SENT",
  AUTO_COMPLETED: "AUTO_COMPLETED",
  CHARGE_REFUNDED: "CHARGE_REFUNDED",
  CHARGEBACK_OPENED: "CHARGEBACK_OPENED",
  CHARGEBACK_RESOLVED: "CHARGEBACK_RESOLVED",
  PAYMENT_INTENT_CANCELLED: "PAYMENT_INTENT_CANCELLED",
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
  /** Optional transaction client. When provided, the event write uses this
   *  transaction (awaitable) so it rolls back with the parent if it fails.
   *  When omitted, the write is fire-and-forget (backward compatible). */
  tx?: DbClient;
}

export class OrderEventService {
  /**
   * Record an order event.
   *
   * When `input.tx` is provided, the write participates in that transaction
   * and returns a Promise<void> that the caller must await. Failures propagate
   * so the parent transaction rolls back.
   *
   * When `input.tx` is omitted, the write is fire-and-forget (backward
   * compatible). Silently catches errors so a failed event write never blocks
   * an order state transition.
   */
  recordEvent(input: RecordEventInput): void | Promise<void> {
    const eventData = {
      orderId: input.orderId,
      type: input.type,
      actorId: input.actorId ?? null,
      actorRole: input.actorRole,
      summary: input.summary,
      metadata: (input.metadata ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
    };

    logger.info("order-event.recorded", {
      orderId: input.orderId,
      type: input.type,
      actorRole: input.actorRole,
      actorId: input.actorId ?? undefined,
    });

    // When a transaction client is provided, the write participates in the
    // transaction — failures propagate (caller must await). When omitted,
    // fire-and-forget to preserve backward compatibility.
    if (input.tx) {
      return orderRepository
        .createEvent(eventData, input.tx)
        .then(() => undefined);
    }

    orderRepository.createEvent(eventData).catch((err) => {
      logger.error("order-event.write.failed", {
        error: err instanceof Error ? err.message : String(err),
        orderId: input.orderId,
        type: input.type,
      });
    });
  }

  /**
   * Fetch the full event timeline for an order.
   * Returns events ordered by createdAt ascending with actor details.
   */
  async getOrderTimeline(orderId: string) {
    return orderRepository.findEventsByOrderId(orderId);
  }
}

export const orderEventService = new OrderEventService();
