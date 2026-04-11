// src/test/observability-sprint-c.test.ts
// ─── Observability Sprint C — Tests for all four observability fixes ────────
//
// Fix 1: Cron failure alerting to Sentry (runCronJob wrapper)
// Fix 2: Homepage fallback logs + Sentry alert
// Fix 3: SLO business metrics on /api/health
// Fix 4: Silent catch patterns now log before returning fallback

import { describe, it, expect, vi, beforeEach } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════════
// Shared mocks — logger and @sentry/nextjs
// ═══════════════════════════════════════════════════════════════════════════════

vi.mock("server-only", () => ({}));

// Use vi.hoisted so the mocks are declared before vi.mock factories run.
const { loggerMocks, sentryCaptureException } = vi.hoisted(() => ({
  loggerMocks: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
  sentryCaptureException: vi.fn(),
}));

vi.mock("@/shared/logger", () => ({
  logger: loggerMocks,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: sentryCaptureException,
  captureMessage: vi.fn(),
  withScope: vi.fn((cb: (scope: { setTag: () => void }) => void) =>
    cb({ setTag: vi.fn() }),
  ),
}));

beforeEach(() => {
  loggerMocks.info.mockClear();
  loggerMocks.warn.mockClear();
  loggerMocks.error.mockClear();
  sentryCaptureException.mockClear();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 1 — runCronJob wrapper
// ═══════════════════════════════════════════════════════════════════════════════

import { runCronJob } from "@/lib/cron-monitor";

describe("Fix 1 — runCronJob wrapper", () => {
  it("calls Sentry.captureException with cronJob tag on failure", async () => {
    const boom = new Error("job blew up");

    await expect(
      runCronJob("testJob", async () => {
        throw boom;
      }),
    ).rejects.toThrow("job blew up");

    // Sentry import is dynamic + async — give the fire-and-forget a tick
    await new Promise((resolve) => setImmediate(resolve));

    expect(sentryCaptureException).toHaveBeenCalledTimes(1);
    const call = sentryCaptureException.mock.calls[0]!;
    expect(call[0]).toBe(boom);
    expect(call[1].tags).toMatchObject({ cronJob: "testJob" });
    expect(call[1].level).toBe("error");
  });

  it("logs at error level on failure with durationMs and jobName", async () => {
    await expect(
      runCronJob("failingJob", async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");

    expect(loggerMocks.error).toHaveBeenCalledWith(
      "cron.failingJob.failed",
      expect.objectContaining({
        jobName: "failingJob",
        durationMs: expect.any(Number),
        error: "nope",
      }),
    );
  });

  it("logs completed with duration and result on success", async () => {
    const result = await runCronJob("goodJob", async () => ({
      processed: 7,
    }));

    expect(result).toEqual({ processed: 7 });
    expect(loggerMocks.info).toHaveBeenCalledWith(
      "cron.goodJob.completed",
      expect.objectContaining({
        jobName: "goodJob",
        durationMs: expect.any(Number),
        processed: 7,
      }),
    );
  });

  it("re-throws the original error after alerting", async () => {
    const boom = new Error("original");
    let thrown: unknown = null;
    try {
      await runCronJob("errJob", async () => {
        throw boom;
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(boom);
  });

  it("is wired into the autoReleaseEscrow cron route (source check)", async () => {
    // Regression guard: confirm the critical cron route imports runCronJob.
    // Reading the source directly avoids spinning up a NextRequest.
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/api/cron/auto-release/route.ts"),
      "utf8",
    );
    expect(source).toContain("runCronJob");
    expect(source).toContain("autoReleaseEscrow");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 2 — Homepage fallback observability
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fix 2 — Homepage fallback logging", () => {
  it("homepage data layer logs homepage.data_fetch_failed on DB failure", async () => {
    const fs = await import("fs");
    const path = await import("path");
    // After Task I4 split, the data-fetching logic lives in home-data.ts
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/(public)/_lib/home-data.ts"),
      "utf8",
    );
    expect(source).toContain("homepage.data_fetch_failed");
    expect(source).toContain("logger.error");
  });

  it("homepage data layer sends Sentry alert on fallback with component tag", async () => {
    const fs = await import("fs");
    const path = await import("path");
    // After Task I4 split, the data-fetching logic lives in home-data.ts
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/(public)/_lib/home-data.ts"),
      "utf8",
    );
    expect(source).toContain("@sentry/nextjs");
    expect(source).toContain('component: "homepage"');
    expect(source).toContain('severity: "degraded"');
  });

  it("homepage data layer still returns nulls (fallback preserved)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    // After Task I4 split, the fallback is in fetchHomeData() in home-data.ts.
    // Variables are null-initialized so they remain null if the try block throws.
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/(public)/_lib/home-data.ts"),
      "utf8",
    );
    // Null-initialized declarations preserve the fallback-to-mock behaviour.
    expect(source).toContain("let listingCount");
    expect(source).toContain("| null = null");
    // The catch block must still log the error so operators are alerted.
    expect(source).toContain("homepage.data_fetch_failed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 3 — SLO business metrics on /api/health
// ═══════════════════════════════════════════════════════════════════════════════

// Mock DB/Redis/queue before importing the route. Include $transaction because
// the global setup.ts beforeEach re-mocks it on every test.
const { dbMocks } = vi.hoisted(() => ({
  dbMocks: {
    payout: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    dispute: {
      count: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  default: dbMocks,
}));

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({
    ping: vi.fn().mockResolvedValue("PONG"),
  }),
}));

vi.mock("@/lib/queue", () => ({
  payoutQueue: { getFailedCount: vi.fn().mockResolvedValue(0) },
  emailQueue: { getFailedCount: vi.fn().mockResolvedValue(0) },
  QUEUE_MAP: {
    email: { getJobCounts: vi.fn().mockResolvedValue({ failed: 0 }) },
    image: { getJobCounts: vi.fn().mockResolvedValue({ failed: 0 }) },
    payout: { getJobCounts: vi.fn().mockResolvedValue({ failed: 0 }) },
    notification: { getJobCounts: vi.fn().mockResolvedValue({ failed: 0 }) },
    pickup: { getJobCounts: vi.fn().mockResolvedValue({ failed: 0 }) },
  },
}));

describe("Fix 3 — SLO business metrics", () => {
  beforeEach(() => {
    dbMocks.payout.count.mockReset().mockResolvedValue(5);
    dbMocks.dispute.count.mockReset().mockResolvedValue(1);
    dbMocks.payout.findFirst.mockReset().mockResolvedValue(null);
  });

  async function callHealth(): Promise<{
    status: number;
    body: Record<string, unknown>;
  }> {
    const { GET } = await import("@/app/api/health/route");
    const req = new Request("http://localhost/api/health");
    const res = await GET(req);
    return { status: res.status, body: await res.json() };
  }

  // Fix 4 moved business SLO metrics out of the public health endpoint.
  // The public endpoint now only checks infrastructure (database + Redis).
  // Business metrics live in /api/admin/health (cached, auth-gated).
  it("public health endpoint does NOT expose business metrics (moved to admin endpoint)", async () => {
    const { status, body } = await callHealth();
    expect(status).toBe(200);
    // Business metrics must NOT be in the public response
    expect(body.business).toBeUndefined();
    // Infra checks are still present
    expect(body.checks).toMatchObject({ database: "ok", redis: "ok" });
  });

  it("public health status is ok regardless of pendingPayouts (SLOs checked in admin only)", async () => {
    dbMocks.payout.count.mockResolvedValue(150);
    const { status, body } = await callHealth();
    expect(status).toBe(200);
    // Infra is healthy — public endpoint must say ok (no business SLO logic here)
    expect(body.status).toBe("ok");
    // No business field exposed
    expect(body.business).toBeUndefined();
  });

  it("public health status is ok regardless of stale payouts (SLOs checked in admin only)", async () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
    dbMocks.payout.findFirst.mockResolvedValue({ createdAt: threeDaysAgo });
    const { status, body } = await callHealth();
    expect(status).toBe(200);
    // Infra is healthy — no payout-age logic in the public endpoint
    expect(body.status).toBe("ok");
  });

  it("existing infra checks are still present in the response", async () => {
    const { body } = await callHealth();
    // Regression guard: fix 3 must add, not replace
    expect(body.checks).toMatchObject({ database: "ok", redis: "ok" });
    expect(body.version).toBeDefined();
    expect(body.correlationId).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 4 — Silent catch patterns eliminated in critical paths
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fix 4 — Silent catch patterns in critical paths", () => {
  it("search.service FTS fallback logs before returning", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/modules/listings/search.service.ts"),
      "utf8",
    );
    expect(source).toContain("search.fts_fallback");
    expect(source).toContain("logger.warn");
  });

  it("order timeline action logs before returning error fallback", async () => {
    const fs = await import("fs");
    const path = await import("path");
    // After Task I5 split, getOrderTimeline lives in order-query.actions.ts
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/server/actions/order-query.actions.ts"),
      "utf8",
    );
    expect(source).toContain("order.timeline.fetch_failed");
    expect(source).toContain("logger.error");
  });

  it("messages server action logs before returning fallback arrays", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/server/actions/messages.ts"),
      "utf8",
    );
    expect(source).toContain("messages.threads.fetch_failed");
    expect(source).toContain("messages.thread_messages.fetch_failed");
  });

  it("payment service catches always log (no silent payment failures)", async () => {
    // Payment code is high-risk — confirm no bare `} catch {` exists.
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/modules/payments/payment.service.ts"),
      "utf8",
    );
    // Should not contain anonymous catch followed by return null/[]
    expect(source).not.toMatch(/\}\s*catch\s*\{\s*\n\s*return (null|\[\])/);
  });
});
