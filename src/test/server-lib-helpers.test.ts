// src/test/server-lib-helpers.test.ts
// ─── Tests: Small server lib helpers ────────────────────────────────────────
// Covers verifyBearerSecret, verifyCronSecret, requireAdmin, cronLogger,
// recordCronRun — small fail-closed helpers that didn't have dedicated tests.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock env for verifyCronSecret ────────────────────────────────────────────
vi.mock("@/env", () => ({
  env: {
    CRON_SECRET: "test-cron-secret-abc123",
  },
}));

// ── Mock requireAnyAdmin for requireAdmin wrapper ────────────────────────────
const mockRequireAnyAdmin = vi.fn();
vi.mock("@/shared/auth/requirePermission", () => ({
  requireAnyAdmin: (...args: unknown[]) => mockRequireAnyAdmin(...args),
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { verifyBearerSecret } = await import("@/server/lib/verifyBearerSecret");
const { verifyCronSecret } = await import("@/server/lib/verifyCronSecret");
const { requireAdmin } = await import("@/server/lib/requireAdmin");
const { recordCronRun } = await import("@/server/lib/cronLogger");
const { AppError } = await import("@/shared/errors");

// ─────────────────────────────────────────────────────────────────────────────
// verifyBearerSecret
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyBearerSecret", () => {
  it("missing secret env var → returns false (fail closed)", () => {
    expect(verifyBearerSecret("Bearer anything", undefined)).toBe(false);
    expect(verifyBearerSecret("Bearer anything", "")).toBe(false);
  });

  it("null Authorization header → returns false", () => {
    expect(verifyBearerSecret(null, "secret-123")).toBe(false);
  });

  it("mismatched length → returns false (without timing oracle)", () => {
    expect(verifyBearerSecret("Bearer x", "completely-different-secret")).toBe(
      false,
    );
  });

  it("mismatched same-length header → returns false", () => {
    expect(verifyBearerSecret("Bearer abcdef", "zyxwvu")).toBe(false);
  });

  it("correct Bearer <secret> → returns true", () => {
    expect(verifyBearerSecret("Bearer secret-123", "secret-123")).toBe(true);
  });

  it("missing Bearer prefix → returns false", () => {
    expect(verifyBearerSecret("secret-123", "secret-123")).toBe(false);
  });

  it("uses context label when logging missing secret", () => {
    // Just exercise the context branch — the log is mocked globally
    expect(verifyBearerSecret("Bearer x", undefined, "worker")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyCronSecret
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyCronSecret", () => {
  function makeRequest(authHeader: string | null): Request {
    const headers = new Headers();
    if (authHeader) headers.set("authorization", authHeader);
    return new Request("https://test.example/api/cron/x", { headers });
  }

  it("missing Authorization → returns 401 NextResponse", async () => {
    const result = verifyCronSecret(makeRequest(null));

    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
  });

  it("wrong secret → returns 401", () => {
    const result = verifyCronSecret(makeRequest("Bearer wrong-secret"));

    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
  });

  it("correct CRON_SECRET → returns null (pass-through)", () => {
    const result = verifyCronSecret(
      makeRequest("Bearer test-cron-secret-abc123"),
    );

    expect(result).toBeNull();
  });

  it("unauthorized → response body contains Unauthorized", async () => {
    const result = verifyCronSecret(makeRequest("Bearer wrong"));

    expect(result).not.toBeNull();
    const body = await result!.json();
    expect(body.error).toBe("Unauthorized");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireAdmin
// ─────────────────────────────────────────────────────────────────────────────

describe("requireAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("success → returns { userId }", async () => {
    mockRequireAnyAdmin.mockResolvedValueOnce({
      id: "admin_1",
      email: "a@test.com",
    });

    const result = await requireAdmin();

    expect(result).toEqual({ userId: "admin_1" });
  });

  it("AppError thrown → returns { error: message }", async () => {
    mockRequireAnyAdmin.mockRejectedValueOnce(
      new AppError("FORBIDDEN", "Admin access required.", 403),
    );

    const result = await requireAdmin();

    expect(result).toEqual({ error: "Admin access required." });
  });

  it("non-AppError thrown → returns generic error", async () => {
    mockRequireAnyAdmin.mockRejectedValueOnce(new Error("DB outage"));

    const result = await requireAdmin();

    expect(result).toEqual({ error: "An unexpected error occurred." });
  });

  it("result discriminates via 'error' in guard check", async () => {
    mockRequireAnyAdmin.mockResolvedValueOnce({
      id: "admin_2",
      email: "b@test.com",
    });

    const result = await requireAdmin();

    expect("error" in result).toBe(false);
    expect("userId" in result).toBe(true);
  });

  it("rejection returned as discriminated error branch", async () => {
    mockRequireAnyAdmin.mockRejectedValueOnce(
      new AppError("UNAUTHENTICATED", "Not signed in.", 401),
    );

    const result = await requireAdmin();

    expect("error" in result).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recordCronRun
// ─────────────────────────────────────────────────────────────────────────────

describe("recordCronRun", () => {
  const mockCronLogCreate = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCronLogCreate.mockResolvedValue({ id: "cl-1" });
    // Attach cronLog to the global db mock (not present in createMockDb fixture)
    const db = (await import("@/lib/db")).default as unknown as {
      cronLog: { create: typeof mockCronLogCreate };
    };
    db.cronLog = { create: mockCronLogCreate };
  });

  it("writes a CronLog row on success status", async () => {
    await recordCronRun(
      "nightly-payout",
      "success",
      new Date("2026-04-15T00:00:00Z"),
    );

    expect(mockCronLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobName: "nightly-payout",
        status: "success",
        durationMs: expect.any(Number),
      }),
    });
  });

  it("writes error status with detail", async () => {
    await recordCronRun(
      "pickup-reservations",
      "error",
      new Date(Date.now() - 1000),
      "Timeout",
    );

    expect(mockCronLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobName: "pickup-reservations",
        status: "error",
        detail: "Timeout",
      }),
    });
  });

  it("truncates detail to 500 chars", async () => {
    const longDetail = "x".repeat(800);

    await recordCronRun("daily-digest", "error", new Date(), longDetail);

    const call = mockCronLogCreate.mock.calls[0]?.[0] as {
      data: { detail: string };
    };
    expect(call?.data.detail?.length).toBe(500);
  });

  it("null detail when none provided", async () => {
    await recordCronRun("foo", "success", new Date());

    expect(mockCronLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ detail: null }),
    });
  });

  it("db error is swallowed — never throws", async () => {
    mockCronLogCreate.mockRejectedValueOnce(new Error("DB down"));

    // Should not throw
    await expect(
      recordCronRun("x", "success", new Date()),
    ).resolves.toBeUndefined();
  });

  it("computes durationMs as finishedAt - startedAt", async () => {
    const startedAt = new Date(Date.now() - 250);

    await recordCronRun("foo", "success", startedAt);

    const call = mockCronLogCreate.mock.calls[0]?.[0] as {
      data: { durationMs: number };
    };
    expect(call?.data.durationMs).toBeGreaterThanOrEqual(250);
    expect(call?.data.durationMs).toBeLessThan(5000); // Sanity bound
  });
});
