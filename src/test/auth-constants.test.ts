// src/test/auth-constants.test.ts
// ─── Tests: Auth TTL constants (Task I3) ──────────────────────────────────────
// Verifies that:
//   1. MOBILE_TOKEN_TTL_SECONDS is exactly 7 days in seconds
//   2. WEB_SESSION_TTL_SECONDS is exactly 30 days in seconds
//   3. sessionStore.ts uses the shared constant (not a hardcoded magic number)
//   4. The token route comment correctly says "7-day" (not the stale "30-day")

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import {
  MOBILE_TOKEN_TTL_SECONDS,
  WEB_SESSION_TTL_SECONDS,
} from "@/lib/auth-constants";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf-8");
}

const SECONDS_PER_DAY = 24 * 60 * 60;

describe("Auth constants — Task I3", () => {
  // ── Test 1: Mobile token TTL is exactly 7 days ────────────────────────────
  it("MOBILE_TOKEN_TTL_SECONDS equals 7 days in seconds", () => {
    expect(MOBILE_TOKEN_TTL_SECONDS).toBe(SECONDS_PER_DAY * 7);
    // Exact value check — makes the numeric value obvious in test output
    expect(MOBILE_TOKEN_TTL_SECONDS).toBe(604_800);
  });

  // ── Test 2: Web session TTL is exactly 30 days ────────────────────────────
  it("WEB_SESSION_TTL_SECONDS equals 30 days in seconds", () => {
    expect(WEB_SESSION_TTL_SECONDS).toBe(SECONDS_PER_DAY * 30);
    expect(WEB_SESSION_TTL_SECONDS).toBe(2_592_000);
  });

  // ── Test 3: sessionStore.ts uses the shared constant, not a magic number ──
  it("sessionStore.ts imports WEB_SESSION_TTL_SECONDS and does not use 60*60*24*30 inline", () => {
    const store = read("src/server/lib/sessionStore.ts");

    // Must import from auth-constants
    expect(store).toContain("WEB_SESSION_TTL_SECONDS");
    expect(store).toContain("auth-constants");

    // Must NOT have the old inline magic-number definition
    expect(store).not.toContain("60 * 60 * 24 * 30");
  });

  // ── Test 4: Token route comment says "7-day" (fixed from stale "30-day") ──
  it("mobile token API route comment refers to 7-day token (not 30-day)", () => {
    const route = read("src/app/api/v1/auth/token/route.ts");

    // The corrected comment must say 7-day
    expect(route).toContain("7-day");
    // The stale "30-day" comment must be gone
    expect(route).not.toContain("30-day");
  });
});
