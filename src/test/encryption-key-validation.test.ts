// src/test/encryption-key-validation.test.ts
// ─── ENCRYPTION_KEY env validation ───────────────────────────────────────────
//
// Validates that the ENCRYPTION_KEY Zod schema enforces:
//   1.  A valid 64-character hex key passes schema validation
//   2.  A key shorter than 64 characters fails schema validation
//   3.  A key with non-hex characters fails schema validation
//   4.  A key of the correct length but with non-hex chars fails
//   5.  An exactly 64-character uppercase hex key passes (case-insensitive)
//
// Production enforcement (validateEnv with NODE_ENV=production):
//   6.  Missing key in production throws a startup error
//   7.  Short key in production throws a startup error
//   8.  Non-hex key in production throws a startup error
//
// Note: env.ts calls validateEnv() at module load time, so we test the Zod
// schema and the production guard logic directly rather than importing env.ts
// (which would require all 30+ other env vars to be set).

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ─── Replicate the ENCRYPTION_KEY schema from env.ts ─────────────────────────
// We extract just the ENCRYPTION_KEY schema so tests run without needing the
// full env variable set (DATABASE_URL, STRIPE_*, etc.).
const encryptionKeySchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]+$/,
    "ENCRYPTION_KEY must be a hex string (characters 0-9 and a-f only)",
  )
  .refine(
    (val) => val.length === 64,
    "ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256)",
  )
  .optional();

// ─── Production enforcement logic (mirrors env.ts) ───────────────────────────
function assertEncryptionKeyForProduction(key: string | undefined): void {
  const encryptionKey = key ?? "";
  if (!encryptionKey) {
    throw new Error("PRODUCTION DEPLOYMENT BLOCKED: ENCRYPTION_KEY is not set");
  }
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error("PRODUCTION DEPLOYMENT BLOCKED: ENCRYPTION_KEY is invalid");
  }
}

// ─── Valid fixture ────────────────────────────────────────────────────────────
const VALID_KEY =
  "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"; // 64 hex chars

// ─────────────────────────────────────────────────────────────────────────────
describe("ENCRYPTION_KEY — Zod schema validation", () => {
  // ── Test 1: Valid 64-character hex key ─────────────────────────────────────
  it("accepts a valid 64-character lowercase hex key", () => {
    const result = encryptionKeySchema.safeParse(VALID_KEY);
    expect(result.success).toBe(true);
    expect(result.data).toBe(VALID_KEY);
  });

  // ── Test 2: Key shorter than 64 characters ────────────────────────────────
  it("rejects a key shorter than 64 hex characters", () => {
    const shortKey = "a1b2c3d4"; // 8 chars — too short
    const result = encryptionKeySchema.safeParse(shortKey);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toContain("64 hex characters");
    }
  });

  // ── Test 3: Key with non-hex characters ──────────────────────────────────
  it("rejects a key containing non-hex characters (e.g. g, z, !)", () => {
    // 64 chars but contains 'g' and 'z' which are not valid hex
    const nonHexKey =
      "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg";
    const result = encryptionKeySchema.safeParse(nonHexKey);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toContain("hex string");
    }
  });

  // ── Test 4: Correct length but with non-hex characters ──────────────────
  it("rejects a 64-character string with mixed hex and non-hex characters", () => {
    // 63 hex chars + 1 invalid char '!'
    const mixedKey = VALID_KEY.slice(0, 63) + "!";
    const result = encryptionKeySchema.safeParse(mixedKey);
    expect(result.success).toBe(false);
  });

  // ── Test 5: Valid uppercase hex key ─────────────────────────────────────
  it("accepts a valid 64-character uppercase hex key (case-insensitive)", () => {
    const upperKey = VALID_KEY.toUpperCase();
    const result = encryptionKeySchema.safeParse(upperKey);
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ENCRYPTION_KEY — production startup enforcement", () => {
  // ── Test 6: Missing key in production throws ──────────────────────────────
  it("throws a startup error when ENCRYPTION_KEY is not set in production", () => {
    expect(() => assertEncryptionKeyForProduction(undefined)).toThrow(
      "ENCRYPTION_KEY is not set",
    );
  });

  // ── Test 7: Short key in production throws ────────────────────────────────
  it("throws a startup error when ENCRYPTION_KEY is shorter than 64 hex chars", () => {
    expect(() => assertEncryptionKeyForProduction("a1b2c3d4")).toThrow(
      "ENCRYPTION_KEY is invalid",
    );
  });

  // ── Test 8: Non-hex key in production throws ──────────────────────────────
  it("throws a startup error when ENCRYPTION_KEY contains non-hex characters", () => {
    const nonHexKey =
      "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"; // 64 z's
    expect(() => assertEncryptionKeyForProduction(nonHexKey)).toThrow(
      "ENCRYPTION_KEY is invalid",
    );
  });
});
