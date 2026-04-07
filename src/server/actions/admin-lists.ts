"use server";

import { requirePermission } from "@/shared/auth/requirePermission";
import db from "@/lib/db";
import { audit } from "@/server/lib/audit";
import { invalidateList } from "@/lib/dynamic-lists";
import { safeActionError } from "@/shared/errors";
import type { DynamicListType } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { ActionResult } from "@/types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ListItemRecord {
  id: string;
  listType: string;
  value: string;
  label: string | null;
  description: string | null;
  metadata: unknown;
  sortOrder: number;
  isActive: boolean;
  updatedById: string | null;
  updaterName: string | null;
  updatedAt: string;
}

// ── Read ────────────────────────────────────────────────────────────────────

export async function getListItems(
  listType: DynamicListType,
): Promise<ActionResult<ListItemRecord[]>> {
  try {
    await requirePermission("VIEW_DYNAMIC_LISTS");

    const items = await db.dynamicListItem.findMany({
      where: { listType },
      orderBy: { sortOrder: "asc" },
      include: {
        updater: { select: { displayName: true } },
      },
    });

    const records: ListItemRecord[] = items.map((i) => ({
      id: i.id,
      listType: i.listType,
      value: i.value,
      label: i.label,
      description: i.description,
      metadata: i.metadata,
      sortOrder: i.sortOrder,
      isActive: i.isActive,
      updatedById: i.updatedById,
      updaterName: i.updater?.displayName ?? null,
      updatedAt: i.updatedAt.toISOString(),
    }));

    return { success: true, data: records };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Failed to load list items."),
    };
  }
}

/** Returns all list types with item counts for the admin sidebar */
export async function getListTypeCounts(): Promise<
  ActionResult<Record<string, number>>
> {
  try {
    await requirePermission("VIEW_DYNAMIC_LISTS");

    const counts = await db.dynamicListItem.groupBy({
      by: ["listType"],
      _count: { id: true },
    });

    const result: Record<string, number> = {};
    for (const row of counts) {
      result[row.listType] = row._count.id;
    }

    return { success: true, data: result };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Failed to load list counts."),
    };
  }
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createListItem(params: {
  listType: DynamicListType;
  value: string;
  label?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const admin = await requirePermission("MANAGE_DYNAMIC_LISTS");
    const { listType, value, label, description, metadata } = params;

    if (!value.trim()) {
      return { success: false, error: "Value is required." };
    }

    // Get highest sort order for this list type
    const maxSort = await db.dynamicListItem.findFirst({
      where: { listType },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const item = await db.dynamicListItem.create({
      data: {
        listType,
        value: value.trim(),
        label: label?.trim() || null,
        description: description?.trim() || null,
        metadata:
          metadata !== undefined && metadata !== null
            ? (metadata as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        sortOrder: (maxSort?.sortOrder ?? -1) + 1,
        updatedById: admin.id,
      },
    });

    invalidateList(listType);

    audit({
      userId: admin.id,
      action: "DYNAMIC_LIST_ITEM_CREATED",
      entityType: "DynamicListItem",
      entityId: item.id,
      metadata: { listType, value: value.trim() },
    });

    return { success: true, data: { id: item.id } };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Failed to create list item."),
    };
  }
}

// ── Update ──────────────────────────────────────────────────────────────────

export async function updateListItem(params: {
  id: string;
  value?: string;
  label?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  isActive?: boolean;
}): Promise<ActionResult<void>> {
  try {
    const admin = await requirePermission("MANAGE_DYNAMIC_LISTS");
    const { id, value, label, description, metadata, isActive } = params;

    const existing = await db.dynamicListItem.findUnique({
      where: { id },
      select: { listType: true, value: true },
    });
    if (!existing) return { success: false, error: "Item not found." };

    const data: Record<string, unknown> = { updatedById: admin.id };
    if (value !== undefined) data.value = value.trim();
    if (label !== undefined) data.label = label?.trim() || null;
    if (description !== undefined)
      data.description = description?.trim() || null;
    if (metadata !== undefined)
      data.metadata =
        metadata === null
          ? Prisma.JsonNull
          : (metadata as Prisma.InputJsonValue);
    if (isActive !== undefined) data.isActive = isActive;

    await db.dynamicListItem.update({ where: { id }, data });

    invalidateList(existing.listType);

    audit({
      userId: admin.id,
      action: "DYNAMIC_LIST_ITEM_UPDATED",
      entityType: "DynamicListItem",
      entityId: id,
      metadata: { listType: existing.listType, changes: data },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Failed to update list item."),
    };
  }
}

// ── Delete ──────────────────────────────────────────────────────────────────

export async function deleteListItem(id: string): Promise<ActionResult<void>> {
  try {
    const admin = await requirePermission("MANAGE_DYNAMIC_LISTS");

    const existing = await db.dynamicListItem.findUnique({
      where: { id },
      select: { listType: true, value: true },
    });
    if (!existing) return { success: false, error: "Item not found." };

    await db.dynamicListItem.delete({ where: { id } });

    invalidateList(existing.listType);

    audit({
      userId: admin.id,
      action: "DYNAMIC_LIST_ITEM_DELETED",
      entityType: "DynamicListItem",
      entityId: id,
      metadata: {
        listType: existing.listType,
        deletedValue: existing.value,
      },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Failed to delete list item."),
    };
  }
}

// ── Reorder ─────────────────────────────────────────────────────────────────

export async function reorderListItems(params: {
  listType: DynamicListType;
  orderedIds: string[];
}): Promise<ActionResult<void>> {
  try {
    const admin = await requirePermission("MANAGE_DYNAMIC_LISTS");
    const { listType, orderedIds } = params;

    await db.$transaction(
      orderedIds.map((id, index) =>
        db.dynamicListItem.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );

    invalidateList(listType);

    audit({
      userId: admin.id,
      action: "DYNAMIC_LIST_REORDERED",
      entityType: "DynamicListItem",
      entityId: listType,
      metadata: { listType, newOrder: orderedIds },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Failed to reorder list items."),
    };
  }
}
