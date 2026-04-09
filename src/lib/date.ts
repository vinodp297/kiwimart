// src/lib/date.ts
// ─── NZ locale date/time formatters ──────────────────────────────────────────
// All formatters use Pacific/Auckland timezone and NZ English locale.

import { MS_PER_MINUTE, MS_PER_HOUR, MS_PER_DAY } from "@/lib/time";

const NZ_TZ = "Pacific/Auckland";
const NZ_LOCALE = "en-NZ";

const dateTimeFormatter = new Intl.DateTimeFormat(NZ_LOCALE, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: NZ_TZ,
});

const dateFormatter = new Intl.DateTimeFormat(NZ_LOCALE, {
  dateStyle: "medium",
  timeZone: NZ_TZ,
});

/** e.g. "8 Apr 2026, 9:30 am" in Pacific/Auckland */
export function formatDateTimeNz(date: Date | string | number): string {
  return dateTimeFormatter.format(new Date(date));
}

/** e.g. "8 Apr 2026" in Pacific/Auckland */
export function formatDateNz(date: Date | string | number): string {
  return dateFormatter.format(new Date(date));
}

/**
 * Human-readable relative time.
 * Uses MS_ constants from time.ts for thresholds.
 *   < 60 s  → "just now"
 *   < 1 h   → "Xm ago"
 *   < 1 d   → "Xh ago"
 *   ≥ 1 d   → "Xd ago"
 */
export function relativeTime(date: Date | string | number): string {
  const delta = Date.now() - new Date(date).getTime();
  if (delta < MS_PER_MINUTE) return "just now";
  if (delta < MS_PER_HOUR) return `${Math.floor(delta / MS_PER_MINUTE)}m ago`;
  if (delta < MS_PER_DAY) return `${Math.floor(delta / MS_PER_HOUR)}h ago`;
  return `${Math.floor(delta / MS_PER_DAY)}d ago`;
}
