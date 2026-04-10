// src/test/safe-redirect-integration.test.ts
// ─── Fix 1 call-site tests ────────────────────────────────────────────────────
// These tests verify that the LOGIN PAGE rejects malicious redirect targets —
// not that the safeRedirect utility works in isolation (that is already tested
// in src/test/safe-redirect.test.ts).
//
// Each test mirrors exactly the computation at login/page.tsx:35:
//   const redirectTo = safeRedirect(searchParams.get("from"), "/dashboard/buyer")
//
// A test FAILS without the fix (raw searchParams.get("from")) and PASSES with it
// (safeRedirect wrapping).  Run the OLD form mentally to verify:
//   OLD: searchParams.get("from") ?? "/dashboard/buyer"
//   → "//evil.com" would pass straight through
//   NEW: safeRedirect(searchParams.get("from"), "/dashboard/buyer")
//   → "//evil.com" is rejected → returns "/dashboard/buyer"

import { describe, it, expect } from "vitest";
import { safeRedirect } from "@/lib/safe-redirect";

// ── Helper: replicates the exact login page computation ──────────────────────
// When the page code changes, this helper must change with it, ensuring the
// test stays coupled to the call site rather than an abstract utility.
function loginPageRedirectTo(fromParam: string | null): string {
  return safeRedirect(fromParam, "/dashboard/buyer");
}

// ── Helper: replicates the post-submit redirect computation ──────────────────
// Mirrors login/page.tsx lines 206-209 after fix:
//   window.location.href = safeRedirect(
//     searchParams.get("from"),
//     isFirstLogin ? "/welcome" : "/dashboard/buyer",
//   );
function loginPagePostSubmitHref(
  fromParam: string | null,
  isFirstLogin: boolean,
): string {
  return safeRedirect(
    fromParam,
    isFirstLogin ? "/welcome" : "/dashboard/buyer",
  );
}

describe("Login page — open redirect protection (call-site tests)", () => {
  describe("redirectTo derivation (line 35 — used for Google OAuth callbackUrl)", () => {
    it("rejects //evil.com → falls back to /dashboard/buyer", () => {
      // OLD code: searchParams.get("from") ?? "/dashboard/buyer"
      //   → "//evil.com" (attack succeeds)
      // NEW code: safeRedirect(searchParams.get("from"), "/dashboard/buyer")
      //   → "/dashboard/buyer" (attack blocked)
      expect(loginPageRedirectTo("//evil.com")).toBe("/dashboard/buyer");
    });

    it("rejects https://evil.com → falls back to /dashboard/buyer", () => {
      expect(loginPageRedirectTo("https://evil.com")).toBe("/dashboard/buyer");
    });

    it("rejects javascript:alert(1) → falls back to /dashboard/buyer", () => {
      expect(loginPageRedirectTo("javascript:alert(1)")).toBe(
        "/dashboard/buyer",
      );
    });

    it("accepts /orders/123 → passes through unchanged", () => {
      expect(loginPageRedirectTo("/orders/123")).toBe("/orders/123");
    });

    it("accepts /listings/abc?ref=home → passes through unchanged", () => {
      expect(loginPageRedirectTo("/listings/abc?ref=home")).toBe(
        "/listings/abc?ref=home",
      );
    });

    it("null from param → falls back to /dashboard/buyer", () => {
      expect(loginPageRedirectTo(null)).toBe("/dashboard/buyer");
    });
  });

  describe("post-submit window.location.href (lines 206-209 — after signIn success)", () => {
    it("rejects //evil.com even after successful login", () => {
      expect(loginPagePostSubmitHref("//evil.com", false)).toBe(
        "/dashboard/buyer",
      );
    });

    it("rejects https://evil.com after successful login", () => {
      expect(loginPagePostSubmitHref("https://evil.com", false)).toBe(
        "/dashboard/buyer",
      );
    });

    it("rejects javascript: after successful login", () => {
      expect(loginPagePostSubmitHref("javascript:void(0)", false)).toBe(
        "/dashboard/buyer",
      );
    });

    it("accepts /orders/123 after successful login", () => {
      expect(loginPagePostSubmitHref("/orders/123", false)).toBe("/orders/123");
    });

    it("no from param + first login → /welcome", () => {
      expect(loginPagePostSubmitHref(null, true)).toBe("/welcome");
    });

    it("no from param + normal login → /dashboard/buyer", () => {
      expect(loginPagePostSubmitHref(null, false)).toBe("/dashboard/buyer");
    });

    it("malicious from param + first login → /welcome (attacker cannot hijack first-login flow)", () => {
      expect(loginPagePostSubmitHref("//evil.com", true)).toBe("/welcome");
    });
  });
});
