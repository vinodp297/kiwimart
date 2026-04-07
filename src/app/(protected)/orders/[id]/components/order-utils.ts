// Shared utility functions and icon components for order detail page
import type { OrderDetailData, TimelineEvent } from "./order-types";

// ── Courier URL detection ────────────────────────────────────────────────────
export function getCourierUrl(trackingNumber: string): string {
  const tn = trackingNumber.toUpperCase().trim();

  // NZ Post international format (2 letters + 9 digits + 2 letters) or NZ prefix
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(tn) || tn.startsWith("NZ")) {
    return `https://www.nzpost.co.nz/tools/tracking?trackid=${encodeURIComponent(tn)}`;
  }
  // CourierPost
  if (tn.startsWith("CP") || tn.startsWith("CPA")) {
    return `https://www.courierpost.co.nz/track/?trackingid=${encodeURIComponent(tn)}`;
  }
  // Aramex (long numeric)
  if (/^\d{10,}$/.test(tn)) {
    return `https://www.aramex.co.nz/tools/track?l=${encodeURIComponent(tn)}`;
  }
  // DHL
  if (tn.startsWith("DHL") || /^\d{10}$/.test(tn)) {
    return `https://www.dhl.com/nz-en/home/tracking/tracking-parcel.html?submit=1&tracking-id=${encodeURIComponent(tn)}`;
  }
  // Default — NZ Post (most common NZ courier)
  return `https://www.nzpost.co.nz/tools/tracking?trackid=${encodeURIComponent(tn)}`;
}

// ── Format a date/time string for timeline display ───────────────────────────
export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleDateString("en-NZ", { month: "short" });
  const year = d.getFullYear();
  const time = d
    .toLocaleTimeString("en-NZ", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
  return `${day} ${month} ${year}, ${time}`;
}

// ── Synthetic events for legacy orders ───────────────────────────────────────
export function buildSyntheticEvents(order: OrderDetailData): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let counter = 0;
  const synId = () => `synthetic-${counter++}`;

  // ORDER_CREATED always exists
  events.push({
    id: synId(),
    type: "ORDER_CREATED",
    actorRole: "BUYER",
    summary: "Order placed",
    metadata: null,
    createdAt: order.createdAt,
    actor: null,
  });

  // PAYMENT_HELD — if order moved past AWAITING_PAYMENT
  const pastPayment = [
    "payment_held",
    "dispatched",
    "delivered",
    "completed",
    "disputed",
    "refunded",
  ].includes(order.status);
  if (pastPayment) {
    events.push({
      id: synId(),
      type: "PAYMENT_HELD",
      actorRole: "SYSTEM",
      summary: "Payment authorized and held in escrow",
      metadata: null,
      createdAt: order.createdAt, // best available timestamp
      actor: null,
    });
  }

  // DISPATCHED
  if (order.dispatchedAt) {
    events.push({
      id: synId(),
      type: "DISPATCHED",
      actorRole: "SELLER",
      summary: order.trackingNumber
        ? `Seller dispatched order — tracking: ${order.trackingNumber}`
        : "Seller dispatched order",
      metadata: order.trackingNumber
        ? {
            trackingNumber: order.trackingNumber,
            trackingUrl: order.trackingUrl,
          }
        : null,
      createdAt: order.dispatchedAt,
      actor: null,
    });
  }

  // Terminal states
  if (order.completedAt && order.status === "completed") {
    events.push({
      id: synId(),
      type: "COMPLETED",
      actorRole: "BUYER",
      summary: "Buyer confirmed delivery — payment released to seller",
      metadata: null,
      createdAt: order.completedAt,
      actor: null,
    });
  }

  if (order.dispute?.openedAt) {
    events.push({
      id: synId(),
      type: "DISPUTE_OPENED",
      actorRole: "BUYER",
      summary: order.dispute?.reason
        ? `Buyer opened dispute: ${order.dispute?.reason.replace(/_/g, " ").toLowerCase()}`
        : "Buyer opened dispute",
      metadata: order.dispute?.reason
        ? { reason: order.dispute?.reason }
        : null,
      createdAt: order.dispute?.openedAt,
      actor: null,
    });
  }

  if (order.cancelledAt) {
    events.push({
      id: synId(),
      type: "CANCELLED",
      actorRole: order.cancelledBy === "SELLER" ? "SELLER" : "BUYER",
      summary: order.cancelReason
        ? `Order cancelled: ${order.cancelReason}`
        : "Order cancelled",
      metadata: order.cancelReason ? { reason: order.cancelReason } : null,
      createdAt: order.cancelledAt,
      actor: null,
    });
  }

  return events;
}
