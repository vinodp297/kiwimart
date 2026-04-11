// src/test/get-client-ip.test.ts
// ─── Tests: FIX 5 — getClientIp unknown-{uuid} fallback ──────────────────────
//
//   1. Valid IP returned as-is
//   2. No IP header → returns unknown-{uuid} format
//   3. Two requests with no IP get different bucket IDs
//   4. logger.warn called with user-agent when IP is unknown

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// Restore the real rateLimit implementation so getClientIp is tested directly.
vi.mock("@/server/lib/rateLimit", async (importOriginal) => {
  return importOriginal();
});

import { getClientIp } from "@/server/lib/rateLimit";
import { logger } from "@/shared/logger";

describe("FIX 5 — getClientIp unknown-uuid fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Valid IP returned as-is ─────────────────────────────────────────────

  it("returns the IP address as-is when x-real-ip header is present", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.42" });
    expect(getClientIp(headers)).toBe("203.0.113.42");
  });

  // ── 2. No IP → unknown-{uuid} format ──────────────────────────────────────

  it("returns unknown-{uuid} when no IP headers are present", () => {
    const headers = new Headers();
    const result = getClientIp(headers);
    expect(result).toMatch(
      /^unknown-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  // ── 3. Two no-IP requests get different bucket IDs ─────────────────────────

  it("generates a unique bucket ID for each request with no IP (no shared bucket)", () => {
    const id1 = getClientIp(new Headers());
    const id2 = getClientIp(new Headers());
    expect(id1).not.toBe(id2);
    expect(id1.startsWith("unknown-")).toBe(true);
    expect(id2.startsWith("unknown-")).toBe(true);
  });

  // ── 4. logger.warn called with user-agent ─────────────────────────────────

  it("logs warn with user-agent when IP cannot be determined", () => {
    const headers = new Headers({
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
    });
    getClientIp(headers);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      "rate_limit.ip_unknown",
      expect.objectContaining({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
      }),
    );
  });
});
