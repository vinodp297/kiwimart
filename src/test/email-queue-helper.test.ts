// src/test/email-queue-helper.test.ts
// ─── Unit Tests: enqueueEmail helper + emailWorker dispatch ──────────────────
// Tests the REAL enqueueEmail function (not the mock used elsewhere).
// No setup.ts import — all mocks are declared here for complete isolation.
//
// Covers:
//   5. Redis unavailable — enqueueEmail falls back to direct sync send
//   6. Email job data includes correlationId from request context
//   7. emailWorker processes passwordReset template correctly
//   8. emailWorker processes verification template correctly
//   9. emailWorker does not start when VERCEL env var is set
//  10. enqueueEmail does NOT throw if both queue and fallback fail

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vitest.config.ts applies setup.ts globally via setupFiles, which mocks
// @/lib/email-queue with a stub.  This file tests the REAL enqueueEmail, so
// we must unmock it before any imports run.
vi.unmock("@/lib/email-queue");

// ── Hoisted mocks (referenced inside vi.mock factories) ───────────────────────
const {
  mockEmailQueueAdd,
  mockGetRequestContext,
  mockSendVerificationEmail,
  mockSendWelcomeEmail,
  mockSendPasswordResetEmail,
  mockSendDataExportEmail,
  mockSendErasureConfirmationEmail,
  mockSendErasureRequestEmail,
  mockSendAdminIdVerificationEmail,
  mockSendOfferReceivedEmail,
  mockSendOfferResponseEmail,
  mockSendOrderDispatchedEmail,
  mockSendDisputeOpenedEmail,
  mockWorkerJobHandler,
} = vi.hoisted(() => ({
  mockEmailQueueAdd: vi.fn(),
  mockGetRequestContext: vi.fn(),
  mockSendVerificationEmail: vi.fn(),
  mockSendWelcomeEmail: vi.fn(),
  mockSendPasswordResetEmail: vi.fn(),
  mockSendDataExportEmail: vi.fn(),
  mockSendErasureConfirmationEmail: vi.fn(),
  mockSendErasureRequestEmail: vi.fn(),
  mockSendAdminIdVerificationEmail: vi.fn(),
  mockSendOfferReceivedEmail: vi.fn(),
  mockSendOfferResponseEmail: vi.fn(),
  mockSendOrderDispatchedEmail: vi.fn(),
  mockSendDisputeOpenedEmail: vi.fn(),
  mockWorkerJobHandler: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/queue", () => ({
  emailQueue: {
    add: (...args: unknown[]) => mockEmailQueueAdd(...args),
  },
  payoutQueue: { add: vi.fn() },
  getQueueConnection: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/request-context", () => ({
  getRequestContext: () => mockGetRequestContext(),
  // runWithRequestContext is used by emailWorker — pass through to fn() directly
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

vi.mock("@/shared/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/server/email", () => ({
  sendVerificationEmail: (...args: unknown[]) =>
    mockSendVerificationEmail(...args),
  sendWelcomeEmail: (...args: unknown[]) => mockSendWelcomeEmail(...args),
  sendPasswordResetEmail: (...args: unknown[]) =>
    mockSendPasswordResetEmail(...args),
  sendDataExportEmail: (...args: unknown[]) => mockSendDataExportEmail(...args),
  sendErasureConfirmationEmail: (...args: unknown[]) =>
    mockSendErasureConfirmationEmail(...args),
  sendErasureRequestEmail: (...args: unknown[]) =>
    mockSendErasureRequestEmail(...args),
  sendAdminIdVerificationEmail: (...args: unknown[]) =>
    mockSendAdminIdVerificationEmail(...args),
  sendOfferReceivedEmail: (...args: unknown[]) =>
    mockSendOfferReceivedEmail(...args),
  sendOfferResponseEmail: (...args: unknown[]) =>
    mockSendOfferResponseEmail(...args),
  sendOrderDispatchedEmail: (...args: unknown[]) =>
    mockSendOrderDispatchedEmail(...args),
  sendOrderCompleteBuyerEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderCompleteSellerEmail: vi.fn().mockResolvedValue(undefined),
  sendDisputeOpenedEmail: (...args: unknown[]) =>
    mockSendDisputeOpenedEmail(...args),
  sendPayoutInitiatedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/lib/audit", () => ({
  audit: vi.fn(),
}));

// BullMQ Worker mock — captures the job handler so we can invoke it in tests.
// Uses regular functions (not arrow functions) to avoid the Vitest constructor
// warning: "The vi.fn() mock did not use 'function' or 'class'".
vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(function (
    _name: string,
    handler: unknown,
  ) {
    // Store the handler so tests can call it directly
    mockWorkerJobHandler.mockImplementation(
      handler as (...args: unknown[]) => unknown,
    );
    return { on: vi.fn() };
  }),
  Queue: vi.fn().mockImplementation(function () {
    return { add: vi.fn(), on: vi.fn() };
  }),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

const { enqueueEmail } = await import("@/lib/email-queue");

// ─── Tests: enqueueEmail fallback behaviour ───────────────────────────────────

describe("enqueueEmail — Redis fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Clear call counts; preserve mock implementations
    mockEmailQueueAdd.mockResolvedValue({ id: "job-1" }); // Default: queue succeeds
    mockGetRequestContext.mockReturnValue({ correlationId: "corr-test-123" });
    // Default: all email functions resolve
    mockSendVerificationEmail.mockResolvedValue(undefined);
    mockSendWelcomeEmail.mockResolvedValue(undefined);
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    mockSendDataExportEmail.mockResolvedValue(undefined);
    mockSendErasureConfirmationEmail.mockResolvedValue(undefined);
  });

  // Test 5
  it("falls back to direct send when Redis (emailQueue.add) rejects", async () => {
    mockEmailQueueAdd.mockRejectedValue(new Error("ECONNREFUSED — Redis down"));

    await enqueueEmail({
      template: "welcome",
      to: "user@buyzi.test",
      displayName: "Test User",
    });

    // Direct email function should have been called as fallback
    expect(mockSendWelcomeEmail).toHaveBeenCalledWith({
      to: "user@buyzi.test",
      displayName: "Test User",
    });
  });

  it("falls back to passwordReset direct send when Redis is down", async () => {
    mockEmailQueueAdd.mockRejectedValue(new Error("Redis unavailable"));

    await enqueueEmail({
      template: "passwordReset",
      to: "user@buyzi.test",
      displayName: "Test User",
      resetUrl: "https://buyzi.co.nz/reset?token=abc",
      expiresInMinutes: 60,
    });

    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith({
      to: "user@buyzi.test",
      displayName: "Test User",
      resetUrl: "https://buyzi.co.nz/reset?token=abc",
      expiresInMinutes: 60,
    });
  });

  it("falls back to verification direct send when Redis is down", async () => {
    mockEmailQueueAdd.mockRejectedValue(new Error("Redis down"));

    await enqueueEmail({
      template: "verification",
      to: "user@buyzi.test",
      displayName: "Test User",
      verifyUrl: "https://buyzi.co.nz/api/verify-email?token=xyz",
    });

    expect(mockSendVerificationEmail).toHaveBeenCalledWith({
      to: "user@buyzi.test",
      displayName: "Test User",
      verifyUrl: "https://buyzi.co.nz/api/verify-email?token=xyz",
    });
  });

  // Test 10
  it("does NOT throw if both queue and fallback fail", async () => {
    mockEmailQueueAdd.mockRejectedValue(new Error("Redis down"));
    mockSendWelcomeEmail.mockRejectedValue(new Error("Resend down"));

    // Core operation must never fail because email infrastructure is down
    await expect(
      enqueueEmail({
        template: "welcome",
        to: "user@buyzi.test",
        displayName: "Test User",
      }),
    ).resolves.not.toThrow();
  });

  it("does NOT call fallback when queue succeeds", async () => {
    // Queue succeeds (default mock)
    await enqueueEmail({
      template: "welcome",
      to: "user@buyzi.test",
      displayName: "Test User",
    });

    // No direct send when queue works
    expect(mockSendWelcomeEmail).not.toHaveBeenCalled();
  });
});

// ─── Test 6: correlationId in job data ───────────────────────────────────────

describe("enqueueEmail — job data shape", () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Clear call counts; preserve mock implementations
    mockEmailQueueAdd.mockResolvedValue({ id: "job-2" });
  });

  it("includes correlationId from request context in job payload", async () => {
    mockGetRequestContext.mockReturnValue({ correlationId: "corr-abc-123" });

    await enqueueEmail({
      template: "passwordReset",
      to: "user@buyzi.test",
      displayName: "Test User",
      resetUrl: "https://buyzi.co.nz/reset?token=tok",
      expiresInMinutes: 60,
    });

    expect(mockEmailQueueAdd).toHaveBeenCalledWith(
      "send-email",
      expect.objectContaining({ correlationId: "corr-abc-123" }),
      expect.anything(),
    );
  });

  it("correlationId is undefined when outside request context", async () => {
    mockGetRequestContext.mockReturnValue(undefined);

    await enqueueEmail({
      template: "welcome",
      to: "user@buyzi.test",
      displayName: "Test User",
    });

    expect(mockEmailQueueAdd).toHaveBeenCalledWith(
      "send-email",
      expect.objectContaining({ correlationId: undefined }),
      expect.anything(),
    );
  });

  it("includes enqueuedAt ISO timestamp in job payload", async () => {
    mockGetRequestContext.mockReturnValue({ correlationId: "corr-1" });

    await enqueueEmail({
      template: "welcome",
      to: "user@buyzi.test",
      displayName: "Test User",
    });

    expect(mockEmailQueueAdd).toHaveBeenCalledWith(
      "send-email",
      expect.objectContaining({ enqueuedAt: expect.any(String) }),
      expect.anything(),
    );

    const call = mockEmailQueueAdd.mock.calls[0];
    const payload = call?.[1] as Record<string, unknown>;
    // Should be a valid ISO date string
    expect(
      new Date(payload?.enqueuedAt as string).getFullYear(),
    ).toBeGreaterThan(2020);
  });

  it("calls emailQueue.add with job name 'send-email'", async () => {
    mockGetRequestContext.mockReturnValue({ correlationId: "corr-1" });

    await enqueueEmail({
      template: "verification",
      to: "user@buyzi.test",
      displayName: "Test User",
      verifyUrl: "https://buyzi.co.nz/verify?token=t",
    });

    const [jobName] = mockEmailQueueAdd.mock.calls[0] ?? [];
    expect(jobName).toBe("send-email");
  });
});

// ─── Tests 7–9: emailWorker dispatch ─────────────────────────────────────────

describe("emailWorker — template routing", () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Clear call counts; preserve Worker constructor mock
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    mockSendVerificationEmail.mockResolvedValue(undefined);
    mockGetRequestContext.mockReturnValue({ correlationId: "corr-worker" });
    delete process.env.VERCEL;
  });

  afterEach(() => {
    delete process.env.VERCEL;
  });

  // Test 7
  it("processes passwordReset template by calling sendPasswordResetEmail", async () => {
    const { startEmailWorker } = await import("@/server/workers/emailWorker");
    startEmailWorker();

    // The BullMQ Worker constructor captures the handler via our mock
    await mockWorkerJobHandler({
      id: "job-worker-1",
      data: {
        template: "passwordReset",
        to: "user@buyzi.test",
        displayName: "Test User",
        resetUrl: "https://buyzi.co.nz/reset?token=t1",
        expiresInMinutes: 60,
        correlationId: "corr-worker",
      },
    });

    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith({
      to: "user@buyzi.test",
      displayName: "Test User",
      resetUrl: "https://buyzi.co.nz/reset?token=t1",
      expiresInMinutes: 60,
    });
  });

  // Test 8
  it("processes verification template by calling sendVerificationEmail", async () => {
    const { startEmailWorker } = await import("@/server/workers/emailWorker");
    startEmailWorker();

    await mockWorkerJobHandler({
      id: "job-worker-2",
      data: {
        template: "verification",
        to: "newuser@buyzi.test",
        displayName: "New User",
        verifyUrl: "https://buyzi.co.nz/api/verify-email?token=t2",
        correlationId: "corr-worker-2",
      },
    });

    expect(mockSendVerificationEmail).toHaveBeenCalledWith({
      to: "newuser@buyzi.test",
      displayName: "New User",
      verifyUrl: "https://buyzi.co.nz/api/verify-email?token=t2",
    });
  });

  it("processes welcome template by calling sendWelcomeEmail", async () => {
    mockSendWelcomeEmail.mockResolvedValue(undefined);
    const { startEmailWorker } = await import("@/server/workers/emailWorker");
    startEmailWorker();

    await mockWorkerJobHandler({
      id: "job-worker-3",
      data: {
        template: "welcome",
        to: "welcome@buyzi.test",
        displayName: "Welcome User",
        correlationId: "corr-3",
      },
    });

    expect(mockSendWelcomeEmail).toHaveBeenCalledWith({
      to: "welcome@buyzi.test",
      displayName: "Welcome User",
    });
  });

  // Test 9
  it("does not start worker when VERCEL env var is set", async () => {
    process.env.VERCEL = "1";
    vi.resetModules();
    const { startEmailWorker } = await import("@/server/workers/emailWorker");

    const result = startEmailWorker();

    expect(result).toBeUndefined();
  });
});
