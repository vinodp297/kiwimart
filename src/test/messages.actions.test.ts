// src/test/messages.actions.test.ts
// ─── Tests: Message Server Actions ──────────────────────────────────────────
// Covers all three exported actions in src/server/actions/messages.ts:
//   sendMessage       — Zod validation, rate limit, delegation, fire-and-forget metrics
//   getMyThreads      — auth-guarded thread list, swallow-on-error
//   getThreadMessages — auth-guarded message list, pagination options, swallow-on-error

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock messageService ───────────────────────────────────────────────────────
const mockSendMessage = vi.fn();
const mockGetMyThreads = vi.fn();
const mockGetThreadMessages = vi.fn();

vi.mock("@/modules/messaging/message.service", () => ({
  messageService: {
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    getMyThreads: (...args: unknown[]) => mockGetMyThreads(...args),
    getThreadMessages: (...args: unknown[]) => mockGetThreadMessages(...args),
  },
}));

// ── Mock seller response metrics (fire-and-forget side-effect) ────────────────
const mockUpdateSellerResponseMetrics = vi.fn().mockResolvedValue(undefined);
vi.mock("@/modules/sellers/response-metrics.service", () => ({
  updateSellerResponseMetrics: (...args: unknown[]) =>
    mockUpdateSellerResponseMetrics(...args),
}));

// ── Mock fire-and-forget so it awaits the promise synchronously ───────────────
vi.mock("@/lib/fire-and-forget", () => ({
  fireAndForget: (p: Promise<unknown>) => {
    // Swallow errors like the real impl but don't block tests
    if (p && typeof (p as Promise<unknown>).catch === "function") {
      void (p as Promise<unknown>).catch(() => undefined);
    }
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { sendMessage, getMyThreads, getThreadMessages } =
  await import("@/server/actions/messages");
const { rateLimit } = await import("@/server/lib/rateLimit");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_USER = {
  id: "user_buyer",
  email: "buyer@test.com",
  isAdmin: false,
};

const validSendInput = {
  recipientId: "user_seller",
  body: "Hi, is this still available?",
};

// ─────────────────────────────────────────────────────────────────────────────
// sendMessage
// ─────────────────────────────────────────────────────────────────────────────

describe("sendMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockSendMessage.mockResolvedValue({
      messageId: "msg_1",
      threadId: "thread_1",
    });
  });

  it("unauthenticated → returns safe error and does not call service", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await sendMessage(validSendInput);

    expect(result.success).toBe(false);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("invalid input (missing recipientId) → returns validation error with fieldErrors", async () => {
    const result = await sendMessage({ body: "hello" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/invalid/i);
      expect(result.fieldErrors).toBeDefined();
      expect(result.fieldErrors?.recipientId).toBeDefined();
    }
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("invalid input (empty body) → returns validation error", async () => {
    const result = await sendMessage({
      recipientId: "user_seller",
      body: "",
    });

    expect(result.success).toBe(false);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("invalid input (body too long) → returns validation error", async () => {
    const result = await sendMessage({
      recipientId: "user_seller",
      body: "a".repeat(1001),
    });

    expect(result.success).toBe(false);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("rate limit exceeded → returns user-facing wait message", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 30,
    });

    const result = await sendMessage(validSendInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too quickly|wait/i);
    }
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("happy path → returns messageId and threadId from service", async () => {
    const result = await sendMessage(validSendInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.messageId).toBe("msg_1");
      expect(result.data.threadId).toBe("thread_1");
    }
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "user_seller",
        body: "Hi, is this still available?",
      }),
      TEST_USER.id,
      TEST_USER.email,
    );
  });

  it("happy path also fires seller response metrics update", async () => {
    await sendMessage(validSendInput);

    expect(mockUpdateSellerResponseMetrics).toHaveBeenCalledWith(TEST_USER.id);
  });

  it("passes optional threadId and listingId through to service", async () => {
    await sendMessage({
      ...validSendInput,
      threadId: "thread_existing",
      listingId: "listing_1",
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread_existing",
        listingId: "listing_1",
      }),
      TEST_USER.id,
      TEST_USER.email,
    );
  });

  it("service throws → returns safe fallback error (does not leak)", async () => {
    mockSendMessage.mockRejectedValueOnce(
      new Error("ECONNREFUSED 127.0.0.1:5432"),
    );

    const result = await sendMessage(validSendInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
      // Must not leak raw connection error
      expect(result.error).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getMyThreads
// ─────────────────────────────────────────────────────────────────────────────

describe("getMyThreads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockGetMyThreads.mockResolvedValue([]);
  });

  it("unauthenticated → returns empty array (silent)", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await getMyThreads();

    expect(result).toEqual([]);
    expect(mockGetMyThreads).not.toHaveBeenCalled();
  });

  it("happy path with no threads → returns empty array", async () => {
    const result = await getMyThreads();

    expect(result).toEqual([]);
    expect(mockGetMyThreads).toHaveBeenCalledWith(TEST_USER.id);
  });

  it("happy path with threads → returns service payload unchanged", async () => {
    const threads = [
      { id: "thread_1", lastMessageAt: new Date().toISOString() },
      { id: "thread_2", lastMessageAt: new Date().toISOString() },
    ];
    mockGetMyThreads.mockResolvedValueOnce(threads);

    const result = await getMyThreads();

    expect(result).toEqual(threads);
  });

  it("service throws → swallows error and returns empty array", async () => {
    mockGetMyThreads.mockRejectedValueOnce(new Error("DB offline"));

    const result = await getMyThreads();

    expect(result).toEqual([]);
  });

  it("scopes lookup to authenticated user id", async () => {
    mockRequireUser.mockResolvedValueOnce({
      ...TEST_USER,
      id: "user_other",
    });

    await getMyThreads();

    expect(mockGetMyThreads).toHaveBeenCalledWith("user_other");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getThreadMessages
// ─────────────────────────────────────────────────────────────────────────────

describe("getThreadMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockGetThreadMessages.mockResolvedValue({
      messages: [],
      hasMore: false,
    });
  });

  it("unauthenticated → returns empty page (silent)", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await getThreadMessages("thread_1");

    expect(result).toEqual({ messages: [], hasMore: false });
    expect(mockGetThreadMessages).not.toHaveBeenCalled();
  });

  it("happy path → delegates threadId and user id to service", async () => {
    const result = await getThreadMessages("thread_1");

    expect(result.messages).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(mockGetThreadMessages).toHaveBeenCalledWith(
      "thread_1",
      TEST_USER.id,
      undefined,
    );
  });

  it("passes pagination options (take, cursor) through to service", async () => {
    await getThreadMessages("thread_1", { take: 25, cursor: "msg_50" });

    expect(mockGetThreadMessages).toHaveBeenCalledWith(
      "thread_1",
      TEST_USER.id,
      { take: 25, cursor: "msg_50" },
    );
  });

  it("returns service payload including message items and hasMore flag", async () => {
    const messages = [
      { id: "msg_1", body: "Hi" },
      { id: "msg_2", body: "Hello" },
    ];
    mockGetThreadMessages.mockResolvedValueOnce({
      messages,
      hasMore: true,
    });

    const result = await getThreadMessages("thread_1");

    expect(result.messages).toEqual(messages);
    expect(result.hasMore).toBe(true);
  });

  it("service throws → swallows error and returns empty page", async () => {
    mockGetThreadMessages.mockRejectedValueOnce(new Error("Timeout"));

    const result = await getThreadMessages("thread_1");

    expect(result).toEqual({ messages: [], hasMore: false });
  });
});
