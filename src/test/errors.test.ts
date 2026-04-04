// src/test/errors.test.ts
// ─── Tests for AppError and safeActionError ─────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError, safeActionError } from "@/shared/errors";

describe("AppError", () => {
  it("creates error with code, message, and statusCode", () => {
    const err = new AppError("VALIDATION_ERROR", "Bad input", 400);

    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("Bad input");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("AppError");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it("defaults statusCode to 400", () => {
    const err = new AppError("VALIDATION_ERROR", "Bad input");
    expect(err.statusCode).toBe(400);
  });

  it("carries optional context", () => {
    const err = new AppError("NOT_FOUND", "Missing", 404, {
      entity: "Order",
    });
    expect(err.context).toEqual({ entity: "Order" });
  });

  // ── Factory methods ──────────────────────────────────────────────────────

  describe("factory methods", () => {
    it("unauthenticated returns 401", () => {
      const err = AppError.unauthenticated();
      expect(err.code).toBe("UNAUTHENTICATED");
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain("sign in");
    });

    it("unauthorised returns 403", () => {
      const err = AppError.unauthorised();
      expect(err.code).toBe("UNAUTHORISED");
      expect(err.statusCode).toBe(403);
    });

    it("unauthorised with custom reason", () => {
      const err = AppError.unauthorised("Only admins can do this");
      expect(err.message).toBe("Only admins can do this");
    });

    it("banned returns 403", () => {
      const err = AppError.banned();
      expect(err.code).toBe("BANNED");
      expect(err.statusCode).toBe(403);
      expect(err.message).toContain("suspended");
    });

    it("notAdmin returns 403", () => {
      const err = AppError.notAdmin();
      expect(err.code).toBe("NOT_ADMIN");
      expect(err.statusCode).toBe(403);
    });

    it("validation returns 400", () => {
      const err = AppError.validation("Field required");
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe("Field required");
    });

    it("notFound returns 404 with entity name", () => {
      const err = AppError.notFound("Listing");
      expect(err.code).toBe("NOT_FOUND");
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe("Listing not found");
    });

    it("missingPaymentIntent returns 400", () => {
      const err = AppError.missingPaymentIntent();
      expect(err.code).toBe("MISSING_PAYMENT_INTENT");
      expect(err.statusCode).toBe(400);
    });

    it("stripeError returns 502", () => {
      const err = AppError.stripeError("Charge failed");
      expect(err.code).toBe("STRIPE_ERROR");
      expect(err.statusCode).toBe(502);
    });

    it("rateLimited returns 429", () => {
      const err = AppError.rateLimited();
      expect(err.code).toBe("RATE_LIMITED");
      expect(err.statusCode).toBe(429);
    });
  });
});

describe("safeActionError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns AppError message directly", () => {
    const err = new AppError("NOT_FOUND", "Order not found", 404);
    expect(safeActionError(err)).toBe("Order not found");
  });

  it("returns fallback for generic errors", () => {
    const err = new Error("Internal crash");
    expect(safeActionError(err)).toBe(
      "Something went wrong. Please try again.",
    );
  });

  it("returns custom fallback when provided", () => {
    const err = new Error("Internal crash");
    expect(safeActionError(err, "Custom fallback")).toBe("Custom fallback");
  });

  it("detects email unique constraint violation", () => {
    const err = new Error("Unique constraint failed on the fields: (`email`)");
    expect(safeActionError(err)).toContain("email already exists");
  });

  it("detects username unique constraint violation", () => {
    const err = new Error(
      "Unique constraint failed on the fields: (`username`)",
    );
    expect(safeActionError(err)).toContain("username is already taken");
  });

  it("detects generic unique constraint violation", () => {
    const err = new Error("Unique constraint failed on the fields: (`slug`)");
    expect(safeActionError(err)).toContain("already exists");
  });

  it("detects foreign key constraint violation", () => {
    const err = new Error("Foreign key constraint failed on the field");
    expect(safeActionError(err)).toContain("no longer exists");
  });

  it("detects connection refused errors", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    expect(safeActionError(err)).toContain("trouble connecting");
  });

  it("detects DNS resolution errors", () => {
    const err = new Error("getaddrinfo ENOTFOUND db.example.com");
    expect(safeActionError(err)).toContain("trouble connecting");
  });

  it("detects fetch failures", () => {
    const err = new Error("fetch failed");
    expect(safeActionError(err)).toContain("trouble connecting");
  });

  it("detects timeout errors", () => {
    const err = new Error("ETIMEDOUT");
    expect(safeActionError(err)).toContain("took too long");
  });

  it("detects generic timeout", () => {
    const err = new Error("Request Timeout");
    expect(safeActionError(err)).toContain("took too long");
  });

  it("handles non-Error thrown values", () => {
    expect(safeActionError("string error")).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
