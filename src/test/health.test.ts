// src/test/health.test.ts
// ─── Tests for /api/health public endpoint ───────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import db from "@/lib/db";

// ── Mock Redis (setup.ts does not mock this) ──────────────────────────────────
const mockPing = vi.fn();
vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: vi.fn(() => ({ ping: mockPing })),
}));

// db is mocked by setup.ts (setupFiles) — $queryRaw is already a vi.fn()

// Import AFTER mocks
const { GET } = await import("@/app/api/health/route");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(correlationId?: string): Request {
  const headers: Record<string, string> = {};
  if (correlationId) headers["x-correlation-id"] = correlationId;
  return new Request("http://localhost/api/health", { headers });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─────────────────────────────────────────────────────────────────────────────

describe("/api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Happy-path defaults
    vi.mocked(db.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);
    mockPing.mockResolvedValue("PONG");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. All healthy → ok / 200 ────────────────────────────────────────────

  it("returns status ok and HTTP 200 when all checks pass", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
    expect(body.checks.redis).toBe("ok");
    expect(body.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(body.version).toBeDefined();
  });

  // ── 2. Redis unreachable → degraded / 200 ────────────────────────────────

  it("returns status degraded and HTTP 200 when Redis is unreachable", async () => {
    mockPing.mockRejectedValue(new Error("Redis connection refused"));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.redis).toBe("unreachable");
    expect(body.checks.database).toBe("ok");
  });

  // ── 3. Database unreachable → unhealthy / 503 ────────────────────────────

  it("returns status unhealthy and HTTP 503 when database is unreachable", async () => {
    vi.mocked(db.$queryRaw).mockRejectedValue(new Error("connection refused"));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("unhealthy");
    expect(body.checks.database).toBe("unreachable");
  });

  // ── 4a. Slow database (>3s) → degraded ───────────────────────────────────

  it("marks database degraded (not hanging) when it exceeds 3s timeout", async () => {
    vi.useFakeTimers();

    // Never resolves — simulates a completely stalled database
    vi.mocked(db.$queryRaw).mockImplementation(() => new Promise(() => {}));

    const responsePromise = GET(makeRequest());
    await vi.advanceTimersByTimeAsync(3500);
    const res = await responsePromise;
    const body = await res.json();

    // Degraded (not unhealthy) because timeout ≠ confirmed unreachable
    expect(body.checks.database).toBe("degraded");
    expect(body.status).toBe("degraded");
    expect(res.status).toBe(200);
  });

  // ── 4b. Slow Redis (>3s) → degraded ──────────────────────────────────────

  it("marks redis degraded (not hanging) when it exceeds 3s timeout", async () => {
    vi.useFakeTimers();

    mockPing.mockImplementation(() => new Promise(() => {}));

    const responsePromise = GET(makeRequest());
    await vi.advanceTimersByTimeAsync(3500);
    const res = await responsePromise;
    const body = await res.json();

    expect(body.checks.redis).toBe("degraded");
    expect(body.status).toBe("degraded");
    expect(res.status).toBe(200);
  });

  // ── 5. No error messages or connection strings exposed ────────────────────

  it("never exposes internal error messages in the response body", async () => {
    vi.mocked(db.$queryRaw).mockRejectedValue(
      new Error("postgresql://user:secret@host:5432/db"),
    );

    const res = await GET(makeRequest());
    const body = await res.json();
    const bodyStr = JSON.stringify(body);

    // Connection strings with credentials must never appear
    expect(bodyStr).not.toContain("postgresql://");
    expect(bodyStr).not.toContain("secret");
    expect(bodyStr).not.toContain("connection refused");
    // Only safe sentinel values allowed
    expect(body.checks.database).toBe("unreachable");
  });

  it("never exposes Redis credentials in the response body", async () => {
    mockPing.mockRejectedValue(
      new Error("https://user:token@redis.upstash.io failed"),
    );

    const res = await GET(makeRequest());
    const body = await res.json();
    const bodyStr = JSON.stringify(body);

    expect(bodyStr).not.toContain("upstash.io");
    expect(bodyStr).not.toContain("token");
    expect(body.checks.redis).toBe("unreachable");
  });

  // ── 6. correlationId threaded through ────────────────────────────────────

  it("echoes x-correlation-id from request into response body", async () => {
    const res = await GET(makeRequest("upstream-corr-id-abc"));
    const body = await res.json();

    expect(body.correlationId).toBe("upstream-corr-id-abc");
  });

  it("generates a UUID correlationId when none is provided in request", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(UUID_RE.test(body.correlationId)).toBe(true);
  });

  // ── 7. Response shape completeness ───────────────────────────────────────

  it("includes all required fields in response", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("checks");
    expect(body).toHaveProperty("checks.database");
    expect(body).toHaveProperty("checks.redis");
    expect(body).toHaveProperty("checks.queue");
    expect(body).toHaveProperty("responseTimeMs");
    expect(body).toHaveProperty("correlationId");
  });
});
