// src/infrastructure/stripe/with-timeout.ts
// ─── Stripe call timeout wrapper ──────────────────────────────────────────────
// Races every Stripe API call against a deadline. If Stripe does not respond
// within `timeoutMs` (default 8 s), throws AppError("PAYMENT_GATEWAY_TIMEOUT")
// so the caller can surface a 503 immediately rather than hanging the request.
//
// Usage:
//   const intent = await withStripeTimeout(
//     () => stripe.paymentIntents.create(data),
//     "paymentIntents.create",
//   );

import { AppError } from "@/shared/errors";
import { logger } from "@/shared/logger";

const TIMEOUT_MARKER = "StripeOperationTimeout";

export async function withStripeTimeout<T>(
  operation: () => Promise<T>,
  operationName: string,
  timeoutMs = 8_000,
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      reject(new Error(`${TIMEOUT_MARKER}:${operationName}`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([operation(), timeoutPromise]);
    clearTimeout(timerId);
    return result;
  } catch (err) {
    clearTimeout(timerId);

    // Let AppErrors (e.g., a nested withStripeTimeout call) pass straight through
    if (err instanceof AppError) throw err;

    // Detect our own timeout sentinel
    if (err instanceof Error && err.message.startsWith(TIMEOUT_MARKER)) {
      logger.error("stripe.timeout", { operationName, timeoutMs });
      throw new AppError(
        "PAYMENT_GATEWAY_TIMEOUT",
        "Payment gateway timed out. Please try again.",
        503,
      );
    }

    // Any other Stripe / network error — let the caller's catch block handle it
    throw err;
  }
}
