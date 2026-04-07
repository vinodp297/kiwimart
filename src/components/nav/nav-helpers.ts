// src/components/nav/nav-helpers.ts
// ─── Shared helpers for notification display ─────────────────────────────────

const NOTIF_ICONS: Record<string, string> = {
  ORDER_PLACED: "\uD83D\uDECD\uFE0F",
  ORDER_DISPATCHED: "\uD83D\uDCE6",
  ORDER_COMPLETED: "\u2705",
  ORDER_DISPUTED: "\u26A0\uFE0F",
  MESSAGE_RECEIVED: "\uD83D\uDCAC",
  OFFER_RECEIVED: "\uD83D\uDCB0",
  OFFER_ACCEPTED: "\uD83C\uDF89",
  OFFER_DECLINED: "\u274C",
  PRICE_DROP: "\uD83D\uDCC9",
  WATCHLIST_SOLD: "\uD83D\uDD14",
  ID_VERIFIED: "\u2705",
  SYSTEM: "\u2139\uFE0F",
};

const GREEN_TYPES = new Set([
  "ORDER_COMPLETED",
  "OFFER_ACCEPTED",
  "ID_VERIFIED",
  "ORDER_DISPATCHED",
]);
const AMBER_TYPES = new Set([
  "ORDER_DISPUTED",
  "OFFER_DECLINED",
  "PRICE_DROP",
  "WATCHLIST_SOLD",
]);

export function getNotifIcon(type: string): string {
  return NOTIF_ICONS[type] ?? "\uD83D\uDD14";
}

export function getNotifIconBg(type: string): string {
  if (GREEN_TYPES.has(type)) return "bg-emerald-50 ring-1 ring-emerald-100";
  if (AMBER_TYPES.has(type)) return "bg-amber-50 ring-1 ring-amber-100";
  return "bg-[#F5ECD4]/60 ring-1 ring-[#F0EDE8]";
}

export function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-NZ");
}
