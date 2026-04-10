// src/test/fire-and-forget.test.ts
// ─── fireAndForget utility ────────────────────────────────────────────────────
// Verifies that rejected promises are logged and do not propagate.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/redis/client", () => ({ getRedisClient: vi.fn() }));
vi.mock("@/lib/request-context", () => ({
  getRequestContext: vi.fn().mockReturnValue(null),
}));

const mockLoggerError = vi.fn();
vi.mock("@/shared/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
    fatal: vi.fn(),
  },
}));

import { fireAndForget } from "@/lib/fire-and-forget";

describe("fireAndForget", () => {
  beforeEach(() => {
    mockLoggerError.mockClear();
  });

  // 1. Calls logger.error on rejection
  it("calls logger.error when the promise rejects", async () => {
    const boom = Promise.reject(new Error("network timeout"));
    fireAndForget(boom, "notification.send");

    // Yield to the microtask queue so the catch handler runs
    await Promise.resolve();

    expect(mockLoggerError).toHaveBeenCalledOnce();
  });

  // 2. Does not throw on rejection
  it("does not throw or propagate a rejected promise", async () => {
    const boom = Promise.reject(new Error("silent failure"));
    expect(() => fireAndForget(boom, "metrics.record")).not.toThrow();

    // Drain microtasks — must still not throw
    await Promise.resolve();
    expect(mockLoggerError).toHaveBeenCalledOnce();
  });

  // 3. Context string appears in the logged event name
  it("includes the context string in the logged event name", async () => {
    const boom = Promise.reject(new Error("oops"));
    fireAndForget(boom, "email.welcome");

    await Promise.resolve();

    const [event] = mockLoggerError.mock.calls[0] as [string, ...unknown[]];
    expect(event).toContain("email.welcome");
  });
});
