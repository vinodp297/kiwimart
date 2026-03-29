// src/shared/errors/index.ts
// ─── Typed Error Classes ──────────────────────────────────────────────────────
// AppError carries structured information (code, statusCode, context) so errors
// can be handled programmatically rather than by string matching.

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "UNAUTHORISED"
  | "BANNED"
  | "NOT_ADMIN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "LISTING_NOT_AVAILABLE"
  | "SELLER_NOT_CONFIGURED"
  | "ORDER_NOT_FOUND"
  | "ORDER_WRONG_STATE"
  | "MISSING_PAYMENT_INTENT"
  | "PAYMENT_FAILED"
  | "STRIPE_ERROR"
  | "RATE_LIMITED"
  | "MESSAGE_FLAGGED"
  | "DATABASE_ERROR"
  | "QUEUE_ERROR"
  | "STORAGE_ERROR"
  | "EMAIL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number = 400,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    // Maintains proper prototype chain in TypeScript
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static unauthenticated(): AppError {
    return new AppError("UNAUTHENTICATED", "Please sign in to continue", 401);
  }

  static unauthorised(reason?: string): AppError {
    return new AppError(
      "UNAUTHORISED",
      reason ?? "You do not have permission to do this",
      403,
    );
  }

  static banned(): AppError {
    return new AppError(
      "BANNED",
      "Your account has been suspended. Contact support@kiwimart.co.nz for help.",
      403,
    );
  }

  static notAdmin(): AppError {
    return new AppError("NOT_ADMIN", "Admin access required", 403);
  }

  static validation(message: string): AppError {
    return new AppError("VALIDATION_ERROR", message, 400);
  }

  static notFound(entity: string): AppError {
    return new AppError("NOT_FOUND", `${entity} not found`, 404);
  }

  static missingPaymentIntent(): AppError {
    return new AppError(
      "MISSING_PAYMENT_INTENT",
      "Payment reference missing. Contact support@kiwimart.co.nz",
      400,
    );
  }

  static stripeError(message: string): AppError {
    return new AppError("STRIPE_ERROR", message, 502);
  }

  static rateLimited(): AppError {
    return new AppError(
      "RATE_LIMITED",
      "Too many requests. Please wait before trying again.",
      429,
    );
  }
}

// ── Safe error message helper ─────────────────────────────────────────────
// Returns the error message for user-facing AppErrors, and a generic safe
// message for everything else (Prisma, system, network errors).  The full
// error is always logged server-side so it can be investigated.

export function safeActionError(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  // AppError messages are designed to be user-facing — surface them.
  if (err instanceof AppError) return err.message;

  // Everything else: log the real error server-side, return a safe generic.
  // Use console.error here (not logger) so there's zero risk of a circular
  // import — server actions import this file before logger is initialised.
  const rawMsg = err instanceof Error ? err.message : String(err);
  console.error("[safeActionError]", rawMsg);

  // Detect common Prisma / DB errors and return helpful user-facing messages
  // instead of leaking technical stack traces.
  if (rawMsg.includes("Unique constraint") && rawMsg.includes("email")) {
    return "An account with this email already exists. Try signing in instead.";
  }
  if (rawMsg.includes("Unique constraint") && rawMsg.includes("username")) {
    return "This username is already taken. Please choose a different one.";
  }
  if (rawMsg.includes("Unique constraint")) {
    return "A record with this information already exists.";
  }
  if (rawMsg.includes("Foreign key constraint")) {
    return "This action references data that no longer exists. Please refresh and try again.";
  }
  if (
    rawMsg.includes("ECONNREFUSED") ||
    rawMsg.includes("ENOTFOUND") ||
    rawMsg.includes("fetch failed")
  ) {
    return "We're having trouble connecting to our servers. Please check your internet connection and try again.";
  }
  if (
    rawMsg.includes("ETIMEDOUT") ||
    rawMsg.includes("timeout") ||
    rawMsg.includes("Timeout")
  ) {
    return "The request took too long. Please try again in a moment.";
  }

  return fallback;
}
