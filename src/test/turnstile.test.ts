// src/test/turnstile.test.ts
// ─── Tests: Cloudflare Turnstile Server-Side Verification ───────────────────
// Covers verifyTurnstile: enforcement opt-in, test-key rejection, network
// timeout / non-2xx / bad-JSON failure modes, remote IP pass-through.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock @/env — enforcement ON, real secret key ─────────────────────────────
vi.mock("@/env", () => ({
  env: {
    TURNSTILE_ENFORCED: true,
    CLOUDFLARE_TURNSTILE_SECRET_KEY: "0xREAL_SECRET_abc123",
    TURNSTILE_SECRET_KEY: undefined,
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { verifyTurnstile } = await import("@/server/lib/turnstile");
const { logger } = await import("@/shared/logger");

// ── Helpers ──────────────────────────────────────────────────────────────────
function mockFetchJson(
  ok: boolean,
  body: Record<string, unknown>,
  status = 200,
) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("verifyTurnstile", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the real (unmocked) fetch before each test
    globalThis.fetch = originalFetch;
  });

  it("calls Cloudflare siteverify endpoint with token + secret", async () => {
    globalThis.fetch = mockFetchJson(true, { success: true }) as never;

    const ok = await verifyTurnstile("user-token-xyz");

    expect(ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({
        method: "POST",
        body: expect.any(URLSearchParams),
      }),
    );
    const body = (
      vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as {
        body: URLSearchParams;
      }
    ).body;
    expect(body.get("secret")).toBe("0xREAL_SECRET_abc123");
    expect(body.get("response")).toBe("user-token-xyz");
  });

  it("includes remoteip in request when provided", async () => {
    globalThis.fetch = mockFetchJson(true, { success: true }) as never;

    await verifyTurnstile("token", "203.0.113.5");

    const body = (
      vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as {
        body: URLSearchParams;
      }
    ).body;
    expect(body.get("remoteip")).toBe("203.0.113.5");
  });

  it("happy path (API success:true) → returns true", async () => {
    globalThis.fetch = mockFetchJson(true, { success: true }) as never;

    const ok = await verifyTurnstile("valid-token");

    expect(ok).toBe(true);
  });

  it("API success:false → fail closed, logs rejection", async () => {
    globalThis.fetch = mockFetchJson(true, {
      success: false,
      "error-codes": ["invalid-input-response"],
    }) as never;

    const ok = await verifyTurnstile("bad-token");

    expect(ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "turnstile: Cloudflare rejected the token",
      expect.objectContaining({
        errorCodes: ["invalid-input-response"],
      }),
    );
  });

  it("non-2xx status → fail closed, logs status", async () => {
    globalThis.fetch = mockFetchJson(
      false,
      { success: false, "error-codes": ["internal-error"] },
      500,
    ) as never;

    const ok = await verifyTurnstile("token");

    expect(ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "turnstile: Cloudflare API returned non-2xx status",
      expect.objectContaining({ status: 500 }),
    );
  });

  it("bad JSON response → fail closed", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new Error("Not JSON")),
    }) as never;

    const ok = await verifyTurnstile("token");

    expect(ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "turnstile: failed to parse Cloudflare response body",
      expect.any(Object),
    );
  });

  it("network error → fail closed", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNRESET")) as never;

    const ok = await verifyTurnstile("token");

    expect(ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "turnstile: verification request failed (network/timeout)",
      expect.objectContaining({ error: "ECONNRESET" }),
    );
  });

  it("AbortError (timeout) → fail closed", async () => {
    const abortErr = new DOMException("aborted", "AbortError");
    globalThis.fetch = vi.fn().mockRejectedValue(abortErr) as never;

    const ok = await verifyTurnstile("token");

    expect(ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Enforcement-off branch: returns true without calling Cloudflare
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyTurnstile (enforcement disabled)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns true without fetching when TURNSTILE_ENFORCED is false", async () => {
    vi.doMock("@/env", () => ({
      env: {
        TURNSTILE_ENFORCED: false,
        CLOUDFLARE_TURNSTILE_SECRET_KEY: "0xanything",
      },
    }));

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as never;

    const { verifyTurnstile: v } = await import("@/server/lib/turnstile");
    const ok = await v("any-token");

    expect(ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed branches: missing key / test keys
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyTurnstile (fail-closed branches)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("no secret key configured → fails closed and logs error", async () => {
    vi.doMock("@/env", () => ({
      env: {
        TURNSTILE_ENFORCED: true,
        CLOUDFLARE_TURNSTILE_SECRET_KEY: undefined,
        TURNSTILE_SECRET_KEY: undefined,
      },
    }));

    const { verifyTurnstile: v } = await import("@/server/lib/turnstile");
    const { logger: log } = await import("@/shared/logger");

    const ok = await v("token");

    expect(ok).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });

  it("test key starting with 1x → fails closed", async () => {
    vi.doMock("@/env", () => ({
      env: {
        TURNSTILE_ENFORCED: true,
        CLOUDFLARE_TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
        TURNSTILE_SECRET_KEY: undefined,
      },
    }));

    const { verifyTurnstile: v } = await import("@/server/lib/turnstile");
    const ok = await v("token");

    expect(ok).toBe(false);
  });

  it("test key starting with 2x → fails closed", async () => {
    vi.doMock("@/env", () => ({
      env: {
        TURNSTILE_ENFORCED: true,
        CLOUDFLARE_TURNSTILE_SECRET_KEY: "2x0000000000000000000000000000000AA",
        TURNSTILE_SECRET_KEY: undefined,
      },
    }));

    const { verifyTurnstile: v } = await import("@/server/lib/turnstile");
    const ok = await v("token");

    expect(ok).toBe(false);
  });

  it("falls back to TURNSTILE_SECRET_KEY when CLOUDFLARE_TURNSTILE_SECRET_KEY is absent", async () => {
    vi.doMock("@/env", () => ({
      env: {
        TURNSTILE_ENFORCED: true,
        CLOUDFLARE_TURNSTILE_SECRET_KEY: undefined,
        TURNSTILE_SECRET_KEY: "0xFALLBACK_secret",
      },
    }));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    }) as never;

    const { verifyTurnstile: v } = await import("@/server/lib/turnstile");
    const ok = await v("token");

    expect(ok).toBe(true);
    const body = (
      vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as {
        body: URLSearchParams;
      }
    ).body;
    expect(body.get("secret")).toBe("0xFALLBACK_secret");
  });
});
