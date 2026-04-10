// src/test/cors-config.test.ts
// ─── Tests: CORS configuration in next.config and withCors() ─────────────────
// Verifies that:
//  1. API routes return correct CORS headers via withCors() per-request
//  2. Invalid origins receive no CORS headers
//  3. next.config.ts does NOT set ACAO on API routes (withCors() handles those)
//     but DOES set ACAO: * on /_next/static/ for PWA/CDN support
//  4. OPTIONS preflight from allowed origin returns correct CORS headers

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { withCors } from "@/app/api/v1/_helpers/cors";

const ALLOWED = "https://buyzi.co.nz";
const DISALLOWED = "https://evil.com";

function setAllowedOrigins(value: string | undefined) {
  if (value === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = value;
}

afterEach(() => {
  delete process.env.ALLOWED_ORIGINS;
});

// ── Test 1: API route returns correct CORS headers via withCors() ─────────────

describe("withCors() — per-request CORS", () => {
  it("returns correct Access-Control-Allow-Origin for an allowed origin", () => {
    setAllowedOrigins(ALLOWED);

    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
    });
    const withHeaders = withCors(response, ALLOWED);

    expect(withHeaders.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED,
    );
    expect(withHeaders.headers.get("Vary")).toBe("Origin");
  });

  // ── Test 2: Invalid origin returns no CORS headers ──────────────────────────

  it("returns no Access-Control-Allow-Origin for a disallowed origin", () => {
    setAllowedOrigins(ALLOWED);

    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
    });
    const withHeaders = withCors(response, DISALLOWED);

    expect(withHeaders.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(withHeaders.headers.get("Vary")).toBeNull();
  });

  // ── Test 4: OPTIONS preflight returns correct headers ───────────────────────

  it("OPTIONS preflight: withCors attaches CORS headers to a 204 response", () => {
    setAllowedOrigins(`${ALLOWED},https://staging.buyzi.co.nz`);

    const preflight = new Response(null, { status: 204 });
    const result = withCors(preflight, ALLOWED);

    expect(result.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED);
    expect(result.headers.get("Access-Control-Allow-Methods")).toBeTruthy();
    expect(result.headers.get("Vary")).toBe("Origin");
    expect(result.status).toBe(204);
  });
});

// ── Test 3: CORS header placement in next.config.ts ──────────────────────────
//
// withCors() handles per-request origin-reflection for /api/ routes.
// Setting ACAO statically on API routes would produce duplicate headers and
// bypass the allowlist check.
//
// /_next/static/ assets (CSS, JS, fonts) are not handled by withCors() — they
// should carry ACAO: * so browsers on any origin (PWA shell, mobile webview,
// CDN edge) can load them without CORS errors.  This does NOT conflict with
// withCors() because that function only runs inside API route handlers.

describe("next.config.ts — CORS header placement", () => {
  it("does not apply Access-Control-Allow-Origin to API routes or globally", () => {
    const configPath = resolve(process.cwd(), "next.config.ts");
    const content = readFileSync(configPath, "utf-8");

    // Credentials header and bare corsHeaders variable must never appear
    expect(content).not.toContain("Access-Control-Allow-Credentials");
    expect(content).not.toContain("corsHeaders");

    // ACAO must not appear inside an /api/ source rule
    const apiCorsMatch = content.match(
      /source:\s*["']\/api[^"']*["'][^}]*Access-Control-Allow-Origin/s,
    );
    expect(apiCorsMatch).toBeNull();
  });

  it("sets Access-Control-Allow-Origin: * on /_next/static for PWA/CDN support", () => {
    const configPath = resolve(process.cwd(), "next.config.ts");
    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain("/_next/static");
    expect(content).toContain("Access-Control-Allow-Origin");
  });

  it("still contains the security headers (X-Frame-Options etc.)", () => {
    const configPath = resolve(process.cwd(), "next.config.ts");
    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain("X-Frame-Options");
    expect(content).toContain("X-Content-Type-Options");
    expect(content).toContain("Strict-Transport-Security");
  });
});
