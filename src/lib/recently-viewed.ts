// src/lib/recently-viewed.ts
// ─── Recently Viewed Listings — localStorage tracker ─────────────────────────
// Client-only. Max 20 items, newest first, no duplicates.

const STORAGE_KEY = "kiwi_recently_viewed";
const MAX_ITEMS = 20;

export interface RecentlyViewedItem {
  id: string;
  title: string;
  price: number; // NZD dollars
  thumbnailUrl: string;
  condition: string;
  viewedAt: number; // timestamp
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function getRecentlyViewed(): RecentlyViewedItem[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const items: RecentlyViewedItem[] = JSON.parse(raw);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export function recordView(item: Omit<RecentlyViewedItem, "viewedAt">): void {
  if (!isBrowser()) return;
  try {
    const existing = getRecentlyViewed();
    // Remove duplicate
    const filtered = existing.filter((i) => i.id !== item.id);
    // Prepend new item
    filtered.unshift({ ...item, viewedAt: Date.now() });
    // Trim to max
    const trimmed = filtered.slice(0, MAX_ITEMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Silently fail (quota exceeded, etc.)
  }
}

export function clearRecentlyViewed(): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silently fail
  }
}
