// src/test/deep-sanitiser.test.ts
// ─── Deep recursive PII sanitiser ────────────────────────────────────────────
// Verifies that sanitiseLogContext() recursively redacts PII at every nesting
// level — not just top-level keys.

import { describe, it, expect } from "vitest";
import { sanitiseLogContext } from "@/lib/log-sanitiser";

vi.mock("server-only", () => ({}));

// ── 1. Top-level email (existing behaviour preserved) ─────────────────────────

describe("deep sanitiser — top-level", () => {
  it("redacts top-level email field", () => {
    const result = sanitiseLogContext({
      email: "alice@example.com",
      orderId: "o-1",
    });
    expect(result.email).toBe("a***@example.com");
    expect(result.orderId).toBe("o-1");
  });
});

// ── 2. Nested email (2 levels deep) ──────────────────────────────────────────

describe("deep sanitiser — nested objects", () => {
  it("redacts email nested inside metadata.user", () => {
    const result = sanitiseLogContext({
      orderId: "o-2",
      metadata: {
        user: { email: "bob@example.com", role: "buyer" },
      },
    });

    const user = (result.metadata as Record<string, unknown>).user as Record<
      string,
      unknown
    >;

    expect(user.email).toBe("b***@example.com");
    expect(user.role).toBe("buyer");
    expect(result.orderId).toBe("o-2");
  });

  // ── 3. Deeply nested email (3 levels deep) ──────────────────────────────────

  it("redacts email 3 levels deep", () => {
    const result = sanitiseLogContext({
      outer: {
        middle: {
          inner: { email: "carol@deep.co.nz", amount: 100 },
        },
      },
    });

    const inner = (
      (result.outer as Record<string, unknown>).middle as Record<
        string,
        unknown
      >
    ).inner as Record<string, unknown>;

    expect(inner.email).toBe("c***@deep.co.nz");
    expect(inner.amount).toBe(100);
  });

  // ── 5. Non-PII nested objects pass through unchanged ───────────────────────

  it("passes non-PII nested objects through unchanged", () => {
    const result = sanitiseLogContext({
      order: {
        id: "ord-42",
        status: "COMPLETED",
        amount: 4500,
        flags: { isFraud: false },
      },
    });

    expect(result.order).toEqual({
      id: "ord-42",
      status: "COMPLETED",
      amount: 4500,
      flags: { isFraud: false },
    });
  });
});

// ── 4. Array of objects — all email fields redacted ───────────────────────────

describe("deep sanitiser — arrays", () => {
  it("redacts email in every object element of an array", () => {
    const result = sanitiseLogContext({
      recipients: [
        { email: "alice@example.com", name: "Alice" },
        { email: "bob@example.com", name: "Bob" },
      ],
    });

    const recipients = result.recipients as Array<Record<string, unknown>>;
    expect(recipients[0].email).toBe("a***@example.com");
    expect(recipients[1].email).toBe("b***@example.com");
    // name is also in PII_KEYS
    expect(recipients[0].name).toBe("[redacted]");
    expect(recipients[1].name).toBe("[redacted]");
  });

  // ── 7. Array of primitives passes through unchanged ────────────────────────

  it("passes an array of primitives through unchanged", () => {
    const result = sanitiseLogContext({
      tags: ["fraud", "high-value", "nz"],
      counts: [1, 2, 3],
    });

    expect(result.tags).toEqual(["fraud", "high-value", "nz"]);
    expect(result.counts).toEqual([1, 2, 3]);
  });
});

// ── 6. Depth limit prevents runaway recursion ─────────────────────────────────

describe("deep sanitiser — depth guard", () => {
  it("returns the sub-tree unchanged when depth exceeds 5", () => {
    // Directly invoke with depth=6 to test the guard clause.
    // An email at this level must NOT be redacted — the guard exits early.
    const deepCtx = { email: "deep@example.com", orderId: "o-deep" };
    const result = sanitiseLogContext(deepCtx, 6);

    // Returned as-is — the guard returns ctx without processing
    expect(result).toBe(deepCtx);
    expect(result.email).toBe("deep@example.com");
  });
});
