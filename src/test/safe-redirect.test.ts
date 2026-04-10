// src/test/safe-redirect.test.ts
// ─── Fix 1: Open redirect validation ─────────────────────────────────────────
// Verifies that safeRedirect() only allows relative paths that cannot
// be used as open-redirect targets.

import { describe, it, expect } from "vitest";
import { safeRedirect } from "@/lib/safe-redirect";

describe("safeRedirect", () => {
  // ── Safe paths ─────────────────────────────────────────────────────────────

  it("returns the path for a simple relative URL", () => {
    expect(safeRedirect("/dashboard")).toBe("/dashboard");
  });

  it("returns the path for a deep relative URL", () => {
    expect(safeRedirect("/orders/123")).toBe("/orders/123");
  });

  it("returns the path when it includes a query string", () => {
    expect(safeRedirect("/search?q=bike&sort=price")).toBe(
      "/search?q=bike&sort=price",
    );
  });

  // ── Blocked paths ──────────────────────────────────────────────────────────

  it("rejects protocol-relative URL (//evil.com) and returns fallback", () => {
    expect(safeRedirect("//evil.com")).toBe("/");
  });

  it("rejects https absolute URL and returns fallback", () => {
    expect(safeRedirect("https://evil.com")).toBe("/");
  });

  it("rejects http absolute URL and returns fallback", () => {
    expect(safeRedirect("http://evil.com/steal")).toBe("/");
  });

  it("rejects javascript: URL and returns fallback", () => {
    expect(safeRedirect("javascript:alert(1)")).toBe("/");
  });

  // ── Null / undefined ───────────────────────────────────────────────────────

  it("returns fallback when to is null", () => {
    expect(safeRedirect(null)).toBe("/");
  });

  it("returns fallback when to is undefined", () => {
    expect(safeRedirect(undefined)).toBe("/");
  });

  it("returns fallback when to is empty string", () => {
    expect(safeRedirect("")).toBe("/");
  });

  // ── Custom fallback ────────────────────────────────────────────────────────

  it("uses the custom fallback when provided and the path is malicious", () => {
    expect(safeRedirect("//evil.com", "/dashboard/buyer")).toBe(
      "/dashboard/buyer",
    );
  });

  it("uses the custom fallback when to is null", () => {
    expect(safeRedirect(null, "/welcome")).toBe("/welcome");
  });
});
