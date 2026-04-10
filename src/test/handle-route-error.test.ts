// src/test/handle-route-error.test.ts
// ─── Unit tests for handleRouteError() ───────────────────────────────────────

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

const { handleRouteError } = await import("@/server/lib/handle-route-error");
const { logger } = await import("@/shared/logger");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleRouteError", () => {
  it("AppError → returns the error's own status code", async () => {
    const err = new AppError("NOT_FOUND", "Listing not found", 404);
    const response = handleRouteError(err, { path: "/api/v1/listings/123" });

    expect(response.status).toBe(404);
  });

  it("AppError → response body includes the error code", async () => {
    const err = new AppError("VALIDATION_ERROR", "Bad input", 400);
    const response = handleRouteError(err, { path: "/api/v1/foo" });

    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("AppError → logs as warn, not error", () => {
    const err = new AppError("UNAUTHORISED", "No permission", 403);
    handleRouteError(err, { path: "/api/v1/admin" });

    expect(vi.mocked(logger.warn)).toHaveBeenCalledOnce();
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
  });

  it("unknown error → returns 500", async () => {
    const response = handleRouteError(new Error("boom"), {
      path: "/api/v1/foo",
    });

    expect(response.status).toBe(500);
  });

  it("unknown error → logs as error, not warn", () => {
    handleRouteError(new TypeError("unexpected"), { path: "/api/v1/foo" });

    expect(vi.mocked(logger.error)).toHaveBeenCalledOnce();
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("context fields appear in the log output", () => {
    const err = new AppError("DATABASE_ERROR", "Query failed", 500);
    handleRouteError(err, { path: "/api/v1/orders", requestId: "req_abc" });

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      "route.app_error",
      expect.objectContaining({
        path: "/api/v1/orders",
        requestId: "req_abc",
        code: "DATABASE_ERROR",
      }),
    );
  });
});
