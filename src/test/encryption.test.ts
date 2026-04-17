// src/test/encryption.test.ts
// ─── Tests: AES-256-GCM field-level encryption ──────────────────────────────
// Covers round-trip, unique-iv-per-call, tamper detection (authTag), key
// validation (missing / wrong length), and isEncryptionConfigured.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

const VALID_KEY = crypto.randomBytes(32).toString("hex");

const original = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = VALID_KEY;
});

afterEach(() => {
  if (original === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = original;
  }
});

// ─────────────────────────────────────────────────────────────────────────────

describe("encryption — round trip", () => {
  it("encrypts and decrypts a simple string losslessly", async () => {
    const { encrypt, decrypt } = await import("@/lib/encryption");

    const plaintext = "0215551234";
    const ciphertext = encrypt(plaintext);

    expect(ciphertext).not.toBe(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("handles unicode + special characters", async () => {
    const { encrypt, decrypt } = await import("@/lib/encryption");

    const plaintext = "Kia ora 🇳🇿 — ñóäñ";
    const ciphertext = encrypt(plaintext);

    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("handles empty string", async () => {
    const { encrypt, decrypt } = await import("@/lib/encryption");

    const ciphertext = encrypt("");
    expect(decrypt(ciphertext)).toBe("");
  });
});

describe("encryption — randomness", () => {
  it("produces a different ciphertext for the same plaintext (unique IV)", async () => {
    const { encrypt } = await import("@/lib/encryption");

    const c1 = encrypt("secret");
    const c2 = encrypt("secret");

    expect(c1).not.toBe(c2);
  });

  it("ciphertext is base64-encoded", async () => {
    const { encrypt } = await import("@/lib/encryption");

    const ciphertext = encrypt("hello");
    // base64 chars only
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

describe("encryption — key validation", () => {
  it("throws when ENCRYPTION_KEY is missing", async () => {
    delete process.env.ENCRYPTION_KEY;
    const { encrypt } = await import("@/lib/encryption");

    expect(() => encrypt("test")).toThrow(/ENCRYPTION_KEY/);
  });

  it("throws when key is the wrong length", async () => {
    process.env.ENCRYPTION_KEY = "too-short";
    const { encrypt } = await import("@/lib/encryption");

    expect(() => encrypt("test")).toThrow(/64-character hex/);
  });

  it("throws when decrypt runs with missing key", async () => {
    const { encrypt } = await import("@/lib/encryption");
    const ciphertext = encrypt("test");

    delete process.env.ENCRYPTION_KEY;
    const { decrypt } = await import("@/lib/encryption");

    expect(() => decrypt(ciphertext)).toThrow(/ENCRYPTION_KEY/);
  });
});

describe("encryption — tamper detection", () => {
  it("throws when ciphertext is tampered (authTag check fails)", async () => {
    const { encrypt, decrypt } = await import("@/lib/encryption");

    const ciphertext = encrypt("authentic message");
    // Flip one bit in the middle — should fail authentication
    const bytes = Buffer.from(ciphertext, "base64");
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    const tampered = bytes.toString("base64");

    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws when decrypt is called with non-base64 input", async () => {
    const { decrypt } = await import("@/lib/encryption");

    // base64 decode of "not base64" yields garbage that's too short to
    // contain iv + authTag + anything — decrypt must throw.
    expect(() => decrypt("not base64!!!")).toThrow();
  });
});

describe("isEncryptionConfigured", () => {
  it("returns true when a valid 64-char hex key is set", async () => {
    const { isEncryptionConfigured } = await import("@/lib/encryption");

    expect(isEncryptionConfigured()).toBe(true);
  });

  it("returns false when key is missing", async () => {
    delete process.env.ENCRYPTION_KEY;
    const { isEncryptionConfigured } = await import("@/lib/encryption");

    expect(isEncryptionConfigured()).toBe(false);
  });

  it("returns false when key is the wrong length", async () => {
    process.env.ENCRYPTION_KEY = "abc";
    const { isEncryptionConfigured } = await import("@/lib/encryption");

    expect(isEncryptionConfigured()).toBe(false);
  });
});
