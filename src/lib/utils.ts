import type { Condition } from "@/types";
import { formatNzd } from "@/lib/currency";

/** Format price in NZD. Input is in cents. Returns "$50.00" format. */
export function formatPrice(cents: number): string {
  return formatNzd(cents);
}

/** Human-readable condition label */
export const CONDITION_LABELS: Record<Condition, string> = {
  new: "Brand New",
  "like-new": "Like New",
  good: "Good",
  fair: "Fair",
  parts: "Parts Only",
};

/**
 * Normalise and format a listing condition value for UI display.
 * Accepts any of the variants we encounter at runtime:
 *  - Prisma enum values: "NEW", "LIKE_NEW", "GOOD", "FAIR", "PARTS"
 *  - Legacy kebab form:  "new", "like-new", "good", "fair", "parts"
 *  - Snake_case:         "like_new", "poor" (seed/legacy data)
 * Returns the pretty label; unknown values are title-cased as a safe fallback.
 */
export function formatCondition(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = value.toLowerCase().replace(/_/g, "-");
  const label = CONDITION_LABELS[normalized as Condition];
  if (label) return label;
  // Fallback: Title Case with spaces so enum leaks are at least presentable
  return value
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Condition badge colour classes (Tailwind) */
export const CONDITION_COLOURS: Record<Condition, string> = {
  new: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "like-new": "bg-sky-50 text-sky-700 ring-sky-200",
  good: "bg-amber-50 text-amber-700 ring-amber-200",
  fair: "bg-orange-50 text-orange-700 ring-orange-200",
  parts: "bg-red-50 text-red-600 ring-red-200",
};

/** Relative time string */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "short",
  });
}

/** Star rating string → filled + empty stars */
export function ratingStars(rating: number): { full: number; empty: number } {
  const full = Math.round(rating);
  return { full, empty: 5 - full };
}
