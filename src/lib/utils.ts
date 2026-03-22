import type { Condition } from '@/types';

/** Format price in NZD */
export function formatPrice(cents: number): string {
  if (cents >= 1_000_000) {
    return `$${(cents / 1_000_000).toFixed(1)}m`;
  }
  if (cents >= 1_000) {
    return `$${cents.toLocaleString('en-NZ')}`;
  }
  return `$${cents}`;
}

/** Human-readable condition label */
export const CONDITION_LABELS: Record<Condition, string> = {
  new: 'Brand New',
  'like-new': 'Like New',
  good: 'Good',
  fair: 'Fair',
  parts: 'Parts Only',
};

/** Condition badge colour classes (Tailwind) */
export const CONDITION_COLOURS: Record<Condition, string> = {
  new: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'like-new': 'bg-sky-50 text-sky-700 ring-sky-200',
  good: 'bg-amber-50 text-amber-700 ring-amber-200',
  fair: 'bg-orange-50 text-orange-700 ring-orange-200',
  parts: 'bg-red-50 text-red-600 ring-red-200',
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
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
}

/** Star rating string → filled + empty stars */
export function ratingStars(rating: number): { full: number; empty: number } {
  const full = Math.round(rating);
  return { full, empty: 5 - full };
}

