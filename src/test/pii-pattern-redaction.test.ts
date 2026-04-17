// src/test/pii-pattern-redaction.test.ts
// ─── Fix 1: Pattern-based PII redaction in sanitiseLogContext ────────────────
// Verifies that compound key names (e.g. "buyerEmail", "shippingAddress")
// are redacted via substring pattern matching, not just exact key matches.

import { describe, it, expect, vi } from "vitest";
import { sanitiseLogContext } from "@/lib/log-sanitiser";

vi.mock("server-only", () => ({}));

// ─────────────────────────────────────────────────────────────────────────────
// Spec-required test cases (Fix 1 acceptance tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix 1 — pattern-based PII redaction (spec test cases)", () => {
  it("buyerEmail is redacted (compound email key)", () => {
    const result = sanitiseLogContext({ buyerEmail: "buyer@test.com" });
    // Email keys get format-aware masking (not just "[redacted]")
    expect(result.buyerEmail).not.toBe("buyer@test.com");
    expect(result.buyerEmail).toBeTruthy();
  });

  it("sellerEmail is redacted (compound email key)", () => {
    const result = sanitiseLogContext({ sellerEmail: "seller@test.com" });
    expect(result.sellerEmail).not.toBe("seller@test.com");
    expect(result.sellerEmail).toBeTruthy();
  });

  it("orderId is NOT redacted (not a PII pattern)", () => {
    const result = sanitiseLogContext({ orderId: "ord-1" });
    expect(result.orderId).toBe("ord-1");
  });

  it("recipientPhone is redacted (compound phone key)", () => {
    const result = sanitiseLogContext({ recipientPhone: "021123456" });
    // Phone keys get digit masking
    expect(result.recipientPhone).not.toBe("021123456");
    expect(result.recipientPhone).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional compound keys now caught by pattern matching
// (these would have slipped through exact-match PII_KEYS)
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix 1 — additional compound keys caught by pattern matching", () => {
  it("shippingAddress is redacted ('address' pattern matches)", () => {
    const result = sanitiseLogContext({
      shippingAddress: "123 Main St, Auckland",
    });
    expect(result.shippingAddress).toBe("[redacted]");
  });

  it("billingAddress is redacted ('address' pattern matches)", () => {
    const result = sanitiseLogContext({ billingAddress: "456 Queen St" });
    expect(result.billingAddress).toBe("[redacted]");
  });

  it("buyerFirstName is redacted ('firstName' pattern matches)", () => {
    const result = sanitiseLogContext({ buyerFirstName: "Alice" });
    expect(result.buyerFirstName).toBe("[redacted]");
  });

  it("sellerLastName is redacted ('lastName' pattern matches)", () => {
    const result = sanitiseLogContext({ sellerLastName: "Smith" });
    expect(result.sellerLastName).toBe("[redacted]");
  });

  it("userPassword is redacted ('password' pattern matches)", () => {
    const result = sanitiseLogContext({ userPassword: "hunter2" });
    expect(result.userPassword).toBe("[redacted]");
  });

  it("accessToken is redacted ('token' pattern matches)", () => {
    const result = sanitiseLogContext({ accessToken: "eyJhbGc..." });
    expect(result.accessToken).toBe("[redacted]");
  });

  it("apiSecret is redacted ('secret' pattern matches)", () => {
    const result = sanitiseLogContext({ apiSecret: "sk_live_abc123" });
    expect(result.apiSecret).toBe("[redacted]");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-PII fields pass through unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix 1 — non-PII fields are not redacted", () => {
  it("orderId passes through", () => {
    const result = sanitiseLogContext({ orderId: "ord-abc" });
    expect(result.orderId).toBe("ord-abc");
  });

  it("amount passes through", () => {
    const result = sanitiseLogContext({ amount: 4500 });
    expect(result.amount).toBe(4500);
  });

  it("status passes through", () => {
    const result = sanitiseLogContext({ status: "COMPLETED" });
    expect(result.status).toBe("COMPLETED");
  });

  it("listingId passes through", () => {
    const result = sanitiseLogContext({ listingId: "listing-xyz" });
    expect(result.listingId).toBe("listing-xyz");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pattern matching is case-insensitive
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix 1 — pattern matching is case-insensitive", () => {
  it("BUYEREMAIL (all caps) is redacted", () => {
    const result = sanitiseLogContext({
      BUYEREMAIL: "buyer@test.com" as unknown,
    } as Record<string, unknown>);
    expect(result["BUYEREMAIL"]).not.toBe("buyer@test.com");
  });

  it("sellerPASSWORD is redacted (mixed case)", () => {
    const result = sanitiseLogContext({
      sellerPASSWORD: "secret123" as unknown,
    } as Record<string, unknown>);
    expect(result["sellerPASSWORD"]).toBe("[redacted]");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Nested compound keys
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix 1 — nested compound PII keys are redacted", () => {
  it("nested buyerEmail is redacted", () => {
    const result = sanitiseLogContext({
      metadata: {
        buyerEmail: "buyer@test.com",
        orderId: "ord-1",
      },
    });
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.buyerEmail).not.toBe("buyer@test.com");
    expect(meta.orderId).toBe("ord-1");
  });

  it("nested shippingAddress is redacted", () => {
    const result = sanitiseLogContext({
      order: {
        shippingAddress: "123 Test St",
        totalNzd: 5000,
      },
    });
    const order = result.order as Record<string, unknown>;
    expect(order.shippingAddress).toBe("[redacted]");
    expect(order.totalNzd).toBe(5000);
  });
});
