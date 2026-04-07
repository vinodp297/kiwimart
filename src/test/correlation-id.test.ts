// src/test/correlation-id.test.ts
// ─── Tests: correlationId threading ──────────────────────────────────────────
// Verifies that:
//   1. runWithRequestContext / getRequestContext roundtrip works correctly
//   2. Outside a context, getRequestContext() returns undefined
//   3. The real logger auto-enriches log output with correlationId
//   4. BullMQ queue.add() calls receive correlationId via the request context

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runWithRequestContext,
  getRequestContext,
} from "@/lib/request-context";

// ─── C1 + C2: AsyncLocalStorage request context ─────────────────────────────

describe("request context — AsyncLocalStorage", () => {
  it("getRequestContext returns the correlationId set by runWithRequestContext", () => {
    let captured: string | undefined;

    runWithRequestContext({ correlationId: "trace-abc-123" }, () => {
      captured = getRequestContext()?.correlationId;
    });

    expect(captured).toBe("trace-abc-123");
  });

  it("getRequestContext returns undefined outside a runWithRequestContext call", () => {
    // Executed at module scope — no AsyncLocalStorage context active.
    expect(getRequestContext()).toBeUndefined();
  });

  it("nested contexts are isolated — inner context does not bleed into outer", async () => {
    let outerDuring: string | undefined;
    let innerDuring: string | undefined;
    let outerAfter: string | undefined;

    await runWithRequestContext({ correlationId: "outer-id" }, async () => {
      outerDuring = getRequestContext()?.correlationId;

      await runWithRequestContext({ correlationId: "inner-id" }, async () => {
        innerDuring = getRequestContext()?.correlationId;
      });

      outerAfter = getRequestContext()?.correlationId;
    });

    expect(outerDuring).toBe("outer-id");
    expect(innerDuring).toBe("inner-id");
    // After inner context resolves, the outer context is restored
    expect(outerAfter).toBe("outer-id");
  });
});

// ─── C3: Logger auto-enriches with correlationId ────────────────────────────

describe("logger — correlationId enrichment", () => {
  it("includes correlationId from request context in log output", async () => {
    // Use the ACTUAL logger module (not the setup.ts vi.fn() mock) so we can
    // observe the real enrichment logic via console spy.
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { logger: realLogger } =
      await vi.importActual<typeof import("@/shared/logger")>(
        "@/shared/logger",
      );

    runWithRequestContext({ correlationId: "log-enrich-test-456" }, () => {
      realLogger.info("test.correlation.event", { key: "val" });
    });

    // In non-production (test) mode, logger calls:
    //   console.log(prefix, event, enrichedContext)
    // enrichedContext will contain { correlationId, key }
    const allArgs = consoleSpy.mock.calls.flat();
    const serialised = JSON.stringify(allArgs);
    expect(serialised).toContain("log-enrich-test-456");
    expect(serialised).toContain("test.correlation.event");

    consoleSpy.mockRestore();
  });

  it("does not add correlationId to log output when no context is active", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { logger: realLogger } =
      await vi.importActual<typeof import("@/shared/logger")>(
        "@/shared/logger",
      );

    // Called outside any runWithRequestContext — correlationId must be absent
    realLogger.info("test.no.context.event", { key: "val" });

    const allArgs = consoleSpy.mock.calls.flat();
    const serialised = JSON.stringify(allArgs);
    expect(serialised).toContain("test.no.context.event");
    expect(serialised).not.toContain("correlationId");

    consoleSpy.mockRestore();
  });
});

// ─── C4: BullMQ job data carries correlationId ───────────────────────────────
// Tests the exact pattern used in every queue.add() call site:
//   correlationId: getRequestContext()?.correlationId
// Verifies that when a job is enqueued inside a runWithRequestContext block the
// correlationId propagates into the job payload, linking the queued job back to
// the originating HTTP request in logs and Sentry.

describe("BullMQ — correlationId in job payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("job payload includes correlationId when context is active", async () => {
    const { payoutQueue } = await import("@/lib/queue");
    const addSpy = vi.mocked(payoutQueue.add);

    await runWithRequestContext(
      { correlationId: "queue-corr-test-789" },
      async () => {
        // Reproduce the exact pattern used in order-dispatch.service.ts
        await payoutQueue.add("process-payout", {
          orderId: "order-abc",
          sellerId: "seller-xyz",
          amountNzd: 5000,
          stripeAccountId: "acct_test",
          correlationId: getRequestContext()?.correlationId,
        });
      },
    );

    expect(addSpy).toHaveBeenCalledWith(
      "process-payout",
      expect.objectContaining({ correlationId: "queue-corr-test-789" }),
    );
  });

  it("job payload has correlationId undefined when no context is active", async () => {
    const { payoutQueue } = await import("@/lib/queue");
    const addSpy = vi.mocked(payoutQueue.add);

    // No runWithRequestContext — simulates a background/cron trigger
    await payoutQueue.add("process-payout", {
      orderId: "order-abc",
      sellerId: "seller-xyz",
      amountNzd: 5000,
      stripeAccountId: "acct_test",
      correlationId: getRequestContext()?.correlationId,
    });

    expect(addSpy).toHaveBeenCalledWith(
      "process-payout",
      expect.objectContaining({ correlationId: undefined }),
    );
  });
});
