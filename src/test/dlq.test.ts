// src/test/dlq.test.ts
// ─── Tests: Dead-letter queue (DLQ) configuration and admin endpoints ────────
// Covers:
//   1. Queue configuration has removeOnFail: false (DLQ enabled)
//   2. Queue configuration has attempts: 3 with exponential backoff
//   3. GET /api/admin/jobs/failed returns correct shape
//   4. GET /api/admin/jobs/failed requires admin auth (403 if not admin)
//   5. POST /api/admin/jobs/:id/retry moves job to waiting
//   6. POST /api/admin/jobs/:id/retry returns 404 for unknown job
//   7. Sentry alert fires when failed count > 10

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock functions ─────────────────────────────────────────────────
// vi.mock factories run before module-level const declarations, so any mock
// function referenced inside a factory must be hoisted.
const {
  mockGetFailedCount,
  mockGetFailed,
  mockGetJob,
  mockRequirePermission,
  mockCaptureMessage,
} = vi.hoisted(() => ({
  mockGetFailedCount: vi.fn().mockResolvedValue(0),
  mockGetFailed: vi.fn().mockResolvedValue([]),
  mockGetJob: vi.fn().mockResolvedValue(null),
  mockRequirePermission: vi.fn(),
  mockCaptureMessage: vi.fn(),
}));

// ─── Mock BullMQ Queue methods ──────────────────────────────────────────────
// The setup.ts mock for @/lib/queue only has { add: vi.fn() } on each queue.
// We extend the mocks with DLQ-related methods for these tests.
vi.mock("@/lib/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queue")>();
  const makeQueueMock = () => ({
    add: vi.fn(),
    getFailedCount: mockGetFailedCount,
    getFailed: mockGetFailed,
    getJob: mockGetJob,
  });

  const emailQueue = makeQueueMock();
  const imageQueue = makeQueueMock();
  const payoutQueue = makeQueueMock();
  const notificationQueue = makeQueueMock();
  const pickupQueue = makeQueueMock();

  return {
    ...actual,
    emailQueue,
    imageQueue,
    payoutQueue,
    notificationQueue,
    pickupQueue,
    QUEUE_MAP: {
      email: emailQueue,
      image: imageQueue,
      payout: payoutQueue,
      notification: notificationQueue,
      pickup: pickupQueue,
    },
    VALID_QUEUE_NAMES: ["email", "image", "payout", "notification", "pickup"],
  };
});

// ─── Mock requirePermission ─────────────────────────────────────────────────
vi.mock("@/shared/auth/requirePermission", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));

// ─── Mock Sentry ────────────────────────────────────────────────────────────
vi.mock("@sentry/nextjs", () => ({
  captureMessage: mockCaptureMessage,
}));

// ─── Import after mocks ────────────────────────────────────────────────────
import { DEFAULT_JOB_OPTIONS } from "@/lib/queue";
import { GET as getFailedJobs } from "@/app/api/admin/jobs/failed/route";
import { POST as retryJob } from "@/app/api/admin/jobs/[jobId]/retry/route";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFailedJob(
  overrides: Partial<{
    id: string;
    name: string;
    data: Record<string, unknown>;
    failedReason: string;
    attemptsMade: number;
    timestamp: number;
    finishedOn: number;
  }> = {},
) {
  return {
    id: overrides.id ?? "job-1",
    name: overrides.name ?? "process-payout",
    data: overrides.data ?? { orderId: "order-abc", correlationId: "corr-123" },
    failedReason: overrides.failedReason ?? "Connection refused",
    attemptsMade: overrides.attemptsMade ?? 3,
    timestamp: overrides.timestamp ?? 1700000000000,
    finishedOn: overrides.finishedOn ?? 1700000060000,
  };
}

// ─── Test 1 & 2: Queue configuration ────────────────────────────────────────

describe("queue configuration — DLQ defaults", () => {
  it("has removeOnFail: false to retain all failed jobs", () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toBe(false);
  });

  it("has attempts: 3 with exponential backoff starting at 5s", () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
    expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({
      type: "exponential",
      delay: 5000,
    });
  });

  it("keeps last 100 completed jobs for debugging", () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toEqual({ count: 100 });
  });
});

// ─── Test 3 & 4: GET /api/admin/jobs/failed ─────────────────────────────────

describe("GET /api/admin/jobs/failed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue({
      id: "admin-1",
      email: "admin@test.com",
      isAdmin: true,
      adminRole: "SUPER_ADMIN",
    });
    mockGetFailedCount.mockResolvedValue(0);
    mockGetFailed.mockResolvedValue([]);
  });

  it("returns correct shape with queues and totalFailed", async () => {
    // Set up one queue with a failed job
    mockGetFailedCount.mockResolvedValue(1);
    mockGetFailed.mockResolvedValue([makeFailedJob()]);

    const res = await getFailedJobs();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeDefined();
    expect(body.data.totalFailed).toBe(5); // 5 queues × 1 each
    expect(body.data.queues.email).toBeDefined();
    expect(body.data.queues.payout).toBeDefined();
    expect(body.data.queues.notification).toBeDefined();
    expect(body.data.queues.pickup).toBeDefined();
    expect(body.data.queues.image).toBeDefined();

    // Check job shape
    const job = body.data.queues.email.jobs[0];
    expect(job).toMatchObject({
      id: "job-1",
      name: "process-payout",
      failedReason: "Connection refused",
      attemptsMade: 3,
      correlationId: "corr-123",
      createdAt: 1700000000000,
      failedAt: 1700000060000,
    });
  });

  it("returns 403 when user lacks VIEW_SYSTEM_HEALTH permission", async () => {
    mockRequirePermission.mockRejectedValue(new Error("Forbidden"));

    const res = await getFailedJobs();
    expect(res.status).toBe(403);
  });

  it("redacts sensitive fields from job data", async () => {
    mockGetFailedCount.mockResolvedValue(1);
    mockGetFailed.mockResolvedValue([
      makeFailedJob({
        data: {
          orderId: "order-abc",
          stripeAccountId: "acct_secret_123",
          password: "hunter2",
          correlationId: "corr-456",
        },
      }),
    ]);

    const res = await getFailedJobs();
    const body = await res.json();
    const job = body.data.queues.email.jobs[0];

    expect(job.data.orderId).toBe("order-abc");
    expect(job.data.stripeAccountId).toBe("[REDACTED]");
    expect(job.data.password).toBe("[REDACTED]");
    // correlationId is extracted to the top level, not from sanitised data
    expect(job.correlationId).toBe("corr-456");
  });
});

// ─── Test 5 & 6: POST /api/admin/jobs/:id/retry ────────────────────────────

describe("POST /api/admin/jobs/:id/retry", () => {
  const mockRetry = vi.fn().mockResolvedValue(undefined);
  const mockGetState = vi.fn().mockResolvedValue("failed");

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue({
      id: "admin-1",
      email: "admin@test.com",
      isAdmin: true,
      adminRole: "SUPER_ADMIN",
    });
    mockGetJob.mockResolvedValue(null);
    mockRetry.mockResolvedValue(undefined);
    mockGetState.mockResolvedValue("failed");
  });

  function makeRetryRequest(jobId: string, queueName: string) {
    const request = new Request("http://localhost/api/admin/jobs/retry", {
      method: "POST",
      body: JSON.stringify({ queueName }),
      headers: { "Content-Type": "application/json" },
    });
    const params = Promise.resolve({ jobId });
    return { request, params };
  }

  it("moves a failed job back to waiting state", async () => {
    mockGetJob.mockResolvedValue({
      id: "job-42",
      data: { orderId: "order-1", correlationId: "corr-x" },
      getState: mockGetState,
      retry: mockRetry,
    });

    const { request, params } = makeRetryRequest("job-42", "payout");
    const res = await retryJob(request, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      jobId: "job-42",
      queueName: "payout",
    });
    expect(mockRetry).toHaveBeenCalledWith("failed");
  });

  it("returns 404 for unknown job ID", async () => {
    mockGetJob.mockResolvedValue(null);

    const { request, params } = makeRetryRequest("nonexistent", "email");
    const res = await retryJob(request, { params });

    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid queue name", async () => {
    const request = new Request("http://localhost/api/admin/jobs/retry", {
      method: "POST",
      body: JSON.stringify({ queueName: "invalid" }),
      headers: { "Content-Type": "application/json" },
    });
    const params = Promise.resolve({ jobId: "job-1" });
    const res = await retryJob(request, { params });

    expect(res.status).toBe(400);
  });

  it("returns 403 when user lacks permission", async () => {
    mockRequirePermission.mockRejectedValue(new Error("Forbidden"));

    const { request, params } = makeRetryRequest("job-1", "payout");
    const res = await retryJob(request, { params });

    expect(res.status).toBe(403);
  });

  it("returns 400 when job is not in failed state", async () => {
    mockGetJob.mockResolvedValue({
      id: "job-42",
      data: {},
      getState: vi.fn().mockResolvedValue("completed"),
      retry: mockRetry,
    });

    const { request, params } = makeRetryRequest("job-42", "payout");
    const res = await retryJob(request, { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not 'failed'");
  });
});

// ─── Test 7: Sentry alert ───────────────────────────────────────────────────

describe("DLQ — Sentry alert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue({
      id: "admin-1",
      email: "admin@test.com",
      isAdmin: true,
      adminRole: "SUPER_ADMIN",
    });
  });

  it("fires Sentry warning when totalFailed exceeds 10", async () => {
    // 3 failed per queue × 5 queues = 15 total (> 10 threshold)
    mockGetFailedCount.mockResolvedValue(3);
    mockGetFailed.mockResolvedValue([
      makeFailedJob({ id: "j1" }),
      makeFailedJob({ id: "j2" }),
      makeFailedJob({ id: "j3" }),
    ]);

    await getFailedJobs();

    // Wait for the dynamic import("@sentry/nextjs") to resolve
    await new Promise((r) => setTimeout(r, 50));

    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("15 failed jobs"),
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({
          queueCounts: expect.any(Object),
        }),
      }),
    );
  });

  it("does not fire Sentry when totalFailed is 10 or below", async () => {
    // 2 failed per queue × 5 queues = 10 (not > 10)
    mockGetFailedCount.mockResolvedValue(2);
    mockGetFailed.mockResolvedValue([
      makeFailedJob({ id: "j1" }),
      makeFailedJob({ id: "j2" }),
    ]);

    await getFailedJobs();
    await new Promise((r) => setTimeout(r, 50));

    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});
