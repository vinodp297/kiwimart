// src/test/server-lib-coverage.test.ts
// ─── Tests for server/lib modules with 0% coverage ─────────────────────────
// Covers: password.ts (via argon2 mock), spamDetection.ts (via db mock)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock argon2 before anything imports password.ts
vi.mock("argon2", () => ({
  default: {
    argon2id: 2,
    hash: vi.fn(),
    verify: vi.fn(),
    needsRehash: vi.fn(),
  },
}));

// Unmock password so we get the real implementation (setup.ts mocks it globally)
vi.doUnmock("@/server/lib/password");

// Import setup for all other global mocks (db, etc.)
import "./setup";

import argon2 from "argon2";
import db from "@/lib/db";
import { checkListingSpam, checkMessageSpam } from "@/server/lib/spamDetection";

// ─────────────────────────────────────────────────────────────────────────────
// password.ts — dynamically imported to bypass the setup.ts mock
// ─────────────────────────────────────────────────────────────────────────────
describe("password.ts", () => {
  let hashPassword: typeof import("@/server/lib/password").hashPassword;
  let verifyPassword: typeof import("@/server/lib/password").verifyPassword;
  let needsRehash: typeof import("@/server/lib/password").needsRehash;
  let isPasswordBreached: typeof import("@/server/lib/password").isPasswordBreached;

  beforeEach(async () => {
    const mod = await import("@/server/lib/password");
    hashPassword = mod.hashPassword;
    verifyPassword = mod.verifyPassword;
    needsRehash = mod.needsRehash;
    isPasswordBreached = mod.isPasswordBreached;

    vi.mocked(argon2.hash).mockReset();
    vi.mocked(argon2.verify).mockReset();
    vi.mocked(argon2.needsRehash).mockReset();
  });

  it("hashPassword returns an argon2id hash string", async () => {
    vi.mocked(argon2.hash).mockResolvedValue(
      "$argon2id$v=19$m=65536,t=3,p=1$salt$hash" as never,
    );

    const result = await hashPassword("myPassword123");

    expect(result).toBe("$argon2id$v=19$m=65536,t=3,p=1$salt$hash");
    expect(argon2.hash).toHaveBeenCalledWith("myPassword123", {
      type: 2,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32,
    });
  });

  it("verifyPassword returns true for matching password", async () => {
    vi.mocked(argon2.verify).mockResolvedValue(true as never);

    const result = await verifyPassword("$argon2id$hash", "correct");

    expect(result).toBe(true);
    expect(argon2.verify).toHaveBeenCalledWith("$argon2id$hash", "correct");
  });

  it("verifyPassword returns false for non-matching password", async () => {
    vi.mocked(argon2.verify).mockResolvedValue(false as never);

    const result = await verifyPassword("$argon2id$hash", "wrong");

    expect(result).toBe(false);
  });

  it("verifyPassword returns false on malformed hash (error branch)", async () => {
    vi.mocked(argon2.verify).mockRejectedValue(
      new Error("invalid hash") as never,
    );

    const result = await verifyPassword("not-a-valid-hash", "password");

    expect(result).toBe(false);
  });

  it("needsRehash returns boolean", () => {
    vi.mocked(argon2.needsRehash).mockReturnValue(true as never);
    expect(needsRehash("$argon2id$old")).toBe(true);

    vi.mocked(argon2.needsRehash).mockReturnValue(false as never);
    expect(needsRehash("$argon2id$current")).toBe(false);
  });

  describe("isPasswordBreached", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("returns false on network error (fail-open)", async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error("network down"));

      const result = await isPasswordBreached("password123");

      expect(result).toBe(false);
    });

    it("returns true when password is in breach list", async () => {
      // Compute SHA-1 of "password" to know what suffix the code will look for
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest(
        "SHA-1",
        encoder.encode("password"),
      );
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
      const suffix = hashHex.slice(5);

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: async () =>
          `${suffix}:12345\nABCDEF1234567890ABCDEF1234567890ABC:1`,
      } as Response);

      const result = await isPasswordBreached("password");

      expect(result).toBe(true);
    });

    it("returns false when API returns non-200", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 503,
      } as Response);

      const result = await isPasswordBreached("test");

      expect(result).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// spamDetection.ts
// ─────────────────────────────────────────────────────────────────────────────
describe("spamDetection.ts", () => {
  beforeEach(() => {
    vi.mocked(db.listing.count).mockReset();
    vi.mocked(db.message.count).mockReset();
  });

  describe("checkListingSpam", () => {
    const baseParams = {
      userId: "user-1",
      title: "My Listing",
      description:
        "A perfectly normal listing with enough description text to pass the length check easily and avoid short desc signal.",
      priceNzd: 100,
      accountCreatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    };

    it("new account + high value → score ≥ 30 with 'new_account_high_value' signal", async () => {
      vi.mocked(db.listing.count).mockResolvedValue(0 as never);

      const result = await checkListingSpam({
        ...baseParams,
        priceNzd: 60000,
        accountCreatedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      });

      expect(result.score).toBeGreaterThanOrEqual(30);
      expect(result.signals).toContain("new_account_high_value");
    });

    it("high listing velocity → score ≥ 40 with 'high_listing_velocity' signal", async () => {
      vi.mocked(db.listing.count)
        .mockResolvedValueOnce(10 as never)
        .mockResolvedValueOnce(0 as never);

      const result = await checkListingSpam(baseParams);

      expect(result.score).toBeGreaterThanOrEqual(40);
      expect(result.signals).toContain("high_listing_velocity");
    });

    it("duplicate title → score ≥ 25 with 'duplicate_title' signal", async () => {
      vi.mocked(db.listing.count)
        .mockResolvedValueOnce(0 as never)
        .mockResolvedValueOnce(1 as never);

      const result = await checkListingSpam(baseParams);

      expect(result.score).toBeGreaterThanOrEqual(25);
      expect(result.signals).toContain("duplicate_title");
    });

    it("short description + high value → includes 'short_description_high_value'", async () => {
      vi.mocked(db.listing.count).mockResolvedValue(0 as never);

      const result = await checkListingSpam({
        ...baseParams,
        priceNzd: 15000,
        description: "Short desc",
      });

      expect(result.signals).toContain("short_description_high_value");
    });

    it("normal listing → low score, no block/flag", async () => {
      vi.mocked(db.listing.count).mockResolvedValue(0 as never);

      const result = await checkListingSpam(baseParams);

      expect(result.score).toBeLessThan(40);
      expect(result.block).toBe(false);
      expect(result.flag).toBe(false);
    });
  });

  describe("checkMessageSpam", () => {
    const baseParams = {
      userId: "user-1",
      body: "Hello, interested in your listing!",
    };

    it("message flooding (≥20) → score ≥ 50, blocked", async () => {
      vi.mocked(db.message.count)
        .mockResolvedValueOnce(20 as never)
        .mockResolvedValueOnce(0 as never);

      const result = await checkMessageSpam(baseParams);

      expect(result.score).toBeGreaterThanOrEqual(50);
      expect(result.signals).toContain("message_flooding");
    });

    it("duplicate messages (≥3) → score ≥ 35 with duplicate_messages signal", async () => {
      vi.mocked(db.message.count)
        .mockResolvedValueOnce(0 as never)
        .mockResolvedValueOnce(3 as never);

      const result = await checkMessageSpam(baseParams);

      expect(result.score).toBeGreaterThanOrEqual(35);
      expect(result.signals).toContain("duplicate_messages");
    });

    it("normal messages → low score", async () => {
      vi.mocked(db.message.count).mockResolvedValue(0 as never);

      const result = await checkMessageSpam(baseParams);

      expect(result.score).toBeLessThan(40);
      expect(result.block).toBe(false);
      expect(result.flag).toBe(false);
    });
  });
});
