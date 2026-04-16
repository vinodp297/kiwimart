// src/test/typing.actions.test.ts
// ─── Tests: Typing Indicator Server Action ──────────────────────────────────
// triggerTyping fires a Pusher event when user is typing in a thread.
// Self-send is blocked; all errors are silently swallowed (non-critical).

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { triggerTyping } = await import("@/server/actions/typing");
const { getPusherServer } = await import("@/lib/pusher");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_USER = {
  id: "user_me",
  email: "me@test.com",
  isAdmin: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// triggerTyping
// ─────────────────────────────────────────────────────────────────────────────

describe("triggerTyping", () => {
  const mockTrigger = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockTrigger.mockResolvedValue({});
    mockRequireUser.mockResolvedValue(TEST_USER);
    vi.mocked(getPusherServer).mockReturnValue({
      trigger: mockTrigger,
    } as never);
  });

  it("unauthenticated → swallows and returns void (no throw)", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await triggerTyping({
      recipientId: "user_other",
      threadId: "thread_1",
    });

    expect(result).toBeUndefined();
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it("self-send (recipientId === user.id) → skips pusher trigger", async () => {
    await triggerTyping({
      recipientId: TEST_USER.id,
      threadId: "thread_1",
    });

    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it("happy path → triggers pusher on private-user channel", async () => {
    await triggerTyping({
      recipientId: "user_other",
      threadId: "thread_abc",
    });

    expect(mockTrigger).toHaveBeenCalledWith(
      "private-user-user_other",
      "typing",
      expect.objectContaining({
        threadId: "thread_abc",
        userId: TEST_USER.id,
      }),
    );
  });

  it("userName derives from email local-part (before @)", async () => {
    await triggerTyping({
      recipientId: "user_other",
      threadId: "thread_1",
    });

    expect(mockTrigger).toHaveBeenCalledWith(
      expect.anything(),
      "typing",
      expect.objectContaining({ userName: "me" }),
    );
  });

  it("pusher.trigger throws → silently swallowed (non-critical)", async () => {
    mockTrigger.mockRejectedValueOnce(new Error("Pusher 503"));

    // Should NOT throw
    await expect(
      triggerTyping({
        recipientId: "user_other",
        threadId: "thread_1",
      }),
    ).resolves.toBeUndefined();
  });

  it("channel scoped to recipient user id", async () => {
    await triggerTyping({
      recipientId: "user_xyz",
      threadId: "thread_1",
    });

    expect(mockTrigger).toHaveBeenCalledWith(
      "private-user-user_xyz",
      expect.anything(),
      expect.anything(),
    );
  });

  it("returns void even on success (fire-and-forget contract)", async () => {
    const result = await triggerTyping({
      recipientId: "user_other",
      threadId: "thread_1",
    });

    expect(result).toBeUndefined();
  });
});
