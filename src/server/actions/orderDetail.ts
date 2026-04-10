"use server";
// src/server/actions/orderDetail.ts
// ─── Re-export shim → order-query.actions.ts ─────────────────────────────────
// Logic lives in order-query.actions.ts; this file keeps old import paths valid.

export { fetchOrderDetail, type OrderDetailData } from "./order-query.actions";
