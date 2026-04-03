import "server-only";
// src/lib/platform-config/config.service.ts
// ─── Platform Config Service (Cached) ───────────────────────────────────────
// Reads business rule values from the PlatformConfig table with a 5-minute
// in-memory cache. Each serverless instance has its own cache — the TTL
// ensures values converge within 5 minutes of an admin change.

import db from "@/lib/db";
import type { ConfigKey } from "./config-keys";

// ── Cache ────────────────────────────────────────────────────────────────────

export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map<string, { value: string; expiresAt: number }>();

// ── Raw reader (cache-first, DB fallback) ────────────────────────────────────

async function getRaw(key: ConfigKey): Promise<string> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const config = await db.platformConfig.findUnique({
    where: { key },
    select: { value: true },
  });

  if (!config) {
    throw new Error(
      `PlatformConfig key not found: ${key}. Run seedPlatformConfig() to initialise.`,
    );
  }

  cache.set(key, { value: config.value, expiresAt: now + CACHE_TTL_MS });
  return config.value;
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
    for (const row of rows) {
      cache.set(row.key, { value: row.value, expiresAt: now + CACHE_TTL_MS });
      result.set(row.key as ConfigKey, row.value);
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
