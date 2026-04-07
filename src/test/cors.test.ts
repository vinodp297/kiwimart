// src/test/cors.test.ts
// ─── Tests: getCorsHeaders() origin-reflection logic ─────────────────────────
// Verifies that CORS headers are reflected per-origin (not fixed to the first
// entry), that non-allowed origins receive no CORS headers, and that Vary:
// Origin is always included when CORS headers are set.

import { describe, it, expect, afterEach } from "vitest";
import { getCorsHeaders, withCors } from "@/app/api/v1/_helpers/cors";

// ─── Env helpers ──────────────────────────────────────────────────────────────

const ORIGIN_A = "https://buyzi.co.nz";
const ORIGIN_B = "https://staging.buyzi.co.nz";
const ORIGIN_C = "https://evil.com";

function setAllowedOrigins(value: string | undefined) {
  if (value === undefined) {
    delete process.env.ALLOWED_ORIGINS;
  } else {
    process.env.ALLOWED_ORIGINS = value;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe("getCorsHeaders()", () => {
  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  // ── Test 1: First allowed origin is reflected correctly ───────────────────
  it("reflects the first allowed origin when request comes from that origin", () => {
    setAllowedOrigins(`${ORIGIN_A},${ORIGIN_B}`);

    const headers = getCorsHeaders(ORIGIN_A);

    expect(headers["Access-Control-Allow-Origin"]).toBe(ORIGIN_A);
  });

  // ── Test 2: Second allowed origin is reflected correctly ──────────────────
  it("reflects the second allowed origin (not just the first)", () => {
    setAllowedOrigins(`${ORIGIN_A},${ORIGIN_B}`);

    const headers = getCorsHeaders(ORIGIN_B);

    expect(headers["Access-Control-Allow-Origin"]).toBe(ORIGIN_B);
    // Must NOT return the first origin — this was the original bug
    expect(headers["Access-Control-Allow-Origin"]).not.toBe(ORIGIN_A);
  });

  // ── Test 3: Non-allowed origin → no ACAO header ───────────────────────────
  it("returns no Access-Control-Allow-Origin when origin is not in the allowlist", () => {
    setAllowedOrigins(`${ORIGIN_A},${ORIGIN_B}`);

    const headers = getCorsHeaders(ORIGIN_C);

    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  // ── Test 4: No Origin header → no ACAO header ─────────────────────────────
  it("returns no Access-Control-Allow-Origin when origin is null/absent", () => {
    setAllowedOrigins(`${ORIGIN_A},${ORIGIN_B}`);

    const headersNull = getCorsHeaders(null);
    const headersUndefined = getCorsHeaders(undefined);

    expect(headersNull["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(headersUndefined["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  // ── Test 5: Vary: Origin present when origin is allowed ───────────────────
  it("includes Vary: Origin when Access-Control-Allow-Origin is set", () => {
    setAllowedOrigins(ORIGIN_A);

    const headers = getCorsHeaders(ORIGIN_A);

    expect(headers["Access-Control-Allow-Origin"]).toBe(ORIGIN_A);
    expect(headers["Vary"]).toBe("Origin");
  });

  // ── Test 6: Vary: Origin NOT present when origin is not allowed ───────────
  it("does not include Vary: Origin when origin is not in the allowlist", () => {
    setAllowedOrigins(ORIGIN_A);

    const headers = getCorsHeaders(ORIGIN_C);

    expect(headers["Vary"]).toBeUndefined();
    expect(Object.keys(headers)).toHaveLength(0);
  });

  // ── Test 7: Whitespace around commas is trimmed ───────────────────────────
  it("trims whitespace around comma-separated entries in ALLOWED_ORIGINS", () => {
    // Simulates a sloppy env var value: "https://a.com , https://b.com"
    setAllowedOrigins(`  ${ORIGIN_A}  ,  ${ORIGIN_B}  `);

    const headersA = getCorsHeaders(ORIGIN_A);
    const headersB = getCorsHeaders(ORIGIN_B);

    expect(headersA["Access-Control-Allow-Origin"]).toBe(ORIGIN_A);
    expect(headersB["Access-Control-Allow-Origin"]).toBe(ORIGIN_B);
  });

  // ── Test 8: OPTIONS preflight from allowed origin → correct CORS headers ──
  it("OPTIONS preflight: withCors sets correct headers for allowed origin", () => {
    setAllowedOrigins(`${ORIGIN_A},${ORIGIN_B}`);

    // Simulate a preflight response (204 no content)
    const preflightResponse = new Response(null, { status: 204 });
    const result = withCors(preflightResponse, ORIGIN_B);

    expect(result.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN_B);
    expect(result.headers.get("Vary")).toBe("Origin");
    expect(result.headers.get("Access-Control-Allow-Methods")).toBeTruthy();
    expect(result.status).toBe(204);
  });
});
