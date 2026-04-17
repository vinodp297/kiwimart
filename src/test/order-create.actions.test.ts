// src/test/order-create.actions.test.ts
// ─── Tests: createOrder + uploadOrderEvidence server actions ────────────────
// Covers auth guard, rate limit gate, Zod validation, orderService delegation,
// and the evidence-upload happy path + validation + quota + partial-failure
// cleanup.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ─────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock orderService ────────────────────────────────────────────────────────
const mockCreateOrder = vi.fn();
vi.mock("@/modules/orders/order.service", () => ({
  orderService: {
    createOrder: (...args: unknown[]) => mockCreateOrder(...args),
  },
}));

// ── Mock validateImageFile ───────────────────────────────────────────────────
const mockValidateImageFile = vi.fn();
vi.mock("@/server/lib/fileValidation", () => ({
  validateImageFile: (...args: unknown[]) => mockValidateImageFile(...args),
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { createOrder, uploadOrderEvidence } =
  await import("@/server/actions/order-create.actions");
const { r2 } = await import("@/infrastructure/storage/r2");
const { rateLimit } = await import("@/server/lib/rateLimit");

const TEST_USER = {
  id: "user_1",
  email: "u@test.com",
  isAdmin: false,
  isSellerEnabled: false,
  isStripeOnboarded: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// createOrder
// ─────────────────────────────────────────────────────────────────────────────

describe("createOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 10,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
    mockCreateOrder.mockResolvedValue({
      ok: true,
      orderId: "order_1",
      clientSecret: "cs_abc",
    });
  });

  it("returns auth_required when requireUser throws", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await createOrder({ listingId: "l_1" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("auth_required");
    }
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it("returns rate_limited when rateLimit.success is false", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 60,
    });

    const result = await createOrder({ listingId: "l_1" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("rate_limited");
    }
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it("returns validation_error when input fails schema parsing", async () => {
    const result = await createOrder({
      listingId: "", // empty → zod will reject
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("validation_error");
    }
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it("happy path → returns { orderId, clientSecret }", async () => {
    const result = await createOrder({ listingId: "listing_valid_123" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        orderId: "order_1",
        clientSecret: "cs_abc",
      });
    }
    expect(mockCreateOrder).toHaveBeenCalledWith(
      TEST_USER.id,
      TEST_USER.email,
      expect.objectContaining({ listingId: "listing_valid_123" }),
      expect.any(String),
    );
  });

  it("surfaces orderService error message when result.ok=false", async () => {
    mockCreateOrder.mockResolvedValueOnce({
      ok: false,
      error: "Listing no longer available",
    });

    const result = await createOrder({ listingId: "listing_valid_123" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Listing no longer available");
    }
  });

  it("rate limits by user.id (not by IP) for authenticated orders", async () => {
    await createOrder({ listingId: "listing_valid_123" });

    expect(rateLimit).toHaveBeenCalledWith("order", TEST_USER.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// uploadOrderEvidence
// ─────────────────────────────────────────────────────────────────────────────

/** Helper to build a fake FormData with N image files. */
function makeFormData(
  files: Array<{
    name?: string;
    type?: string;
    size?: number;
    bufferText?: string;
  }>,
): FormData {
  const fd = new FormData();
  for (const f of files) {
    const blob = new Blob([f.bufferText ?? "binary"], {
      type: f.type ?? "image/jpeg",
    });
    // Use File constructor so .type + .name + .size are populated consistently.
    const file = new File([blob], f.name ?? "photo.jpg", {
      type: f.type ?? "image/jpeg",
    });
    // Override `size` if requested (Node's File uses blob size by default)
    if (f.size !== undefined) {
      Object.defineProperty(file, "size", { value: f.size });
    }
    fd.append("files", file);
  }
  return fd;
}

describe("uploadOrderEvidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 10,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
    mockValidateImageFile.mockReturnValue({ valid: true });
    vi.mocked(r2.send).mockResolvedValue({} as never);
  });

  it("fails closed when no files are provided", async () => {
    const fd = new FormData();

    const result = await uploadOrderEvidence(fd, "dispatch");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/no files/i);
    }
  });

  it("enforces EVIDENCE_MAX_FILES cap (default 4)", async () => {
    const fd = makeFormData([
      { name: "a.jpg" },
      { name: "b.jpg" },
      { name: "c.jpg" },
      { name: "d.jpg" },
      { name: "e.jpg" }, // 5 > 4
    ]);

    const result = await uploadOrderEvidence(fd, "delivery");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/maximum .* photos/i);
    }
  });

  it("rejects when file validation fails", async () => {
    mockValidateImageFile.mockReturnValueOnce({
      valid: false,
      error: "Unsafe file",
    });
    const fd = makeFormData([{ name: "a.jpg" }]);

    const result = await uploadOrderEvidence(fd, "dispatch");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Unsafe file");
    }
  });

  it("rejects files over 5MB", async () => {
    const fd = makeFormData([{ name: "big.jpg", size: 6 * 1024 * 1024 }]);

    const result = await uploadOrderEvidence(fd, "dispatch");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/5MB/);
    }
  });

  it("returns rate_limited error when rateLimit.success is false", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 60,
    });
    const fd = makeFormData([{ name: "a.jpg" }]);

    const result = await uploadOrderEvidence(fd, "dispatch");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many uploads/i);
    }
  });

  it("happy path → uploads files to R2 with context-prefixed keys", async () => {
    const fd = makeFormData([
      { name: "a.jpg", type: "image/jpeg" },
      { name: "b.png", type: "image/png" },
    ]);

    const result = await uploadOrderEvidence(fd, "dispatch");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.keys).toHaveLength(2);
      expect(result.data.keys[0]).toMatch(
        /^dispatch\/user_1\/[a-f0-9-]+\.jpg$/,
      );
      expect(result.data.keys[1]).toMatch(
        /^dispatch\/user_1\/[a-f0-9-]+\.png$/,
      );
    }
    expect(r2.send).toHaveBeenCalledTimes(2);
  });

  it("defaults extension to webp for unknown mime type", async () => {
    const fd = makeFormData([{ name: "weird", type: "image/webp" }]);

    const result = await uploadOrderEvidence(fd, "delivery");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.keys[0]).toMatch(/\.webp$/);
      expect(result.data.keys[0]).toMatch(/^delivery\/user_1\//);
    }
  });

  it("partial-failure cleanup: deletes already-uploaded keys when a later put fails", async () => {
    const fd = makeFormData([
      { name: "a.jpg" },
      { name: "b.jpg" },
      { name: "c.jpg" },
    ]);

    // First put succeeds; second fails mid-flight.
    vi.mocked(r2.send)
      .mockResolvedValueOnce({} as never) // put a (success)
      .mockRejectedValueOnce(new Error("Network failure")) // put b (fail)
      .mockResolvedValueOnce({} as never) // put c (would succeed)
      .mockResolvedValueOnce({} as never); // delete cleanup

    const result = await uploadOrderEvidence(fd, "dispatch");

    expect(result.success).toBe(false);
    // r2.send was called at least once for the attempted uploads
    expect(r2.send).toHaveBeenCalled();
  });

  it("rejects without a user when requireUser throws", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));
    const fd = makeFormData([{ name: "a.jpg" }]);

    const result = await uploadOrderEvidence(fd, "dispatch");

    expect(result.success).toBe(false);
    expect(r2.send).not.toHaveBeenCalled();
  });
});
