// src/app/api/admin/platform-fees/route.ts
// ─── Admin Platform Fee Config API ───────────────────────────────────────────
// GET  /api/admin/platform-fees
//   Returns all 7 fee config keys + live fee previews for Standard/Silver/Gold
//   Requires MANAGE_PLATFORM_CONFIG permission.
//
// PATCH /api/admin/platform-fees
//   Body: { key: string, value: string }
//   Updates a single fee config key. Rate limited 20/hour.
//   Requires MANAGE_PLATFORM_CONFIG permission.

import { z } from "zod";
import { requirePermission } from "@/shared/auth/requirePermission";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";
import { adminConfigRepository } from "@/modules/admin/admin-config.repository";
import { audit } from "@/server/lib/audit";
import { getClientIp, rateLimit } from "@/server/lib/rateLimit";
import { invalidateConfig, CONFIG_KEYS } from "@/lib/platform-config";
import type { ConfigKey } from "@/lib/platform-config";
import { calculateFees } from "@/modules/payments/fee-calculator";
import { headers } from "next/headers";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

// The 7 fee config keys managed by this endpoint
const FEE_CONFIG_KEYS = new Set<string>([
  CONFIG_KEYS.PLATFORM_FEE_STANDARD_RATE,
  CONFIG_KEYS.PLATFORM_FEE_SILVER_RATE,
  CONFIG_KEYS.PLATFORM_FEE_GOLD_RATE,
  CONFIG_KEYS.PLATFORM_FEE_MINIMUM_CENTS,
  CONFIG_KEYS.PLATFORM_FEE_MAXIMUM_CENTS,
  CONFIG_KEYS.STRIPE_FEE_RATE,
  CONFIG_KEYS.STRIPE_FEE_FIXED_CENTS,
]);

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    await requirePermission("MANAGE_PLATFORM_CONFIG");
  } catch {
    return apiError("Forbidden", 403);
  }

  try {
    const records = await adminConfigRepository.findAll();
    const feeRecords = records.filter((r) => FEE_CONFIG_KEYS.has(r.key));

    // Live fee previews for $100 (10000 cents) at each tier
    const [standard100, silver100, gold100] = await Promise.all([
      calculateFees(10000, null),
      calculateFees(10000, "SILVER"),
      calculateFees(10000, "GOLD"),
    ]);

    return apiOk({
      configs: feeRecords.map((r) => ({
        key: r.key,
        value: r.value,
        type: r.type,
        label: r.label,
        description: r.description,
        unit: r.unit,
        updatedAt: r.updatedAt.toISOString(),
        updaterName: r.updater?.displayName ?? null,
      })),
      previews: {
        standard100,
        silver100,
        gold100,
      },
    });
  } catch (e) {
    logger.error("api.error", {
      path: "GET /api/admin/platform-fees",
      error: e instanceof Error ? e.message : e,
    });
    return apiError("Failed to load fee configs.", 500);
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

const patchSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

export async function PATCH(request: Request) {
  let admin: Awaited<ReturnType<typeof requirePermission>>;
  try {
    admin = await requirePermission("MANAGE_PLATFORM_CONFIG");
  } catch {
    return apiError("Forbidden", 403);
  }

  // Rate limit: 20 config updates per hour per admin
  const hdrs = await headers();
  const ip = getClientIp(hdrs);
  const limited = await rateLimit("adminConfigUpdate", `admin-fee:${admin.id}`);
  if (!limited.success) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Too many requests",
        retryAfter: limited.retryAfter,
      }),
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  let params: z.infer<typeof patchSchema>;
  try {
    params = patchSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return apiError("Validation failed", 400, "VALIDATION_ERROR");
    }
    throw err;
  }

  const { key, value } = params;

  // Only allow updates to the 7 fee config keys
  if (!FEE_CONFIG_KEYS.has(key)) {
    return apiError(
      `Key '${key}' is not a managed fee config key.`,
      400,
      "UNKNOWN_KEY",
    );
  }

  try {
    const existing = await adminConfigRepository.findByKey(key);
    if (!existing) {
      return apiError(`Config key not found: ${key}`, 404);
    }

    const trimmed = value.trim();

    // Type validation
    switch (existing.type) {
      case "INTEGER": {
        const n = parseInt(trimmed, 10);
        if (isNaN(n) || String(n) !== trimmed) {
          return apiError("Value must be a whole number.", 400);
        }
        if (existing.minValue !== null && n < parseInt(existing.minValue, 10)) {
          return apiError(`Value must be at least ${existing.minValue}.`, 400);
        }
        if (existing.maxValue !== null && n > parseInt(existing.maxValue, 10)) {
          return apiError(`Value must be at most ${existing.maxValue}.`, 400);
        }
        break;
      }
      case "DECIMAL": {
        const n = parseFloat(trimmed);
        if (isNaN(n)) {
          return apiError("Value must be a number.", 400);
        }
        if (existing.minValue !== null && n < parseFloat(existing.minValue)) {
          return apiError(`Value must be at least ${existing.minValue}.`, 400);
        }
        if (existing.maxValue !== null && n > parseFloat(existing.maxValue)) {
          return apiError(`Value must be at most ${existing.maxValue}.`, 400);
        }
        break;
      }
    }

    const oldValue = existing.value;
    await adminConfigRepository.updateValue(key, trimmed, admin.id);
    invalidateConfig(key as ConfigKey);

    audit({
      userId: admin.id,
      action: "PLATFORM_CONFIG_UPDATED",
      entityType: "PlatformConfig",
      entityId: existing.id,
      metadata: { key, oldValue, newValue: trimmed, label: existing.label },
      ip,
    });

    return apiOk({ key, value: trimmed });
  } catch (e) {
    logger.error("api.error", {
      path: "PATCH /api/admin/platform-fees",
      error: e instanceof Error ? e.message : e,
    });
    return apiError("Failed to update fee config.", 500);
  }
}
