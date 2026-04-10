// src/test/cors-config.test.ts
// ─── Tests: CORS static headers removal from next.config ─────────────────────
// Verifies that:
//  1. API routes return correct CORS headers via withCors() per-request
//  2. Invalid origins receive no CORS headers
//  3. next.config.ts no longer sets static Access-Control-Allow-Origin
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

// ── Test 3: Static CORS headers are no longer in next.config.ts ─────────────

describe("next.config.ts — static CORS headers removed", () => {
  it("does not contain Access-Control-Allow-Origin header definition", () => {
    const configPath = resolve(process.cwd(), "next.config.ts");
    const content = readFileSync(configPath, "utf-8");

    expect(content).not.toContain("Access-Control-Allow-Origin");
    expect(content).not.toContain("Access-Control-Allow-Credentials");
    expect(content).not.toContain("corsHeaders");
  });

  it("still contains the security headers (X-Frame-Options etc.)", () => {
    const configPath = resolve(process.cwd(), "next.config.ts");
    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain("X-Frame-Options");
    expect(content).toContain("X-Content-Type-Options");
    expect(content).toContain("Strict-Transport-Security");
  });
});
