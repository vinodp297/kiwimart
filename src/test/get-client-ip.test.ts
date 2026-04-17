// src/test/get-client-ip.test.ts
// ─── Tests: getClientIp — stable fingerprint fallback ────────────────────────
//
//   1. Valid IP returned as-is
//   2. Missing IP headers, user-agent present → stable anon-{hex16} fingerprint
//   3. Same headers always return the same fingerprint (deterministic)
//   4. Different browser metadata → different fingerprints
//   5. Missing ALL headers → 'anon-unknown' (fail-closed shared bucket)
//   6. logger.warn emitted with 'rate.limit.ip.missing' key + fallback field

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// Restore the real rateLimit implementation so getClientIp is tested directly.
vi.mock("@/server/lib/rateLimit", async (importOriginal) => {
  return importOriginal();
});

import { getClientIp } from "@/server/lib/rateLimit";
import { logger } from "@/shared/logger";

describe("getClientIp — stable fingerprint fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Valid IP returned as-is ─────────────────────────────────────────────

  it("returns the IP address as-is when x-real-ip header is present", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.42" });
    expect(getClientIp(headers)).toBe("203.0.113.42");
  });

  // ── 2. Missing IP, user-agent present → stable anon- fingerprint ──────────

  it("returns a stable anon-{hex16} fingerprint when no IP header is present but user-agent is set", () => {
    const headers = new Headers({
      "user-agent": "Mozilla/5.0 (Windows NT 10.0)",
      "accept-language": "en-NZ,en;q=0.9",
    });
    const result = getClientIp(headers);
    expect(result).toMatch(/^anon-[0-9a-f]{16}$/);
  });

  // ── 3. Same headers → same fingerprint (deterministic) ────────────────────

  it("returns the same fingerprint for identical headers on every call", () => {
    const make = () =>
      new Headers({
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
        "accept-language": "en-NZ",
      });
    const first = getClientIp(make());
    const second = getClientIp(make());
    expect(first).toBe(second);
    expect(first).toMatch(/^anon-[0-9a-f]{16}$/);
  });

  // ── 4. Different metadata → different fingerprints ─────────────────────────

  it("returns different fingerprints for different user-agent strings", () => {
    const iphone = new Headers({
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
    });
    const android = new Headers({
      "user-agent": "Mozilla/5.0 (Linux; Android 14)",
    });
    expect(getClientIp(iphone)).not.toBe(getClientIp(android));
  });

  // ── 5. No headers at all → 'anon-unknown' (fail-closed) ───────────────────

  it("returns 'anon-unknown' when no headers are present at all", () => {
    expect(getClientIp(new Headers())).toBe("anon-unknown");
  });

  // ── 6a. logger.warn emitted with fingerprint fallback ─────────────────────

  it("logs rate.limit.ip.missing with fallback:fingerprint when user-agent is set", () => {
    const headers = new Headers({
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
    });
    getClientIp(headers);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      "rate.limit.ip.missing",
      expect.objectContaining({ fallback: "fingerprint" }),
    );
  });

  // ── 6b. logger.warn emitted with anon-unknown fallback ────────────────────

  it("logs rate.limit.ip.missing with fallback:anon-unknown when no headers are present", () => {
    getClientIp(new Headers());
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      "rate.limit.ip.missing",
      expect.objectContaining({ fallback: "anon-unknown" }),
    );
  });
});
