"use server";

import { requirePermission } from "@/shared/auth/requirePermission";
import db from "@/lib/db";
import { audit } from "@/server/lib/audit";
import { getClientIp } from "@/server/lib/rateLimit";
import { headers } from "next/headers";
import { invalidateConfig } from "@/lib/platform-config";
import type { ConfigKey } from "@/lib/platform-config";
import type { ActionResult } from "@/types";
import type { ConfigCategory, ConfigValueType } from "@prisma/client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ConfigRecord {
  id: string;
  key: string;
  value: string;
  type: ConfigValueType;
  category: ConfigCategory;
  label: string;
  description: string;
  unit: string | null;
  minValue: string | null;
  maxValue: string | null;
  updatedById: string | null;
  updatedAt: string; // ISO string
  createdAt: string; // ISO string
  updaterName: string | null;
}

// ── getAllConfigs ─────────────────────────────────────────────────────────────

export async function getAllConfigs(): Promise<
  ActionResult<Record<string, ConfigRecord[]>>
> {
  try {
    await requirePermission("VIEW_PLATFORM_CONFIG");

    const records = await db.platformConfig.findMany({
      orderBy: [{ category: "asc" }, { key: "asc" }],
      include: {
        updater: { select: { displayName: true } },
      },
    });

    const grouped: Record<string, ConfigRecord[]> = {};
    for (const r of records) {
      const category = r.category;
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push({
        id: r.id,
        key: r.key,
        value: r.value,
        type: r.type,
        category: r.category,
        label: r.label,
        description: r.description,
        unit: r.unit,
        minValue: r.minValue,
        maxValue: r.maxValue,
        updatedById: r.updatedById,
        updatedAt: r.updatedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        updaterName: r.updater?.displayName ?? null,
      });
    }

    return { success: true, data: grouped };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load configs",
    };
  }
}

// ── updateConfig ─────────────────────────────────────────────────────────────

export async function updateConfig(
  key: string,
  newValue: string,
): Promise<ActionResult<void>> {
  try {
    const admin = await requirePermission("MANAGE_PLATFORM_CONFIG");
    const ip = getClientIp(await headers());

    // Fetch current record
    const existing = await db.platformConfig.findUnique({
      where: { key },
    });

    if (!existing) {
      return { success: false, error: `Config key not found: ${key}` };
    }

    // Validate value against type
    const trimmed = newValue.trim();

    switch (existing.type) {
      case "INTEGER": {
        const n = parseInt(trimmed, 10);
        if (isNaN(n) || String(n) !== trimmed) {
          return { success: false, error: "Value must be a whole number." };
        }
        if (existing.minValue !== null && n < parseInt(existing.minValue, 10)) {
          return {
            success: false,
            error: `Value must be at least ${existing.minValue}.`,
          };
        }
        if (existing.maxValue !== null && n > parseInt(existing.maxValue, 10)) {
          return {
            success: false,
            error: `Value must be at most ${existing.maxValue}.`,
          };
        }
        break;
      }
      case "DECIMAL": {
        const n = parseFloat(trimmed);
        if (isNaN(n)) {
          return { success: false, error: "Value must be a number." };
        }
        if (existing.minValue !== null && n < parseFloat(existing.minValue)) {
          return {
            success: false,
            error: `Value must be at least ${existing.minValue}.`,
          };
        }
        if (existing.maxValue !== null && n > parseFloat(existing.maxValue)) {
          return {
            success: false,
            error: `Value must be at most ${existing.maxValue}.`,
          };
        }
        break;
      }
      case "BOOLEAN": {
        if (trimmed !== "true" && trimmed !== "false") {
          return {
            success: false,
            error: 'Value must be "true" or "false".',
          };
        }
        break;
      }
      case "STRING": {
        if (trimmed.length === 0) {
          return { success: false, error: "Value must not be empty." };
        }
        break;
      }
      case "JSON": {
        try {
          JSON.parse(trimmed);
        } catch {
          return { success: false, error: "Value must be valid JSON." };
        }
        break;
      }
    }

    const oldValue = existing.value;

    // Update DB
    await db.platformConfig.update({
      where: { key },
      data: {
        value: trimmed,
        updatedById: admin.id,
      },
    });

    // Invalidate cache immediately on this instance
    invalidateConfig(key as ConfigKey);

    // Audit log
    audit({
      userId: admin.id,
      action: "PLATFORM_CONFIG_UPDATED",
      entityType: "PlatformConfig",
      entityId: existing.id,
      metadata: { key, oldValue, newValue: trimmed, label: existing.label },
      ip,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update config",
    };
  }
}
