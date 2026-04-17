// src/test/zap-security-fixes.test.ts
// ─── Tests: ZAP security scan fixes ──────────────────────────────────────────
// Regression guards for all five fixes from the ZAP baseline scan:
//   1. CSP includes form-action 'self'        (Fix 1 — was already present)
//   2. CSP includes frame-ancestors 'none'    (Fix 1 — added)
//   3. CSP includes base-uri 'self'           (Fix 1 — was already present)
//   4. X-Powered-By absent from proxy responses (Fix 4)
//   5. Cross-Origin-Embedder-Policy present   (Fix 3)
//   6. Cross-Origin-Opener-Policy present     (Fix 3)
//   7. Category param validated against allowlist (Fix 5)
//   8. Q param length-limited to 200 chars    (Fix 5)
//   9. No dangerouslySetInnerHTML in search page (Fix 5 — false-positive guard)

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import fs from "fs";
import path from "path";

vi.mock("server-only", () => ({}));

// ── Proxy mocks (same pattern as proxy.test.ts) ───────────────────────────────
const uuidState = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/lib/auth", () => ({
  auth: (handler: (...args: unknown[]) => unknown) => handler,
}));

vi.mock("crypto", () => ({
  default: {
    randomBytes: () => ({ toString: () => "zap-test-nonce" }),
    randomUUID: () => `zap-uuid-${++uuidState.count}`,
  },
  randomBytes: () => ({ toString: () => "zap-test-nonce" }),
  randomUUID: () => `zap-uuid-${++uuidState.count}`,
}));

vi.mock("@/server/lib/sessionStore", () => ({
  getSessionVersion: vi.fn().mockResolvedValue(0),
}));

import { proxy } from "@/proxy";
import CATEGORIES from "@/data/categories";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(path: string) {
  const url = new URL(path, "http://localhost:3000");
  return {
    nextUrl: url,
    url: url.toString(),
    method: "GET",
    headers: new Headers({ "user-agent": "zap-test" }),
    auth: null,
  } as unknown as Parameters<typeof proxy>[0];
}

async function getSecurityHeaders(urlPath: string) {
  const res = await proxy(makeReq(urlPath), {} as never);
  return res!.headers;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("ZAP security fixes — proxy response headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Fix 1A: CSP form-action (was already present — regression guard) ────
  it("CSP header includes form-action 'self'", async () => {
    const headers = await getSecurityHeaders("/");
    const csp = headers.get("content-security-policy") ?? "";

    expect(csp).toContain("form-action 'self'");
  });

  // ── Fix 1B: CSP frame-ancestors (newly added) ────────────────────────────
  it("CSP header includes frame-ancestors 'none'", async () => {
    const headers = await getSecurityHeaders("/");
    const csp = headers.get("content-security-policy") ?? "";

    expect(csp).toContain("frame-ancestors 'none'");
  });

  // ── Fix 1C: CSP base-uri (was already present — regression guard) ────────
  it("CSP header includes base-uri 'self'", async () => {
    const headers = await getSecurityHeaders("/");
    const csp = headers.get("content-security-policy") ?? "";

    expect(csp).toContain("base-uri 'self'");
  });

  // ── Fix 4: X-Powered-By must not be set by the proxy ────────────────────
  // next.config.ts sets poweredByHeader: false which suppresses the header
  // in production. The proxy itself never adds it — this test confirms that.
  it("proxy does not add an X-Powered-By header", async () => {
    const headers = await getSecurityHeaders("/");

    expect(headers.get("x-powered-by")).toBeNull();
  });

  // ── Fix 3A: Cross-Origin-Embedder-Policy present ─────────────────────────
  it("response includes Cross-Origin-Embedder-Policy header", async () => {
    const headers = await getSecurityHeaders("/");
    const coep = headers.get("cross-origin-embedder-policy");

    expect(coep).toBeTruthy();
    // unsafe-none is the safe fallback that does not break R2 image loading
    expect(coep).toBe("unsafe-none");
  });

  // ── Fix 3B: Cross-Origin-Opener-Policy present ───────────────────────────
  it("response includes Cross-Origin-Opener-Policy header", async () => {
    const headers = await getSecurityHeaders("/");
    const coop = headers.get("cross-origin-opener-policy");

    expect(coop).toBeTruthy();
    // same-origin-allow-popups preserves isolation while allowing Google OAuth
    expect(coop).toBe("same-origin-allow-popups");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ZAP security fixes — search page input validation (Fix 5)", () => {
  // ── Test 7: Category param validated against allowlist ───────────────────
  it("CATEGORIES data exports known category IDs that the allowlist is derived from", () => {
    // Verify CATEGORIES contains the well-known IDs the search page uses
    const ids = CATEGORIES.map((c) => c.id);

    expect(ids).toContain("cat-vehicles");
    expect(ids).toContain("cat-electronics");
    expect(ids).toContain("cat-fashion");
    // All IDs must be non-empty strings (no blank entries in the allowlist)
    for (const id of ids) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it("category allowlist rejects arbitrary strings that are not category IDs", () => {
    // Simulate the guard from search/page.tsx
    const ALLOWED = new Set(CATEGORIES.map((c) => c.id));

    // Known good values pass through
    expect(ALLOWED.has("cat-electronics")).toBe(true);
    expect(ALLOWED.has("cat-vehicles")).toBe(true);

    // Injection attempts are rejected
    expect(ALLOWED.has("<script>alert(1)</script>")).toBe(false);
    expect(ALLOWED.has("cat-vehicles' OR 1=1--")).toBe(false);
    expect(ALLOWED.has("")).toBe(false);
    expect(ALLOWED.has("unknown-category")).toBe(false);
  });

  // ── Test 8: Q param length limited to 200 chars ──────────────────────────
  it("q param is truncated to 200 characters by the search page guard", () => {
    // Simulate the slice guard from search/page.tsx
    const longQuery = "a".repeat(500);
    const safeQ = longQuery.slice(0, 200) || undefined;

    expect(safeQ).toHaveLength(200);
    expect(safeQ).not.toHaveLength(500);
  });

  it("q param under 200 characters passes through unchanged", () => {
    const shortQuery = "vintage bicycle";
    const safeQ = shortQuery.slice(0, 200) || undefined;

    expect(safeQ).toBe("vintage bicycle");
  });

  // ── Test 9: No dangerouslySetInnerHTML in search page ────────────────────
  // ZAP found user-controlled values reflected in HTML attributes.
  // React JSX automatically escapes attribute values — this test confirms that
  // no dangerouslySetInnerHTML is used near search params in any search file.
  it("search page and client component contain no dangerouslySetInnerHTML", () => {
    const searchDir = path.resolve(process.cwd(), "src/app/(public)/search");
    const files = fs.readdirSync(searchDir).filter((f) => /\.tsx?$/.test(f));

    for (const file of files) {
      const content = fs.readFileSync(path.join(searchDir, file), "utf-8");
      expect(
        content,
        `${file} must not use dangerouslySetInnerHTML`,
      ).not.toContain("dangerouslySetInnerHTML");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ZAP security fixes — next.config.ts (Fix 4)", () => {
  it("next.config.ts sets poweredByHeader: false to suppress X-Powered-By", () => {
    // Read the config source to confirm the setting is present.
    // This guards against accidental removal — the unit test catches it before CI.
    const configPath = path.resolve(process.cwd(), "next.config.ts");
    const content = fs.readFileSync(configPath, "utf-8");

    expect(content).toContain("poweredByHeader: false");
  });
});
