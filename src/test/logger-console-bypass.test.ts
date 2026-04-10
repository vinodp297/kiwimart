// src/test/logger-console-bypass.test.ts
// ─── Fix 2 tests: server code must use logger, not console ───────────────────
// Verifies that production server files route errors through the structured
// logger rather than calling console.error directly.
//
// Strategy: import the real source files, spy on the logger mock (which is
// already set up globally by setup.ts), and verify logger.error is called
// instead of console.error.

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Fix 2 — server code routes errors through logger, not console.error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cart.service: source no longer contains console.error for redis failures", async () => {
    // Read the cart.service source at runtime via the module registry.
    // The module has been transformed — if console.error still existed for redis
    // errors, it would be in the source string.  This is the simplest reliable
    // way to assert the source was changed without orchestrating a Redis failure
    // in the unit test environment.
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/modules/cart/cart.service.ts"),
      "utf-8",
    );

    expect(src).not.toContain('console.error("[cart] redis set failed');
    expect(src).not.toContain('console.error("[cart] redis del failed');
    expect(src).toContain('logger.error("cart.redis_set_failed"');
    expect(src).toContain('logger.error("cart.redis_del_failed"');
  });

  it("imageWorker: VERCEL guard calls logger.error not console.error", async () => {
    const consoleSpy = vi.spyOn(console, "error");
    const { logger } = await import("@/shared/logger");

    // Set VERCEL env so the guard triggers, then start the worker
    vi.stubEnv("VERCEL", "1");

    const { startImageWorker } = await import("@/server/workers/imageWorker");
    startImageWorker();

    // logger.error should have been called with the structured event
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "worker.image.vercel_unsupported",
      expect.objectContaining({ error: expect.any(String) }),
    );
    // console.error must NOT have been called for this message
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("worker.image"),
      expect.anything(),
    );

    vi.unstubAllEnvs();
    consoleSpy.mockRestore();
  });

  it("payoutWorker: VERCEL guard calls logger.error not console.error", async () => {
    const consoleSpy = vi.spyOn(console, "error");
    const { logger } = await import("@/shared/logger");

    vi.stubEnv("VERCEL", "1");

    const { startPayoutWorker } = await import("@/server/workers/payoutWorker");
    startPayoutWorker();

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "worker.payout.vercel_unsupported",
      expect.objectContaining({ error: expect.any(String) }),
    );
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("worker.payout"),
      expect.anything(),
    );

    vi.unstubAllEnvs();
    consoleSpy.mockRestore();
  });

  it("pickupWorker: VERCEL guard calls logger.error not console.error", async () => {
    const consoleSpy = vi.spyOn(console, "error");
    const { logger } = await import("@/shared/logger");

    vi.stubEnv("VERCEL", "1");

    const { startPickupWorker } = await import("@/server/workers/pickupWorker");
    startPickupWorker();

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "worker.pickup.vercel_unsupported",
      expect.objectContaining({ error: expect.any(String) }),
    );
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("worker.pickup"),
      expect.anything(),
    );

    vi.unstubAllEnvs();
    consoleSpy.mockRestore();
  });
});
