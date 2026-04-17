// src/test/admin-config.actions.test.ts
// ─── Tests: Admin Platform Config Server Actions ────────────────────────────
// Covers getAllConfigs (list + group) and updateConfig (validation + audit).

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requirePermission ───────────────────────────────────────────────────
const mockRequirePermission = vi.fn();
vi.mock("@/shared/auth/requirePermission", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));

// ── Mock admin-config repository ─────────────────────────────────────────────
const mockFindAll = vi.fn();
const mockFindByKey = vi.fn();
const mockUpdateValue = vi.fn();
vi.mock("@/modules/admin/admin-config.repository", () => ({
  adminConfigRepository: {
    findAll: (...args: unknown[]) => mockFindAll(...args),
    findByKey: (...args: unknown[]) => mockFindByKey(...args),
    updateValue: (...args: unknown[]) => mockUpdateValue(...args),
  },
}));

// ── Mock platform-config invalidateConfig ────────────────────────────────────
const mockInvalidateConfig = vi.fn();
vi.mock("@/lib/platform-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform-config")>();
  return {
    ...actual,
    invalidateConfig: (...args: unknown[]) => mockInvalidateConfig(...args),
  };
});

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { getAllConfigs, updateConfig } =
  await import("@/server/actions/admin-config");
const { audit } = await import("@/server/lib/audit");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const ADMIN = {
  id: "admin_1",
  email: "admin@test.com",
  displayName: "Admin",
  isAdmin: true,
  adminRole: "SUPER_ADMIN",
};

function makeConfigRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "cfg_1",
    key: "financial.fee.pct",
    value: "5",
    type: "INTEGER",
    category: "FINANCIAL",
    label: "Platform Fee %",
    description: "Percent fee charged on sales",
    unit: "%",
    minValue: "0",
    maxValue: "30",
    updatedById: "admin_1",
    updatedAt: new Date("2026-04-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updater: { displayName: "Admin" },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getAllConfigs
// ─────────────────────────────────────────────────────────────────────────────

describe("getAllConfigs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue(ADMIN);
    mockFindAll.mockResolvedValue([makeConfigRecord()]);
  });

  it("non-admin / permission denied → returns safe error", async () => {
    mockRequirePermission.mockRejectedValueOnce(
      new Error("Admin access required."),
    );

    const result = await getAllConfigs();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/admin/i);
    }
    expect(mockFindAll).not.toHaveBeenCalled();
  });

  it("happy path → returns records grouped by category", async () => {
    mockFindAll.mockResolvedValueOnce([
      makeConfigRecord({ id: "cfg_1", category: "FINANCIAL", key: "a" }),
      makeConfigRecord({ id: "cfg_2", category: "FINANCIAL", key: "b" }),
      makeConfigRecord({ id: "cfg_3", category: "TIME", key: "c" }),
    ]);

    const result = await getAllConfigs();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).toEqual(
        expect.arrayContaining(["FINANCIAL", "TIME"]),
      );
      expect(result.data.FINANCIAL?.length).toBe(2);
      expect(result.data.TIME?.length).toBe(1);
    }
  });

  it("maps dates to ISO strings and surfaces updater name", async () => {
    const result = await getAllConfigs();

    expect(result.success).toBe(true);
    if (result.success) {
      const record = result.data.FINANCIAL?.[0];
      expect(record?.updatedAt).toBe("2026-04-01T00:00:00.000Z");
      expect(record?.createdAt).toBe("2026-01-01T00:00:00.000Z");
      expect(record?.updaterName).toBe("Admin");
    }
  });

  it("null updater → updaterName is null", async () => {
    mockFindAll.mockResolvedValueOnce([makeConfigRecord({ updater: null })]);

    const result = await getAllConfigs();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.FINANCIAL?.[0]?.updaterName).toBeNull();
    }
  });

  it("repository throws → returns safe error with fallback message", async () => {
    mockFindAll.mockRejectedValueOnce(new Error("DB down"));

    const result = await getAllConfigs();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });

  it("empty config list → returns empty grouped object", async () => {
    mockFindAll.mockResolvedValueOnce([]);

    const result = await getAllConfigs();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateConfig
// ─────────────────────────────────────────────────────────────────────────────

describe("updateConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue(ADMIN);
    mockFindByKey.mockResolvedValue(makeConfigRecord());
    mockUpdateValue.mockResolvedValue(undefined);
  });

  it("permission denied → returns safe error", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("Not permitted."));

    const result = await updateConfig("financial.fee.pct", "10");

    expect(result.success).toBe(false);
    expect(mockUpdateValue).not.toHaveBeenCalled();
  });

  it("unknown key → returns Config key not found error", async () => {
    mockFindByKey.mockResolvedValueOnce(null);

    const result = await updateConfig("nope", "10");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not found/i);
    }
  });

  it("INTEGER: non-integer string → rejected", async () => {
    mockFindByKey.mockResolvedValueOnce(
      makeConfigRecord({ type: "INTEGER", minValue: null, maxValue: null }),
    );

    const result = await updateConfig("financial.fee.pct", "abc");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/whole number/i);
    }
  });

  it("INTEGER: below minValue → rejected with min message", async () => {
    mockFindByKey.mockResolvedValueOnce(
      makeConfigRecord({ type: "INTEGER", minValue: "5", maxValue: "30" }),
    );

    const result = await updateConfig("financial.fee.pct", "1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/at least 5/i);
    }
  });

  it("INTEGER: above maxValue → rejected with max message", async () => {
    mockFindByKey.mockResolvedValueOnce(
      makeConfigRecord({ type: "INTEGER", minValue: "0", maxValue: "30" }),
    );

    const result = await updateConfig("financial.fee.pct", "100");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/at most 30/i);
    }
  });

  it("DECIMAL: NaN → rejected", async () => {
    mockFindByKey.mockResolvedValueOnce(
      makeConfigRecord({ type: "DECIMAL", minValue: null, maxValue: null }),
    );

    const result = await updateConfig("x", "not-a-number");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/number/i);
    }
  });

  it("DECIMAL: within range → accepted", async () => {
    mockFindByKey.mockResolvedValueOnce(
      makeConfigRecord({ type: "DECIMAL", minValue: "0", maxValue: "10" }),
    );

    const result = await updateConfig("x", "3.14");

    expect(result.success).toBe(true);
  });

  it("BOOLEAN: non-true/false string → rejected", async () => {
    mockFindByKey.mockResolvedValueOnce(
      makeConfigRecord({ type: "BOOLEAN", minValue: null, maxValue: null }),
    );

    const result = await updateConfig("flag", "maybe");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/true.*false/i);
    }
  });

  it("BOOLEAN: 'true' → accepted", async () => {
    mockFindByKey.mockResolvedValueOnce(
      makeConfigRecord({ type: "BOOLEAN", minValue: null, maxValue: null }),
    );

    const result = await updateConfig("flag", "true");

    expect(result.success).toBe(true);
  });

  it("STRING: empty → rejected", async () => {
    mockFindByKey.mockResolvedValueOnce(
      makeConfigRecord({ type: "STRING", minValue: null, maxValue: null }),
    );

    const result = await updateConfig("label", "   ");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/empty/i);
    }
  });

  it("JSON: invalid JSON → rejected", async () => {
    mockFindByKey.mockResolvedValueOnce(
      makeConfigRecord({ type: "JSON", minValue: null, maxValue: null }),
    );

    const result = await updateConfig("cfg", "{not json");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/valid json/i);
    }
  });

  it("JSON: valid → accepted", async () => {
    mockFindByKey.mockResolvedValueOnce(
      makeConfigRecord({ type: "JSON", minValue: null, maxValue: null }),
    );

    const result = await updateConfig("cfg", '{"a":1}');

    expect(result.success).toBe(true);
  });

  it("happy path → invalidates cache, writes audit log, updates DB", async () => {
    const result = await updateConfig("financial.fee.pct", "7");

    expect(result.success).toBe(true);
    expect(mockUpdateValue).toHaveBeenCalledWith(
      "financial.fee.pct",
      "7",
      ADMIN.id,
    );
    expect(mockInvalidateConfig).toHaveBeenCalledWith("financial.fee.pct");
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ADMIN.id,
        action: "PLATFORM_CONFIG_UPDATED",
        entityType: "PlatformConfig",
        entityId: "cfg_1",
        metadata: expect.objectContaining({
          key: "financial.fee.pct",
          oldValue: "5",
          newValue: "7",
        }),
      }),
    );
  });

  it("trims whitespace before validating and persisting", async () => {
    await updateConfig("financial.fee.pct", "  12  ");

    expect(mockUpdateValue).toHaveBeenCalledWith(
      "financial.fee.pct",
      "12",
      ADMIN.id,
    );
  });

  it("repository update throws → returns safe error (no leak)", async () => {
    mockUpdateValue.mockRejectedValueOnce(new Error("Prisma exploded"));

    const result = await updateConfig("financial.fee.pct", "9");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });
});
