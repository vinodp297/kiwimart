import "server-only";
// src/lib/platform-config/config.service.ts
// ─── Platform Config Service (Cached) ───────────────────────────────────────
// Reads business rule values from the PlatformConfig table with a 5-minute
// in-memory cache. Each serverless instance has its own cache — the TTL
// ensures values converge within 5 minutes of an admin change.

import db from "@/lib/db";
import { logger } from "@/shared/logger";
import type { ConfigKey } from "./config-keys";
import { CONFIG_DEFAULTS } from "./config-defaults";
import { MS_PER_MINUTE } from "@/lib/time";

// ── Cache ────────────────────────────────────────────────────────────────────

export const CACHE_TTL_MS = 5 * MS_PER_MINUTE;

const cache = new Map<string, { value: string; expiresAt: number }>();
const warnedMissing = new Set<string>();

// ── Raw reader (cache-first, DB fallback, static default as last resort) ────

async function getRaw(key: ConfigKey): Promise<string> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const config = await db.platformConfig.findUnique({
    where: { key },
    select: { value: true },
  });

  if (config) {
    cache.set(key, { value: config.value, expiresAt: now + CACHE_TTL_MS });
    return config.value;
  }

  // DB row missing — fall back to the hardcoded default so pages don't crash.
  // This path indicates PlatformConfig was not seeded; admins should run
  // seedPlatformConfig() to make these values editable at runtime.
  const fallback = CONFIG_DEFAULTS[key];
  if (fallback !== undefined) {
    if (!warnedMissing.has(key)) {
      warnedMissing.add(key);
      logger.warn("platform_config.missing_key_using_default", {
        key,
        fallback,
      });
    }
    // Use a short TTL so an admin-run seed is picked up within a minute.
    cache.set(key, { value: fallback, expiresAt: now + 60_000 });
    return fallback;
  }

  throw new Error(
    `PlatformConfig key not found: ${key}. Run seedPlatformConfig() to initialise.`,
  );
}

// ── Typed getters ────────────────────────────────────────────────────────────

export async function getConfigInt(key: ConfigKey): Promise<number> {
  const raw = await getRaw(key);
  const n = parseInt(raw, 10);
  if (isNaN(n)) {
    throw new Error(`PlatformConfig ${key} is not an integer: "${raw}"`);
  }
  return n;
}

export async function getConfigFloat(key: ConfigKey): Promise<number> {
  const raw = await getRaw(key);
  const n = parseFloat(raw);
  if (isNaN(n)) {
    throw new Error(`PlatformConfig ${key} is not a float: "${raw}"`);
  }
  return n;
}

export async function getConfigBool(key: ConfigKey): Promise<boolean> {
  const raw = await getRaw(key);
  if (raw !== "true" && raw !== "false") {
    throw new Error(`PlatformConfig ${key} is not a boolean: "${raw}"`);
  }
  return raw === "true";
}

export async function getConfigString(key: ConfigKey): Promise<string> {
  return getRaw(key);
}

export async function getConfigJson<T>(key: ConfigKey): Promise<T> {
  const raw = await getRaw(key);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`PlatformConfig ${key} is not valid JSON: "${raw}"`);
  }
}

// ── Batch reader ─────────────────────────────────────────────────────────────
// Fetches multiple keys in one DB query — use this in services that need
// several values to avoid sequential DB hits.

export async function getConfigMany(
  keys: ConfigKey[],
): Promise<Map<ConfigKey, string>> {
  const now = Date.now();
  const missing: ConfigKey[] = [];
  const result = new Map<ConfigKey, string>();

  for (const key of keys) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
      result.set(key, cached.value);
    } else {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    const rows = await db.platformConfig.findMany({
      where: { key: { in: missing } },
      select: { key: true, value: true },
    });
    const foundKeys = new Set<string>();
    for (const row of rows) {
      cache.set(row.key, { value: row.value, expiresAt: now + CACHE_TTL_MS });
      result.set(row.key as ConfigKey, row.value);
      foundKeys.add(row.key);
    }
    // Fallback to static defaults for any keys that are still missing from
    // the DB so callers never get a partial map.
    for (const key of missing) {
      if (foundKeys.has(key)) continue;
      const fallback = CONFIG_DEFAULTS[key];
      if (fallback === undefined) continue;
      if (!warnedMissing.has(key)) {
        warnedMissing.add(key);
        logger.warn("platform_config.missing_key_using_default", {
          key,
          fallback,
        });
      }
      cache.set(key, { value: fallback, expiresAt: now + 60_000 });
      result.set(key, fallback);
    }
  }

  return result;
}

// ── Cache invalidation ──────────────────────────────────────────────────────

export function invalidateConfig(key: ConfigKey): void {
  cache.delete(key);
}

export function invalidateAllConfig(): void {
  cache.clear();
}
