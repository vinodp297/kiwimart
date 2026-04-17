// src/test/action-result.test.ts
// ─── Tests: ActionResult<T> helpers (ok / fail / fromError) ─────────────────

import { describe, it, expect } from "vitest";
import { ok, fail, fromError } from "@/shared/types/action-result";
import { AppError } from "@/shared/errors";

describe("ok()", () => {
  it("no-arg call returns success with undefined data", () => {
    const result = ok();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeUndefined();
    }
  });

  it("with data returns success envelope", () => {
    const result = ok({ id: "x" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: "x" });
    }
  });
});

describe("fail()", () => {
  it("returns failure envelope with error message", () => {
    const result = fail("Something went wrong");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Something went wrong");
      expect(result.code).toBeUndefined();
    }
  });

  it("preserves optional error code", () => {
    const result = fail("Unauthorised", "AUTH_REQUIRED");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("AUTH_REQUIRED");
    }
  });
});

describe("fromError()", () => {
  it("AppError → uses message + code", () => {
    const err = new AppError("NOT_FOUND", "Listing missing", 404);
    const result = fromError(err);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Listing missing");
      expect(result.code).toBe("NOT_FOUND");
    }
  });

  it("plain Error → uses message only (no code)", () => {
    const err = new Error("Generic failure");
    const result = fromError(err);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Generic failure");
    }
  });

  it("unknown value → generic fallback message", () => {
    const result = fromError("not an Error");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("An unexpected error occurred");
    }
  });

  it("unknown value: null", () => {
    const result = fromError(null);
    expect(result.success).toBe(false);
  });
});
