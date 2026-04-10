// src/test/stripe-timeout.test.ts
// ─── Unit tests for withStripeTimeout() ──────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../test/setup";
import { AppError } from "@/shared/errors";

vi.mock("@/shared/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

const { withStripeTimeout } =
  await import("@/infrastructure/stripe/with-timeout");
const { logger } = await import("@/shared/logger");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("withStripeTimeout", () => {
  it("resolves with the operation's return value when it completes in time", async () => {
    const result = await withStripeTimeout(
      () => Promise.resolve({ id: "pi_123" }),
      "paymentIntents.create",
      500,
    );

    expect(result).toEqual({ id: "pi_123" });
  });

  it("throws PAYMENT_GATEWAY_TIMEOUT when the operation exceeds the deadline", async () => {
    vi.useFakeTimers();

    const slowOp = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("never")), 30_000),
    );

    const racePromise = withStripeTimeout(
      () => slowOp,
      "paymentIntents.create",
      100,
    );

    vi.advanceTimersByTime(200);

    await expect(racePromise).rejects.toMatchObject({
      code: "PAYMENT_GATEWAY_TIMEOUT",
      statusCode: 503,
    });
  });

  it("logs stripe.timeout when the deadline fires", async () => {
    vi.useFakeTimers();

    const neverResolves = new Promise<never>(() => {});
    const racePromise = withStripeTimeout(
      () => neverResolves,
      "transfers.create",
      50,
    );

    vi.advanceTimersByTime(100);

    await expect(racePromise).rejects.toBeInstanceOf(AppError);

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "stripe.timeout",
      expect.objectContaining({ operationName: "transfers.create" }),
    );
  });

  it("re-throws a non-timeout Stripe error unchanged", async () => {
    const stripeError = Object.assign(new Error("Your card was declined."), {
      type: "card_error",
      code: "card_declined",
    });

    await expect(
      withStripeTimeout(
        () => Promise.reject(stripeError),
        "paymentIntents.capture",
        500,
      ),
    ).rejects.toThrow("Your card was declined.");

    // Must NOT log stripe.timeout for a plain Stripe error
    expect(vi.mocked(logger.error)).not.toHaveBeenCalledWith(
      "stripe.timeout",
      expect.anything(),
    );
  });

  it("re-throws an AppError from a nested call without wrapping it", async () => {
    const appErr = new AppError("PAYMENT_GATEWAY_ERROR", "Gateway error", 502);

    const thrown = await withStripeTimeout(
      () => Promise.reject(appErr),
      "refunds.create",
      500,
    ).catch((e: unknown) => e);

    expect(thrown).toBe(appErr);
    expect((thrown as AppError).code).toBe("PAYMENT_GATEWAY_ERROR");
  });
});
