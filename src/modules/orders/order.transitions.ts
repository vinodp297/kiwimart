// src/modules/orders/order.transitions.ts
// ─── Order State Machine ───────────────────────────────────────────────────
// Single source of truth for all valid order status transitions.
// Use transitionOrder() everywhere instead of db.order.update({ status: ... })
// to guarantee:
//   1. No invalid status transitions (e.g. COMPLETED → DISPATCHED)
//   2. Optimistic locking via updateMany so concurrent processes can't both
//      succeed on the same transition (double-release, double-refund, etc.)
//
// The optimistic lock works by including the CURRENT status in the WHERE
// clause of the updateMany. If the status changed between our read and
// write, the updateMany returns count=0 and we throw a P2025-coded error.
// The caller should catch P2025 and treat it as "already processed".

import { AppError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import { Prisma } from "@prisma/client";
import { orderRepository } from "./order.repository";

// Metadata carried through a status transition (e.g. reason, reference IDs).
// Deliberately wide but excludes `any` — callers must use serialisable values.
// Date is included because timestamps (e.g. completedAt, cancelledAt) are
// commonly set alongside a status change.
export type TransitionData = Record<
  string,
  string | number | boolean | Date | null | undefined
>;

// ── Valid transitions ─────────────────────────────────────────────────────
// Key = current status, Value = allowed next statuses.
// Terminal states (COMPLETED, REFUNDED, CANCELLED) have no outgoing edges.

export const VALID_ORDER_TRANSITIONS: Record<string, string[]> = {
  AWAITING_PAYMENT: ["PAYMENT_HELD", "AWAITING_PICKUP", "CANCELLED"],
  PAYMENT_HELD: ["DISPATCHED", "CANCELLED", "DISPUTED"],
  AWAITING_PICKUP: ["COMPLETED", "CANCELLED", "DISPUTED"],
  DISPATCHED: ["DELIVERED", "DISPUTED", "COMPLETED"],
  DELIVERED: ["COMPLETED", "DISPUTED"],
  DISPUTED: ["COMPLETED", "REFUNDED", "CANCELLED"],
  COMPLETED: [], // Terminal
  REFUNDED: [], // Terminal
  CANCELLED: [], // Terminal
};

// ── assertOrderTransition ─────────────────────────────────────────────────
// Throws if the transition is not in the valid set.

export function assertOrderTransition(
  orderId: string,
  from: string,
  to: string,
): void {
  const allowed = VALID_ORDER_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid order transition: ${from} → ${to} for order ${orderId}. ` +
        `Allowed: ${allowed.join(", ") || "none (terminal state)"}`,
    );
  }
}

// ── transitionOrder ───────────────────────────────────────────────────────
// Validates the transition, then applies it with an optimistic lock.
//
// The optimistic lock (WHERE status = currentStatus) ensures that if two
// processes both read the same status and race to update, only one wins.
// The loser gets count=0 which we surface as a P2025-coded error.
//
// Options:
//   tx          — Prisma transaction client (pass when already inside a tx)
//   fromStatus  — known current status (skips internal findUnique read)
//
export async function transitionOrder(
  orderId: string,
  to: string,
  data: TransitionData = {},
  options: { tx?: Prisma.TransactionClient; fromStatus?: string } = {},
): Promise<void> {
  const { tx, fromStatus } = options;

  let currentStatus = fromStatus;

  // Only fetch if fromStatus wasn't provided by the caller
  if (!currentStatus) {
    const order = await orderRepository.findByIdForTransition(orderId, tx);
    if (!order) throw AppError.notFound("Order");
    currentStatus = order.status as string;
  }

  // Validate the transition against the state machine
  assertOrderTransition(orderId, currentStatus, to);

  // Apply with optimistic lock: include current status in WHERE
  // If another process already transitioned this order, count will be 0
  // assertOrderTransition() above guarantees currentStatus and to are valid
  // OrderStatus enum values — the casts here are safe by construction.
  const result = await orderRepository.updateStatusOptimistic(
    orderId,
    currentStatus,
    to,
    data,
    tx,
  );

  if (result.count === 0) {
    // Another process updated the status between our read and write
    logger.warn("order.transition.optimistic_lock_failed", {
      orderId,
      expectedStatus: currentStatus,
      targetStatus: to,
    });
    const err = Object.assign(
      new Error(
        `Order ${orderId}: concurrent modification detected ` +
          `(expected ${currentStatus}, targeting ${to})`,
      ),
      { code: "P2025" },
    );
    throw err;
  }

  logger.info("order.transition.applied", { orderId, from: currentStatus, to });
}
