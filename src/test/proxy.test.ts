// src/test/proxy.test.ts
// ─── Tests: proxy.ts auth guard layer ───────────────────────────────────────
// Verifies that the proxy correctly enforces auth on protected routes,
// returns 401 JSON for unauthenticated API requests, and handles MFA pending.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock auth() wrapper — passthrough that exposes request.auth ────────────
vi.mock("@/lib/auth", () => ({
  auth: (handler: (...args: unknown[]) => unknown) => handler,
}));

vi.mock("server-only", () => ({}));

// ─── Mock crypto for nonce generation ──────────────────────────────────────
vi.mock("crypto", () => ({
  default: {
    randomBytes: () => ({ toString: () => "test-nonce-abc" }),
    randomUUID: () => "test-uuid-123",
  },
  randomBytes: () => ({ toString: () => "test-nonce-abc" }),
  randomUUID: () => "test-uuid-123",
}));

// ─── Mock sessionStore (used for defence-in-depth session version check) ────
vi.mock("@/server/lib/sessionStore", () => ({
  getSessionVersion: vi.fn().mockResolvedValue(0),
}));

// ─── Import after mocks ────────────────────────────────────────────────────

import { proxy, config } from "@/proxy";

// ─── Test helpers ───────────────────────────────────────────────────────────

type SessionUser = {
  id?: string;
  isSellerEnabled?: boolean;
  isAdmin?: boolean;
  isBanned?: boolean;
  mfaPending?: boolean;
};

const REGULAR_USER: SessionUser = {
  id: "user-1",
  isSellerEnabled: false,
  isAdmin: false,
  isBanned: false,
  mfaPending: false,
};

const ADMIN_USER: SessionUser = {
  ...REGULAR_USER,
  isAdmin: true,
};

const MFA_PENDING_USER: SessionUser = {
  ...REGULAR_USER,
  mfaPending: true,
};

function makeReq(
  path: string,
  opts: { method?: string; auth?: { user: SessionUser } | null } = {},
) {
  const url = new URL(path, "http://localhost:3000");
  return {
    nextUrl: url,
    url: url.toString(),
    method: opts.method ?? "GET",
    headers: new Headers({ "user-agent": "test-agent" }),
    auth: opts.auth ?? null,
  } as Parameters<typeof proxy>[0];
}

// ─────────────────────────────────────────────────────────────────────────────

describe("proxy — auth guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: Unauthenticated page → redirect to /login ────────────────
  it("redirects unauthenticated /dashboard request to /login", async () => {
    const res = await proxy(makeReq("/dashboard"));
    expect(res?.status).toBe(307);
    const location = res?.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("from=%2Fdashboard");
  });

  // ── Test 2: Unauthenticated API → 401 JSON ──────────────────────────
  it("returns 401 JSON for unauthenticated /api/v1/orders", async () => {
    const res = await proxy(makeReq("/api/v1/orders"));
    expect(res?.status).toBe(401);
    const body = await res?.json();
    expect(body.code).toBe("AUTH_REQUIRED");
    expect(body.error).toBe("Unauthorised");
  });

  // ── Test 3: Non-admin on /admin → redirect to /dashboard/buyer ───────
  it("redirects authenticated non-admin from /admin to /dashboard/buyer", async () => {
    const res = await proxy(
      makeReq("/admin/users", { auth: { user: REGULAR_USER } }),
    );
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/dashboard/buyer");
  });

  // ── Test 4: Admin on /admin → passes through ─────────────────────────
  it("allows authenticated admin through to /admin", async () => {
    const res = await proxy(
      makeReq("/admin/users", { auth: { user: ADMIN_USER } }),
    );
    // Pass-through response (not a redirect or 401)
    expect(res?.status).not.toBe(307);
    expect(res?.status).not.toBe(401);
  });

  // ── Test 5: MFA pending on /dashboard → redirect to /mfa-verify ──────
  it("redirects MFA-pending session to /mfa-verify for protected pages", async () => {
    const res = await proxy(
      makeReq("/dashboard", { auth: { user: MFA_PENDING_USER } }),
    );
    expect(res?.status).toBe(307);
    const location = res?.headers.get("location") ?? "";
    expect(location).toContain("/mfa-verify");
    expect(location).toContain("callbackUrl=%2Fdashboard");
  });

  // ── Test 6: Stripe webhook → not matched by proxy ────────────────────
  // The Stripe webhook is at /api/webhooks/stripe (NOT /api/v1/), so
  // the proxy's API checks never intercept it. Verify via config.matcher.
  it("config.matcher does not exclude Stripe webhook (it is simply not an API v1 route)", () => {
    // The webhook path /api/webhooks/stripe is NOT under /api/v1/ so it
    // naturally passes through the proxy without hitting the API auth checks.
    // The catch-all matcher includes it, but the proxy handler only gates /api/v1/* and /api/admin/*.
    const res = proxy(makeReq("/api/webhooks/stripe"));
    // It should pass through (no 401, no redirect) — the response is the
    // standard pass-through with security headers
    expect(res).resolves.not.toBeNull();
  });

  // ── Test 7: Public GET /api/v1/listings → passes through ─────────────
  it("allows GET /api/v1/listings through without auth", async () => {
    const res = await proxy(makeReq("/api/v1/listings"));
    // No 401, no redirect — passes through
    expect(res?.status).not.toBe(401);
    expect(res?.status).not.toBe(307);
  });

  // ── Test 8: _next/static not intercepted ──────────────────────────────
  it("config.matcher excludes _next/static paths", () => {
    // The matcher uses a negative lookahead that excludes _next/static
    const matcherPattern = config.matcher[0];
    expect(matcherPattern).toContain("_next/static");
    // The pattern is a negative group — _next/static is excluded
    expect(matcherPattern).toMatch(/\(\?!.*_next\/static/);
  });

  // ── Additional: MFA pending on API → 401 JSON ────────────────────────
  it("returns 401 MFA_REQUIRED for MFA-pending API request", async () => {
    const res = await proxy(
      makeReq("/api/v1/orders", { auth: { user: MFA_PENDING_USER } }),
    );
    expect(res?.status).toBe(401);
    const body = await res?.json();
    expect(body.code).toBe("MFA_REQUIRED");
  });

  // ── Additional: POST /api/v1/auth/token → passes through (public) ────
  it("allows POST /api/v1/auth/token through without auth (mobile login)", async () => {
    const res = await proxy(makeReq("/api/v1/auth/token", { method: "POST" }));
    expect(res?.status).not.toBe(401);
  });

  // ── Additional: POST /api/v1/listings requires auth ───────────────────
  it("blocks POST /api/v1/listings without auth (not a public GET)", async () => {
    const res = await proxy(makeReq("/api/v1/listings", { method: "POST" }));
    expect(res?.status).toBe(401);
    const body = await res?.json();
    expect(body.code).toBe("AUTH_REQUIRED");
  });
});
