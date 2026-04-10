// src/test/zap-remaining-fixes.test.ts
// ─── Tests: ZAP remaining security scan fixes ────────────────────────────────
// Regression guards for the five remaining ZAP findings:
//   Fix 1. X-Content-Type-Options present on proxy redirect responses
//   Fix 2. Redirect responses originate from proxy (middleware-early, minimal body)
//   Fix 3. Health endpoint timestamp is ISO 8601, not a Unix integer
//   Fix 4. Referrer-Policy: no-referrer on token-bearing pages
//   Fix 5. Explicit Cache-Control on API routes (no-store for v1/admin, short TTL for health)

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import fs from "fs";
import path from "path";

vi.mock("server-only", () => ({}));

// ── Proxy mocks (same pattern as zap-security-fixes.test.ts) ─────────────────
const uuidState = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/lib/auth", () => ({
  auth: (handler: (...args: unknown[]) => unknown) => handler,
}));

vi.mock("crypto", () => ({
  default: {
    randomBytes: () => ({ toString: () => "zap2-test-nonce" }),
    randomUUID: () => `zap2-uuid-${++uuidState.count}`,
  },
  randomBytes: () => ({ toString: () => "zap2-test-nonce" }),
  randomUUID: () => `zap2-uuid-${++uuidState.count}`,
}));

vi.mock("@/server/lib/sessionStore", () => ({
  getSessionVersion: vi.fn().mockResolvedValue(0),
}));

// ── Health route mocks ────────────────────────────────────────────────────────
vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    ping: vi.fn().mockResolvedValue("PONG"),
  }),
}));

vi.mock("@/shared/auth/requirePermission", () => ({
  requirePermission: vi.fn().mockResolvedValue(undefined),
}));

import { proxy } from "@/proxy";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(
  urlPath: string,
  opts: { auth?: { user: { id: string } } | null } = {},
) {
  const url = new URL(urlPath, "http://localhost:3000");
  return {
    nextUrl: url,
    url: url.toString(),
    method: "GET",
    headers: new Headers({ "user-agent": "zap2-test" }),
    auth: opts.auth ?? null,
  } as Parameters<typeof proxy>[0];
}

/** Call the proxy and return the full response (including redirects). */
async function callProxy(
  urlPath: string,
  opts?: { auth?: { user: { id: string } } | null },
) {
  return proxy(makeReq(urlPath, opts));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("ZAP remaining fixes — Fix 1: X-Content-Type-Options on redirects", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Test 1: X-Content-Type-Options on unauthenticated protected-route redirect ─
  it("proxy redirect for unauthenticated user includes X-Content-Type-Options: nosniff", async () => {
    // /dashboard is a protected prefix — unauthenticated request triggers redirect
    const res = await callProxy("/dashboard");

    // Must be a redirect (3xx), not a 200
    expect(res!.status).toBeGreaterThanOrEqual(300);
    expect(res!.status).toBeLessThan(400);

    expect(res!.headers.get("x-content-type-options")).toBe("nosniff");
  });

  // ── Test 2: X-Content-Type-Options on already-authed login redirect ───────
  it("proxy redirect for authenticated user hitting /login includes X-Content-Type-Options: nosniff", async () => {
    const res = await callProxy("/login", {
      auth: { user: { id: "user-1" } } as Parameters<typeof proxy>[0]["auth"],
    });

    expect(res!.status).toBeGreaterThanOrEqual(300);
    expect(res!.status).toBeLessThan(400);

    expect(res!.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ZAP remaining fixes — Fix 2: Redirects are proxy-early (middleware)", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Test 3: Auth-guard redirects are 307, not 200 (middleware fires before page) ─
  it("protected-route redirect is 307 — proxy intercepts before page renders", async () => {
    const res = await callProxy("/account");

    // Middleware redirect — must not be 200 (which would mean page rendered first)
    expect(res!.status).toBe(307);
  });

  // ── Test 4: Login redirect for authenticated user is 307 ─────────────────
  it("auth-path redirect for authenticated user is 307", async () => {
    const res = await callProxy("/login", {
      auth: { user: { id: "user-1" } } as Parameters<typeof proxy>[0]["auth"],
    });

    expect(res!.status).toBe(307);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ZAP remaining fixes — Fix 3: ISO timestamp in health responses", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Test 5: Public health endpoint returns ISO timestamp, not Unix integer ─
  it("public /api/health timestamp is ISO 8601 string, not a Unix number", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET(new Request("http://localhost/api/health"));
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).toHaveProperty("timestamp");
    expect(typeof body.timestamp).toBe("string");

    // ISO 8601 — parses to a valid Date
    const parsed = new Date(body.timestamp as string);
    expect(parsed.toISOString()).toBe(body.timestamp);

    // Must NOT be a Unix integer (large number)
    expect(typeof body.timestamp).not.toBe("number");
  });

  // ── Test 6: Admin health endpoint timestamp is ISO 8601 ──────────────────
  it("admin /api/admin/health timestamp is ISO 8601 string", async () => {
    const { GET } = await import("@/app/api/admin/health/route");
    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).toHaveProperty("timestamp");
    const parsed = new Date(body.timestamp as string);
    expect(parsed.toISOString()).toBe(body.timestamp as string);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ZAP remaining fixes — Fix 4: Referrer-Policy no-referrer on token pages", () => {
  // ── Test 7: next.config.ts sets no-referrer for token-bearing URL paths ───
  it("next.config.ts includes no-referrer Referrer-Policy for verify-email path", () => {
    const configPath = path.resolve(process.cwd(), "next.config.ts");
    const content = fs.readFileSync(configPath, "utf-8");

    // Confirm path-specific no-referrer override is present
    expect(content).toContain("verify-email");
    expect(content).toContain("reset-password");
    expect(content).toContain("forgot-password");
    expect(content).toContain('"no-referrer"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ZAP remaining fixes — Fix 5: Explicit Cache-Control on API routes", () => {
  // ── Test 8a: next.config.ts sets cacheable TTL for /api/health ───────────
  it("next.config.ts sets a short public Cache-Control TTL for the health endpoint", () => {
    const configPath = path.resolve(process.cwd(), "next.config.ts");
    const content = fs.readFileSync(configPath, "utf-8");

    // Public health endpoint gets a short cacheable TTL (uptime monitors benefit)
    expect(content).toContain("/api/health");
    expect(content).toContain("public, max-age=10");
  });

  // ── Test 8b: next.config.ts sets no-store for authenticated API routes ────
  it("next.config.ts sets Cache-Control: no-store for /api/v1 and /api/admin routes", () => {
    const configPath = path.resolve(process.cwd(), "next.config.ts");
    const content = fs.readFileSync(configPath, "utf-8");

    expect(content).toContain("/api/(v1|admin)/(.*)");
    expect(content).toContain('"no-store"');
  });
});
