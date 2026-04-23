// src/lib/dynamic-lists/dynamic-list.service.ts
// ─── Dynamic List Service (Cached) ─────────────────────────────────────────
// Reads admin-editable content lists from the DynamicListItem table with a
// three-tier cache hierarchy:
//   1. In-memory Map (60s TTL) — per-instance, fastest
//   2. Redis (300s TTL) — shared across all serverless instances
//   3. Database — ground truth
//
// This prevents multi-instance cache drift: admin changes propagate to all
// instances via Redis within 5 minutes instead of having different instances
// enforce different lists simultaneously.

import db from "@/lib/db";
import type { DynamicListType } from "@prisma/client";
import { MS_PER_MINUTE } from "@/lib/time";
import { logger } from "@/shared/logger";
import { getRedisClient } from "@/infrastructure/redis/client";

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

const REDIS_TTL_SECONDS = 300; // 5 minutes — shared cache TTL
const LOCAL_CACHE_TTL_MS = 60 * MS_PER_MINUTE; // 60 seconds — in-memory fallback

const localCache = new Map<
  string,
  { items: DynamicListItem[]; expiresAt: number }
>();

// All possible DynamicListType values — used for invalidation when
// KEYS pattern scanning is unavailable (Upstash limitation)
const ALL_LIST_TYPES: DynamicListType[] = [
  "BANNED_KEYWORDS",
  "RISK_KEYWORDS",
  "NZ_REGIONS",
  "COURIERS",
  "DISPUTE_REASONS",
  "LISTING_CONDITIONS",
  "REVIEW_TAGS",
  "REPORT_REASONS",
  "SELLER_RESCHEDULE_REASONS",
  "BUYER_RESCHEDULE_REASONS",
  "PICKUP_REJECT_REASONS",
  "DELIVERY_ISSUE_TYPES",
  "PROBLEM_TYPES",
  "QUICK_FILTER_CHIPS",
];

// ── Core reader ─────────────────────────────────────────────────────────────

export async function getList(
  listType: DynamicListType,
): Promise<DynamicListItem[]> {
  const now = Date.now();

  // ── Tier 1: In-memory local cache ────────────────────────────────────────
  const localCached = localCache.get(listType);
  if (localCached && localCached.expiresAt > now) {
    return localCached.items;
  }

  // ── Tier 2: Redis (shared across serverless instances) ───────────────────
  const redisKey = `dynamic-list:${listType}`;
  let items: DynamicListItem[] | null = null;

  try {
    const redis = await getRedisClient();
    const cached = await redis.get(redisKey);
    if (cached && typeof cached === "string") {
      items = JSON.parse(cached) as DynamicListItem[];
      // Repopulate local cache from Redis hit (60s fallback TTL)
      localCache.set(listType, { items, expiresAt: now + LOCAL_CACHE_TTL_MS });
      return items;
    }
  } catch (error) {
    logger.warn(
      `Redis GET failed for ${redisKey}: ${error instanceof Error ? error.message : String(error)}. Falling back to local cache / DB.`,
    );
  }

  // ── Tier 3: Database (ground truth) ──────────────────────────────────────
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

  items = rows.map((r) => ({
    value: r.value,
    label: r.label,
    description: r.description,
    metadata: r.metadata as Record<string, unknown> | null,
    sortOrder: r.sortOrder,
  }));

  // ── Populate both cache tiers on DB hit ──────────────────────────────────
  localCache.set(listType, { items, expiresAt: now + LOCAL_CACHE_TTL_MS });

  try {
    const redis = await getRedisClient();
    await redis.setex(redisKey, REDIS_TTL_SECONDS, JSON.stringify(items));
  } catch (error) {
    logger.warn(
      `Redis SET failed for ${redisKey}: ${error instanceof Error ? error.message : String(error)}. Local cache will serve fallback.`,
    );
  }

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
  // Clear local cache immediately
  localCache.delete(listType);

  // Clear Redis key asynchronously (don't block on Redis failure)
  const redisKey = `dynamic-list:${listType}`;
  (async () => {
    try {
      const redis = await getRedisClient();
      await redis.del(redisKey);
    } catch (error) {
      logger.warn(
        `Redis DEL failed for ${redisKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  })().catch(() => {
    // Swallow async errors — invalidation is best-effort
  });
}

export function invalidateAllLists(): void {
  // Clear local cache immediately
  localCache.clear();

  // Clear all Redis keys asynchronously
  (async () => {
    try {
      const redis = await getRedisClient();
      // Delete each list type individually (Upstash doesn't support KEYS pattern scanning)
      await Promise.all(
        ALL_LIST_TYPES.map((listType) =>
          redis.del(`dynamic-list:${listType}`).catch((error) => {
            logger.warn(
              `Redis DEL failed for dynamic-list:${listType}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }),
        ),
      );
    } catch (error) {
      logger.warn(
        `Redis connection failed during invalidateAllLists: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  })().catch(() => {
    // Swallow async errors — invalidation is best-effort
  });
}

/** Clears the in-memory local cache — used in tests to force DB/Redis refresh */
export function clearLocalCache(): void {
  localCache.clear();
}
