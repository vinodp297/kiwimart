"use server";
// src/server/actions/orders.ts
// ─── Barrel: re-exports from focused order action files ───────────────────────
// Import from here (backward-compat) or directly from the focused files:
//   order-create.actions.ts  — createOrder, uploadOrderEvidence
//   order-update.actions.ts  — confirmDelivery, cancelOrder, markDispatched
//   order-query.actions.ts   — fetchOrderDetail, getOrderTimeline

export { createOrder, uploadOrderEvidence } from "./order-create.actions";

export {
  confirmDelivery,
  cancelOrder,
  markDispatched,
} from "./order-update.actions";

export {
  fetchOrderDetail,
  getOrderTimeline,
  type OrderDetailData,
  type TimelineEventData,
} from "./order-query.actions";
