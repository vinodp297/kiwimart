// src/test/moderation.test.ts
// ─── Content Moderation Service ─────────────────────────────────────────────

import { describe, it, expect, vi } from "vitest";

// Undo the global mock so we test the REAL implementation
vi.unmock("@/server/lib/moderation");

// Import the REAL functions (no mocking — this is a pure utility)
import { moderateText, sanitizeText } from "@/server/lib/moderation";

// ═══════════════════════════════════════════════════════════════════════════
// moderateText
// ═══════════════════════════════════════════════════════════════════════════

describe("moderateText", () => {
  // ── Empty / whitespace ──────────────────────────────────────────────────
  it("allows empty text", () => {
    const result = moderateText("", "listing");
    expect(result.allowed).toBe(true);
    expect(result.flagged).toBe(false);
    expect(result.matches).toEqual([]);
  });

  it("allows whitespace-only text", () => {
    const result = moderateText("   \t\n  ", "listing");
    expect(result.allowed).toBe(true);
  });

  // ── Blocked patterns (instant reject) ──────────────────────────────────
  it("blocks wire transfer scam language", () => {
    const result = moderateText("Send me a wire transfer please", "listing");
    expect(result.allowed).toBe(false);
    expect(result.flagReason).toBe("blocked_content");
    expect(result.matches.some((m) => m.includes("wire transfer"))).toBe(true);
  });

  it("blocks Western Union references", () => {
    const result = moderateText(
      "Pay via Western Union for discount",
      "message",
    );
    expect(result.allowed).toBe(false);
  });

  it("blocks bitcoin-only payment requests", () => {
    const result = moderateText("Bitcoin payment only", "listing");
    expect(result.allowed).toBe(false);
  });

  it("blocks gun/firearm sale language", () => {
    const result = moderateText("Want to buy guns cheap", "listing");
    expect(result.allowed).toBe(false);
  });

  it("blocks counterfeit goods", () => {
    const result = moderateText("Selling counterfeit designer bags", "listing");
    expect(result.allowed).toBe(false);
  });

  it("blocks stolen goods language", () => {
    const result = moderateText("These are stolen goods", "listing");
    expect(result.allowed).toBe(false);
  });

  // ── Flagged patterns (allowed but flagged) ─────────────────────────────
  it("flags NZ phone numbers in messages", () => {
    const result = moderateText("Call me on 021 234 5678", "message");
    expect(result.allowed).toBe(true);
    expect(result.flagged).toBe(true);
    expect(result.flagReason).toBe("contact_info_in_message");
  });

  it("flags email addresses in messages", () => {
    const result = moderateText("Email me at test@example.com", "message");
    expect(result.allowed).toBe(true);
    expect(result.flagged).toBe(true);
    expect(result.flagReason).toBe("contact_info_in_message");
  });

  it("flags contact info in listings as suspicious_pattern (not contact_info)", () => {
    const result = moderateText("Contact test@example.com", "listing");
    expect(result.allowed).toBe(true);
    expect(result.flagged).toBe(true);
    expect(result.flagReason).toBe("suspicious_pattern");
  });

  it("flags urgency language", () => {
    const result = moderateText("ACT NOW before it sells!", "listing");
    expect(result.allowed).toBe(true);
    expect(result.flagged).toBe(true);
  });

  it("flags cash-only requests", () => {
    const result = moderateText("Cash only, no bank transfer", "listing");
    expect(result.allowed).toBe(true);
    expect(result.flagged).toBe(true);
  });

  // ── Excessive caps ─────────────────────────────────────────────────────
  it("flags excessive caps (shouting) in long text", () => {
    const shouty = "THIS IS ALL CAPITALS AND REALLY LONG TEXT HELLO WORLD";
    const result = moderateText(shouty, "listing");
    expect(result.flagged).toBe(true);
    expect(result.matches).toContain("flagged:excessive_caps");
  });

  it("does not flag short uppercase text", () => {
    const result = moderateText("OK", "listing");
    expect(result.flagged).toBe(false);
  });

  // ── Repeated characters ────────────────────────────────────────────────
  it("flags text with 10+ repeated characters", () => {
    const result = moderateText("aaaaaaaaaa", "listing");
    expect(result.flagged).toBe(true);
    expect(result.matches).toContain("flagged:repeated_chars");
  });

  it("does not flag text with fewer than 10 repeated chars", () => {
    const result = moderateText("aaaaaaaaa", "listing"); // 9 a's
    expect(result.flagged).toBe(false);
  });

  // ── Clean content ──────────────────────────────────────────────────────
  it("allows clean listing description", () => {
    const result = moderateText(
      "Lovely hand-knit scarf, warm wool, great condition",
      "listing",
    );
    expect(result.allowed).toBe(true);
    expect(result.flagged).toBe(false);
    expect(result.matches).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// sanitizeText
// ═══════════════════════════════════════════════════════════════════════════

describe("sanitizeText", () => {
  it("removes script tags and content", () => {
    expect(sanitizeText('Hello<script>alert("xss")</script>World')).toBe(
      "HelloWorld",
    );
  });

  it("removes other HTML tags", () => {
    expect(sanitizeText("<b>Bold</b> and <i>italic</i>")).toBe(
      "Bold and italic",
    );
  });

  it("trims whitespace", () => {
    expect(sanitizeText("  hello  ")).toBe("hello");
  });

  it("returns empty string for empty input after stripping", () => {
    expect(sanitizeText("<div></div>")).toBe("");
  });

  it("passes through plain text unchanged", () => {
    expect(sanitizeText("Just a normal string")).toBe("Just a normal string");
  });
});
