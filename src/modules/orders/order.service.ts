// src/modules/orders/order.service.ts
// ─── Order Service — re-export barrel ────────────────────────────────────────
// All order lifecycle logic lives in focused service files.
// This barrel preserves the OrderService class interface and all import paths.

import { createOrder } from "./order-create.service";
import { confirmDelivery, markDispatched } from "./order-dispatch.service";
import { cancelOrder } from "./order-cancel.service";
import { openDispute } from "./order-dispute.service";

// Re-export types so existing `import type { ... } from "./order.service"` works
export type { DeliveryFeedback } from "./order-dispatch.service";
export type { CancellationStatus } from "./order-cancel.service";

// Re-export standalone function so test imports keep resolving
export { getCancellationStatus } from "./order-cancel.service";

// ── OrderService class ────────────────────────────────────────────────────────
// Delegates to standalone functions via instance property assignment.
// All callers using `orderService.method(...)` continue to work unchanged.

export class OrderService {
  confirmDelivery = confirmDelivery;
  markDispatched = markDispatched;
  openDispute = openDispute;
  cancelOrder = cancelOrder;
  createOrder = createOrder;
}

export const orderService = new OrderService();
