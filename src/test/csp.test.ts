// src/test/csp.test.ts
// ─── Tests: nonce-based CSP in proxy.ts ──────────────────────────────────────
// Verifies per-request nonce generation, correct CSP header construction,
// absence of unsafe-inline/unsafe-eval, and that the x-nonce header matches
// the nonce embedded in the CSP.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock auth() wrapper — passthrough ───────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  auth: (handler: (...args: unknown[]) => unknown) => handler,
}));

vi.mock("server-only", () => ({}));

// ─── Mock sessionStore ────────────────────────────────────────────────────────
vi.mock("@/server/lib/sessionStore", () => ({
  getSessionVersion: vi.fn().mockResolvedValue(0),
}));

// Do NOT mock crypto — real random bytes are required to verify nonce uniqueness.

// ─── Import after mocks ───────────────────────────────────────────────────────
import { proxy } from "@/proxy";

// ─── Helper ──────────────────────────────────────────────────────────────────
function makeReq(path = "/") {
  const url = new URL(path, "http://localhost:3000");
  return {
    nextUrl: url,
    url: url.toString(),
    method: "GET",
    headers: new Headers({ "user-agent": "test-agent" }),
    auth: null,
  } as Parameters<typeof proxy>[0];
}

// ─────────────────────────────────────────────────────────────────────────────

describe("CSP nonce generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: Two requests produce different nonces ─────────────────────────
  it("generates a unique nonce per request", async () => {
    const [res1, res2] = await Promise.all([
      proxy(makeReq("/")),
      proxy(makeReq("/")),
    ]);

    const csp1 = res1?.headers.get("content-security-policy") ?? "";
    const csp2 = res2?.headers.get("content-security-policy") ?? "";

    // Extract the nonce value from 'nonce-<value>'
    const nonce1 = csp1.match(/'nonce-([^']+)'/)?.[1];
    const nonce2 = csp2.match(/'nonce-([^']+)'/)?.[1];

    expect(nonce1).toBeTruthy();
    expect(nonce2).toBeTruthy();
    expect(nonce1).not.toBe(nonce2);
  });

  // ── Test 2: CSP header contains nonce-{value} in script-src ──────────────
  it("CSP header contains nonce-{value} in script-src directive", async () => {
    const res = await proxy(makeReq("/"));
    const csp = res?.headers.get("content-security-policy") ?? "";

    // The script-src directive must carry the per-request nonce
    const scriptSrc =
      csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  });

  // ── Test 3: CSP script-src does NOT contain unsafe-inline ────────────────
  it("CSP script-src does not contain 'unsafe-inline'", async () => {
    const res = await proxy(makeReq("/"));
    const csp = res?.headers.get("content-security-policy") ?? "";

    const scriptSrc =
      csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  // ── Test 4: CSP script-src does NOT contain unsafe-eval (non-dev) ─────────
  // In test (NODE_ENV=test) and production the unsafe-eval guard fires false.
  // proxy.ts only adds 'unsafe-eval' when NODE_ENV === 'development'.
  it("CSP script-src does not contain 'unsafe-eval' in non-development environment", async () => {
    // NODE_ENV is "test" in vitest — unsafe-eval must be absent
    const res = await proxy(makeReq("/"));
    const csp = res?.headers.get("content-security-policy") ?? "";

    const scriptSrc =
      csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  // ── Test 5: x-nonce response header is set for Next.js server components ──
  // The proxy forwards the nonce to layout.tsx via the x-nonce response header,
  // which Next.js passes back as a request header to RSC renders.
  it("sets x-nonce header so server components can read the nonce", async () => {
    const res = await proxy(makeReq("/"));
    const xNonce = res?.headers.get("x-nonce");

    expect(xNonce).toBeTruthy();
    // Must look like a base64-encoded value (16 random bytes = 24 base64 chars)
    expect(xNonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  // ── Test 6: Nonce in CSP matches x-nonce header (same request) ───────────
  // Proves the nonce written into the CSP is the same value forwarded to
  // layout.tsx — a mismatch would mean inline scripts are blocked.
  it("nonce embedded in CSP header matches x-nonce header value", async () => {
    const res = await proxy(makeReq("/"));
    const csp = res?.headers.get("content-security-policy") ?? "";
    const xNonce = res?.headers.get("x-nonce") ?? "";

    expect(xNonce).toBeTruthy();
    expect(csp).toContain(`'nonce-${xNonce}'`);
  });
});
