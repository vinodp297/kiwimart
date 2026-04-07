// src/test/api-helpers.test.ts
// ─── Tests for API v1 Helper Functions ──────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import { AppError } from "@/shared/errors";
import db from "@/lib/db";

// Mock mobile-auth
vi.mock("@/lib/mobile-auth", () => ({
  verifyMobileToken: vi.fn().mockResolvedValue(null),
}));

import { verifyMobileToken } from "@/lib/mobile-auth";

// Import helpers after mocks
const { apiOk, apiError, handleApiError, requireApiUser, checkApiRateLimit } =
  await import("@/app/api/v1/_helpers/response");

import { rateLimit } from "@/server/lib/rateLimit";
import { auth } from "@/lib/auth";

describe("API Response Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── apiOk ────────────────────────────────────────────────────────────────

  describe("apiOk", () => {
    it("returns success response with data and timestamp", async () => {
      const res = apiOk({ items: [1, 2] });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ items: [1, 2] });
      expect(body.timestamp).toBeDefined();
    });

    it("accepts custom status code", async () => {
      const res = apiOk({ id: "new-1" }, 201);
      expect(res.status).toBe(201);
    });
  });

  // ── apiError ─────────────────────────────────────────────────────────────

  describe("apiError", () => {
    it("returns error response with message and code", async () => {
      const res = apiError("Not found", 404, "NOT_FOUND");
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toBe("Not found");
      expect(body.code).toBe("NOT_FOUND");
      expect(body.timestamp).toBeDefined();
    });
  });

  // ── handleApiError ───────────────────────────────────────────────────────

  describe("handleApiError", () => {
    it("returns AppError status and message", async () => {
      const err = AppError.notFound("Listing");
      const res = handleApiError(err);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Listing not found");
      expect(body.code).toBe("NOT_FOUND");
    });

    it("returns 500 for non-AppError", async () => {
      const err = new Error("Something broke");
      const res = handleApiError(err);
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain("unexpected error");
    });
  });

  // ── requireApiUser ───────────────────────────────────────────────────────

  describe("requireApiUser", () => {
    it("authenticates via Bearer token (mobile)", async () => {
      vi.mocked(verifyMobileToken).mockResolvedValue({
        sub: "user-1",
        email: "user@test.com",
        role: "user",
        jti: "jti-1",
      });
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "user-1",
        email: "user@test.com",
        isAdmin: false,
        isBanned: false,
        isSellerEnabled: true,
        isStripeOnboarded: true,
      } as never);

      const req = new Request("http://localhost/api/test", {
        headers: { Authorization: "Bearer valid-token" },
      });

      const user = await requireApiUser(req);

      expect(user.id).toBe("user-1");
      expect(verifyMobileToken).toHaveBeenCalledWith("valid-token");
    });

    it("rejects invalid Bearer token", async () => {
      vi.mocked(verifyMobileToken).mockResolvedValue(null);

      const req = new Request("http://localhost/api/test", {
        headers: { Authorization: "Bearer invalid-token" },
      });

      await expect(requireApiUser(req)).rejects.toThrow();
    });

    it("falls back to session cookie when no Authorization header", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-2" },
      } as never);
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "user-2",
        email: "web@test.com",
        isAdmin: false,
        isBanned: false,
        isSellerEnabled: false,
        isStripeOnboarded: false,
      } as never);

      const req = new Request("http://localhost/api/test");
      const user = await requireApiUser(req);

      expect(user.id).toBe("user-2");
    });

    it("rejects banned user with Bearer token", async () => {
      vi.mocked(verifyMobileToken).mockResolvedValue({
        sub: "user-1",
        email: "banned@test.com",
        role: "user",
        jti: "jti-1",
      });
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "user-1",
        email: "banned@test.com",
        isAdmin: false,
        isBanned: true,
        isSellerEnabled: false,
        isStripeOnboarded: false,
      } as never);

      const req = new Request("http://localhost/api/test", {
        headers: { Authorization: "Bearer valid-token" },
      });

      await expect(requireApiUser(req)).rejects.toThrow();
    });

    it("rejects when no session and no token", async () => {
      vi.mocked(auth).mockResolvedValue(null as never);

      const req = new Request("http://localhost/api/test");

      await expect(requireApiUser(req)).rejects.toThrow();
    });

    it("rejects banned user from session", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-3" },
      } as never);
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "user-3",
        email: "banned@test.com",
        isAdmin: false,
        isBanned: true,
        isSellerEnabled: false,
        isStripeOnboarded: false,
      } as never);

      const req = new Request("http://localhost/api/test");

      await expect(requireApiUser(req)).rejects.toThrow();
    });

    it("rejects deleted user from session", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-deleted" },
      } as never);
      vi.mocked(db.user.findUnique).mockResolvedValue(null);

      const req = new Request("http://localhost/api/test");

      await expect(requireApiUser(req)).rejects.toThrow();
    });
  });

  // ── checkApiRateLimit ────────────────────────────────────────────────────

  describe("checkApiRateLimit", () => {
    it("returns null when not rate limited", async () => {
      vi.mocked(rateLimit).mockResolvedValue({
        success: true,
        remaining: 10,
        reset: Date.now() + 60000,
        retryAfter: 0,
      });

      const req = new Request("http://localhost/api/test");
      const result = await checkApiRateLimit(req, "listing");

      expect(result).toBeNull();
    });

    it("returns 429 response when rate limited", async () => {
      vi.mocked(rateLimit).mockResolvedValue({
        success: false,
        remaining: 0,
        reset: Date.now() + 60000,
        retryAfter: 30,
      });

      const req = new Request("http://localhost/api/test");
      const result = await checkApiRateLimit(req, "listing");

      expect(result).not.toBeNull();
      expect(result!.status).toBe(429);

      const body = await result!.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain("Too many requests");
      expect(body.retryAfter).toBe(30);

      // Restore
      vi.mocked(rateLimit).mockResolvedValue({
        success: true,
        remaining: 999,
        reset: Date.now() + 60000,
        retryAfter: 0,
      });
    });

    it("includes rate limit headers on 429", async () => {
      vi.mocked(rateLimit).mockResolvedValue({
        success: false,
        remaining: 0,
        reset: Date.now() + 60000,
        retryAfter: 45,
      });

      const req = new Request("http://localhost/api/test");
      const result = await checkApiRateLimit(req, "order");

      expect(result!.headers.get("Retry-After")).toBe("45");
      expect(result!.headers.get("X-RateLimit-Remaining")).toBe("0");

      // Restore
      vi.mocked(rateLimit).mockResolvedValue({
        success: true,
        remaining: 999,
        reset: Date.now() + 60000,
        retryAfter: 0,
      });
    });
  });
});
