// src/lib/dynamic-lists/dynamic-list.service.ts
// ─── Dynamic List Service (Cached) ─────────────────────────────────────────
// Reads admin-editable content lists from the DynamicListItem table with a
// 5-minute in-memory cache. Same pattern as config.service.ts.

import db from "@/lib/db";
import type { DynamicListType } from "@prisma/client";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DynamicListItem {
  value: string;
  label: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  sortOrder: number;
}

export interface DynamicListOption {
  value: string;
  label: string;
}

// ── Cache ───────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map<
  string,
  { items: DynamicListItem[]; expiresAt: number }
>();

// ── Core reader ─────────────────────────────────────────────────────────────

export async function getList(
  listType: DynamicListType,
): Promise<DynamicListItem[]> {
  const now = Date.now();
  const cached = cache.get(listType);
  if (cached && cached.expiresAt > now) return cached.items;

  const rows = await db.dynamicListItem.findMany({
    where: { listType, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      value: true,
      label: true,
      description: true,
      metadata: true,
      sortOrder: true,
    },
  });

  const items: DynamicListItem[] = rows.map((r) => ({
    value: r.value,
    label: r.label,
    description: r.description,
    metadata: r.metadata as Record<string, unknown> | null,
    sortOrder: r.sortOrder,
  }));

  cache.set(listType, { items, expiresAt: now + CACHE_TTL_MS });
  return items;
}

// ── Convenience getters ─────────────────────────────────────────────────────

/** Returns just the values as a string array */
export async function getListValues(
  listType: DynamicListType,
): Promise<string[]> {
  const items = await getList(listType);
  return items.map((i) => i.value);
}

/** Returns { value, label } pairs suitable for <select> options */
export async function getListAsOptions(
  listType: DynamicListType,
): Promise<DynamicListOption[]> {
  const items = await getList(listType);
  return items.map((i) => ({
    value: i.value,
    label: i.label ?? i.value,
  }));
}

/** Returns banned + risk keyword arrays for listing auto-review */
export async function getKeywordLists(): Promise<{
  banned: string[];
  risk: string[];
}> {
  const [banned, risk] = await Promise.all([
    getListValues("BANNED_KEYWORDS"),
    getListValues("RISK_KEYWORDS"),
  ]);
  return { banned, risk };
}

/** Returns NZ regions with lat/lng metadata for geocoding */
export async function getRegionsWithCoords(): Promise<
  { value: string; label: string; lat: number; lng: number }[]
> {
  const items = await getList("NZ_REGIONS");
  return items.map((i) => ({
    value: i.value,
    label: i.label ?? i.value,
    lat: (i.metadata as { lat?: number } | null)?.lat ?? 0,
    lng: (i.metadata as { lng?: number } | null)?.lng ?? 0,
  }));
}

// ── Cache invalidation ──────────────────────────────────────────────────────

export function invalidateList(listType: DynamicListType): void {
  cache.delete(listType);
}

export function invalidateAllLists(): void {
  cache.clear();
}
