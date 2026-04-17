// src/test/admin-lists.actions.test.ts
// ─── Tests: Admin Dynamic Lists Server Actions ──────────────────────────────
// Covers read (getListItems, getListTypeCounts), write (create/update/delete),
// and reorder flows — all guarded by admin permissions.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requirePermission ───────────────────────────────────────────────────
const mockRequirePermission = vi.fn();
vi.mock("@/shared/auth/requirePermission", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));

// ── Mock dynamicListRepository ───────────────────────────────────────────────
const mockFindByType = vi.fn();
const mockCountByType = vi.fn();
const mockFindMaxSortOrder = vi.fn();
const mockCreate = vi.fn();
const mockFindById = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockReorderItems = vi.fn();
vi.mock("@/modules/admin/dynamic-list.repository", () => ({
  dynamicListRepository: {
    findByType: (...args: unknown[]) => mockFindByType(...args),
    countByType: (...args: unknown[]) => mockCountByType(...args),
    findMaxSortOrder: (...args: unknown[]) => mockFindMaxSortOrder(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    findById: (...args: unknown[]) => mockFindById(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    reorderItems: (...args: unknown[]) => mockReorderItems(...args),
  },
}));

// ── Mock invalidateList ──────────────────────────────────────────────────────
const mockInvalidateList = vi.fn();
vi.mock("@/lib/dynamic-lists", () => ({
  invalidateList: (...args: unknown[]) => mockInvalidateList(...args),
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const {
  getListItems,
  getListTypeCounts,
  createListItem,
  updateListItem,
  deleteListItem,
  reorderListItems,
} = await import("@/server/actions/admin-lists");
const { audit } = await import("@/server/lib/audit");

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ADMIN = {
  id: "admin_1",
  email: "admin@test.com",
  displayName: "Admin",
  isAdmin: true,
  adminRole: "SUPER_ADMIN",
};

function makeItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "dli_1",
    listType: "REPORT_REASONS",
    value: "SPAM",
    label: "Spam",
    description: "Unsolicited content",
    metadata: null,
    sortOrder: 0,
    isActive: true,
    updatedById: "admin_1",
    updater: { displayName: "Admin" },
    updatedAt: new Date("2026-04-01T00:00:00Z"),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getListItems
// ─────────────────────────────────────────────────────────────────────────────

describe("getListItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue(ADMIN);
    mockFindByType.mockResolvedValue([makeItem()]);
  });

  it("permission denied → returns safe error and does not query", async () => {
    mockRequirePermission.mockRejectedValueOnce(
      new Error("Admin access required."),
    );

    const result = await getListItems("REPORT_REASONS" as never);

    expect(result.success).toBe(false);
    expect(mockFindByType).not.toHaveBeenCalled();
  });

  it("happy path → maps items to ListItemRecord shape", async () => {
    const result = await getListItems("REPORT_REASONS" as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: "dli_1",
        listType: "REPORT_REASONS",
        value: "SPAM",
        updaterName: "Admin",
      });
      expect(result.data[0]?.updatedAt).toBe("2026-04-01T00:00:00.000Z");
    }
  });

  it("null updater → updaterName is null", async () => {
    mockFindByType.mockResolvedValueOnce([makeItem({ updater: null })]);

    const result = await getListItems("REPORT_REASONS" as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]?.updaterName).toBeNull();
    }
  });

  it("empty list → returns empty array", async () => {
    mockFindByType.mockResolvedValueOnce([]);

    const result = await getListItems("REPORT_REASONS" as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it("repository throws → returns safe error", async () => {
    mockFindByType.mockRejectedValueOnce(new Error("DB down"));

    const result = await getListItems("REPORT_REASONS" as never);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getListTypeCounts
// ─────────────────────────────────────────────────────────────────────────────

describe("getListTypeCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue(ADMIN);
  });

  it("permission denied → returns safe error", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("Nope"));

    const result = await getListTypeCounts();

    expect(result.success).toBe(false);
    expect(mockCountByType).not.toHaveBeenCalled();
  });

  it("happy path → returns map of listType → count", async () => {
    mockCountByType.mockResolvedValueOnce([
      { listType: "REPORT_REASONS", _count: { id: 4 } },
      { listType: "PICKUP_LOCATIONS", _count: { id: 2 } },
    ]);

    const result = await getListTypeCounts();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        REPORT_REASONS: 4,
        PICKUP_LOCATIONS: 2,
      });
    }
  });

  it("repository throws → returns safe error", async () => {
    mockCountByType.mockRejectedValueOnce(new Error("DB down"));

    const result = await getListTypeCounts();

    expect(result.success).toBe(false);
  });

  it("no list types present → returns empty object", async () => {
    mockCountByType.mockResolvedValueOnce([]);

    const result = await getListTypeCounts();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createListItem
// ─────────────────────────────────────────────────────────────────────────────

describe("createListItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue(ADMIN);
    mockFindMaxSortOrder.mockResolvedValue({ sortOrder: 2 });
    mockCreate.mockResolvedValue({ id: "new_item_1" });
  });

  it("permission denied → returns safe error", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("Not permitted."));

    const result = await createListItem({
      listType: "REPORT_REASONS" as never,
      value: "SPAM",
    });

    expect(result.success).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("empty value → returns Value is required error", async () => {
    const result = await createListItem({
      listType: "REPORT_REASONS" as never,
      value: "   ",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/required/i);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("happy path → creates item with next sortOrder, invalidates cache, audits", async () => {
    const result = await createListItem({
      listType: "REPORT_REASONS" as never,
      value: "  SPAM  ",
      label: "  Spam  ",
      description: "Unsolicited content",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("new_item_1");
    }
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        listType: "REPORT_REASONS",
        value: "SPAM",
        label: "Spam",
        description: "Unsolicited content",
        sortOrder: 3,
        updatedById: ADMIN.id,
      }),
    );
    expect(mockInvalidateList).toHaveBeenCalledWith("REPORT_REASONS");
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DYNAMIC_LIST_ITEM_CREATED",
        entityId: "new_item_1",
      }),
    );
  });

  it("no existing items → sortOrder starts at 0", async () => {
    mockFindMaxSortOrder.mockResolvedValueOnce(null);

    await createListItem({
      listType: "REPORT_REASONS" as never,
      value: "FIRST",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 0 }),
    );
  });

  it("repository throws → returns safe error", async () => {
    mockCreate.mockRejectedValueOnce(new Error("DB boom"));

    const result = await createListItem({
      listType: "REPORT_REASONS" as never,
      value: "SPAM",
    });

    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateListItem
// ─────────────────────────────────────────────────────────────────────────────

describe("updateListItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue(ADMIN);
    mockFindById.mockResolvedValue({
      listType: "REPORT_REASONS",
      value: "SPAM",
    });
    mockUpdate.mockResolvedValue(undefined);
  });

  it("permission denied → returns safe error", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("Nope"));

    const result = await updateListItem({ id: "dli_1", value: "SCAM" });

    expect(result.success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("item not found → returns Item not found", async () => {
    mockFindById.mockResolvedValueOnce(null);

    const result = await updateListItem({ id: "ghost", value: "x" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not found/i);
    }
  });

  it("happy path → trims, updates, invalidates, audits", async () => {
    const result = await updateListItem({
      id: "dli_1",
      value: "  SCAM  ",
      label: "  Scam  ",
      isActive: false,
    });

    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      "dli_1",
      expect.objectContaining({
        value: "SCAM",
        label: "Scam",
        isActive: false,
        updatedById: ADMIN.id,
      }),
    );
    expect(mockInvalidateList).toHaveBeenCalledWith("REPORT_REASONS");
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DYNAMIC_LIST_ITEM_UPDATED",
        entityId: "dli_1",
      }),
    );
  });

  it("only updates fields that were passed in", async () => {
    await updateListItem({ id: "dli_1", isActive: true });

    const passedData = mockUpdate.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(passedData).toHaveProperty("isActive", true);
    expect(passedData).not.toHaveProperty("value");
    expect(passedData).not.toHaveProperty("label");
  });

  it("repository throws → returns safe error", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("DB down"));

    const result = await updateListItem({ id: "dli_1", value: "SCAM" });

    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteListItem
// ─────────────────────────────────────────────────────────────────────────────

describe("deleteListItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue(ADMIN);
    mockFindById.mockResolvedValue({
      listType: "REPORT_REASONS",
      value: "SPAM",
    });
    mockDelete.mockResolvedValue(undefined);
  });

  it("permission denied → returns safe error", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("Nope"));

    const result = await deleteListItem("dli_1");

    expect(result.success).toBe(false);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("item not found → returns Item not found", async () => {
    mockFindById.mockResolvedValueOnce(null);

    const result = await deleteListItem("ghost");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not found/i);
    }
  });

  it("happy path → deletes, invalidates, audits with deleted value", async () => {
    const result = await deleteListItem("dli_1");

    expect(result.success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith("dli_1");
    expect(mockInvalidateList).toHaveBeenCalledWith("REPORT_REASONS");
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DYNAMIC_LIST_ITEM_DELETED",
        entityId: "dli_1",
        metadata: expect.objectContaining({ deletedValue: "SPAM" }),
      }),
    );
  });

  it("repository throws → returns safe error", async () => {
    mockDelete.mockRejectedValueOnce(new Error("FK violation"));

    const result = await deleteListItem("dli_1");

    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reorderListItems
// ─────────────────────────────────────────────────────────────────────────────

describe("reorderListItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue(ADMIN);
    mockReorderItems.mockResolvedValue(undefined);
  });

  it("permission denied → returns safe error", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("Nope"));

    const result = await reorderListItems({
      listType: "REPORT_REASONS" as never,
      orderedIds: ["a", "b"],
    });

    expect(result.success).toBe(false);
    expect(mockReorderItems).not.toHaveBeenCalled();
  });

  it("happy path → passes ordered IDs, invalidates cache, audits", async () => {
    const result = await reorderListItems({
      listType: "REPORT_REASONS" as never,
      orderedIds: ["b", "a", "c"],
    });

    expect(result.success).toBe(true);
    expect(mockReorderItems).toHaveBeenCalledWith(["b", "a", "c"]);
    expect(mockInvalidateList).toHaveBeenCalledWith("REPORT_REASONS");
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DYNAMIC_LIST_REORDERED",
        metadata: expect.objectContaining({
          listType: "REPORT_REASONS",
          newOrder: ["b", "a", "c"],
        }),
      }),
    );
  });

  it("repository throws → returns safe error", async () => {
    mockReorderItems.mockRejectedValueOnce(new Error("Transaction failed"));

    const result = await reorderListItems({
      listType: "REPORT_REASONS" as never,
      orderedIds: ["a", "b"],
    });

    expect(result.success).toBe(false);
  });

  it("empty orderedIds array is forwarded as-is", async () => {
    await reorderListItems({
      listType: "REPORT_REASONS" as never,
      orderedIds: [],
    });

    expect(mockReorderItems).toHaveBeenCalledWith([]);
  });
});
