// src/test/client-logger.test.ts
// ─── Client Error Logger Tests ────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module-level fetch mock ──────────────────────────────────────────────────

const mockFetch = vi.fn();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Import (or re-import) the module under a specific NODE_ENV */
async function importLogger(env: "development" | "production") {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", env);
  // Provide a global fetch stub before each import so the module captures it.
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  return import("@/lib/client-logger");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sanitiseClientContext", () => {
  it("redacts known PII keys", async () => {
    const { sanitiseClientContext } = await importLogger("production");
    const result = sanitiseClientContext({
      email: "user@example.com",
      status: 404,
      errorCode: "NOT_FOUND",
      password: "s3cr3t",
      phone: "021 000 0000",
    });
    expect(result.email).toBe("[redacted]");
    expect(result.password).toBe("[redacted]");
    expect(result.phone).toBe("[redacted]");
    // Non-PII keys pass through unchanged
    expect(result.status).toBe(404);
    expect(result.errorCode).toBe("NOT_FOUND");
  });

  it("redacts keys containing PII substrings (case-insensitive)", async () => {
    const { sanitiseClientContext } = await importLogger("production");
    const result = sanitiseClientContext({
      userEmail: "x@y.com",
      apiKey: "abc123",
      normalField: "safe",
    });
    expect(result.userEmail).toBe("[redacted]");
    expect(result.apiKey).toBe("[redacted]");
    expect(result.normalField).toBe("safe");
  });
});

describe("clientError — development", () => {
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch.mockReset();
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("calls console.warn (not fetch) in development", async () => {
    const { clientError } = await importLogger("development");
    clientError("test.event", { foo: "bar" });

    expect(consoleWarn).toHaveBeenCalledOnce();
    expect(consoleWarn).toHaveBeenCalledWith("[client]", "test.event", {
      foo: "bar",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sanitises PII in development console.warn output", async () => {
    const { clientError } = await importLogger("development");
    clientError("test.event", { email: "user@test.com", status: 500 });

    expect(consoleWarn).toHaveBeenCalledWith("[client]", "test.event", {
      email: "[redacted]",
      status: 500,
    });
  });

  it("does not throw when called with no context", async () => {
    const { clientError } = await importLogger("development");
    expect(() => clientError("bare.event")).not.toThrow();
  });
});

describe("clientError — production", () => {
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch.mockReset();
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("posts to /api/client-errors in production", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('{"ok":true}', { status: 200 }),
    );
    const { clientError } = await importLogger("production");

    clientError("upload.failed", { status: 500 });

    // fetch is fire-and-forget — wait a tick for the microtask to execute
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/client-errors");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.message).toBe("upload.failed");
    expect(body.context).toEqual({ status: 500 });
    expect(body.timestamp).toBeDefined();
    // Does NOT call console.warn
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("redacts PII from context before posting", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('{"ok":true}', { status: 200 }),
    );
    const { clientError } = await importLogger("production");

    clientError("auth.failed", { email: "secret@test.com", attempts: 3 });
    await new Promise((r) => setTimeout(r, 0));

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    const ctx = body.context as Record<string, unknown>;
    expect(ctx.email).toBe("[redacted]");
    expect(ctx.attempts).toBe(3);
  });

  it("never throws even when fetch rejects", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { clientError } = await importLogger("production");

    expect(() => clientError("event")).not.toThrow();
    // Wait for the promise chain to settle
    await new Promise((r) => setTimeout(r, 10));
    // Still no throw — test passes if we get here
  });

  it("never throws even when fetch throws synchronously", async () => {
    mockFetch.mockImplementationOnce(() => {
      throw new Error("Sync fetch error");
    });
    const { clientError } = await importLogger("production");

    expect(() => clientError("event")).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});

// ── /api/client-errors endpoint ───────────────────────────────────────────────

describe("POST /api/client-errors", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /** Build a mock NextRequest-like object */
  function makeRequest(body: unknown, headers: Record<string, string> = {}) {
    const defaultHeaders: Record<string, string> = {
      "content-type": "application/json",
      "x-real-ip": "1.2.3.4",
      ...headers,
    };
    return {
      json: async () => body,
      headers: {
        get: (k: string) => defaultHeaders[k.toLowerCase()] ?? null,
      },
    };
  }

  it("returns 200 and logs warn for a valid request", async () => {
    // Mock dependencies
    vi.doMock("@/shared/logger", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));
    vi.doMock("@/server/lib/rateLimit", () => ({
      rateLimit: vi
        .fn()
        .mockResolvedValue({
          success: true,
          remaining: 9,
          reset: 0,
          retryAfter: 0,
        }),
      getClientIp: vi.fn().mockReturnValue("1.2.3.4"),
    }));

    const { POST } = await import("@/app/api/client-errors/route");
    const req = makeRequest({
      message: "test.error",
      url: "/sell",
      context: { foo: "bar" },
    });
    const res = await POST(req as never);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it("returns 400 for empty message", async () => {
    vi.doMock("@/shared/logger", () => ({
      logger: { warn: vi.fn() },
    }));
    vi.doMock("@/server/lib/rateLimit", () => ({
      rateLimit: vi
        .fn()
        .mockResolvedValue({
          success: true,
          remaining: 9,
          reset: 0,
          retryAfter: 0,
        }),
      getClientIp: vi.fn().mockReturnValue("1.2.3.4"),
    }));

    const { POST } = await import("@/app/api/client-errors/route");
    const req = makeRequest({ message: "" });
    const res = await POST(req as never);

    expect(res.status).toBe(400);
  });

  it("returns 400 for message longer than 500 chars", async () => {
    vi.doMock("@/shared/logger", () => ({
      logger: { warn: vi.fn() },
    }));
    vi.doMock("@/server/lib/rateLimit", () => ({
      rateLimit: vi
        .fn()
        .mockResolvedValue({
          success: true,
          remaining: 9,
          reset: 0,
          retryAfter: 0,
        }),
      getClientIp: vi.fn().mockReturnValue("1.2.3.4"),
    }));

    const { POST } = await import("@/app/api/client-errors/route");
    const req = makeRequest({ message: "a".repeat(501) });
    const res = await POST(req as never);

    expect(res.status).toBe(400);
  });

  it("returns 200 silently when rate-limited (fail-open behaviour)", async () => {
    vi.doMock("@/shared/logger", () => ({
      logger: { warn: vi.fn() },
    }));
    vi.doMock("@/server/lib/rateLimit", () => ({
      rateLimit: vi
        .fn()
        .mockResolvedValue({
          success: false,
          remaining: 0,
          reset: 0,
          retryAfter: 60,
        }),
      getClientIp: vi.fn().mockReturnValue("1.2.3.4"),
    }));

    const { POST } = await import("@/app/api/client-errors/route");
    const req = makeRequest({ message: "test" });
    const res = await POST(req as never);

    // Returns 200 silently — client does not know it was rate-limited
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it("returns 400 when body is malformed JSON", async () => {
    vi.doMock("@/shared/logger", () => ({
      logger: { warn: vi.fn() },
    }));
    vi.doMock("@/server/lib/rateLimit", () => ({
      rateLimit: vi
        .fn()
        .mockResolvedValue({
          success: true,
          remaining: 9,
          reset: 0,
          retryAfter: 0,
        }),
      getClientIp: vi.fn().mockReturnValue("1.2.3.4"),
    }));

    const { POST } = await import("@/app/api/client-errors/route");
    const req = {
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
      headers: { get: () => "1.2.3.4" },
    };
    const res = await POST(req as never);

    expect(res.status).toBe(400);
  });
});
