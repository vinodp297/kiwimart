// src/test/push-token-hash.test.ts
// ─── Tests: Push token SHA-256 hashing (Task I6) ──────────────────────────────
// Verifies that:
//   1. hashPushToken returns a 64-character hex string (SHA-256 output)
//   2. Same input always produces the same hash (deterministic)
//   3. Different inputs produce different hashes (collision resistance check)
//   4. Hash does not contain the raw token value (non-reversible)
//   5. notification.repository.ts uses tokenHash (not raw token) as unique key

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { hashPushToken } from "@/lib/push-token-hash";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf-8");
}

describe("Push token hashing — Task I6", () => {
  // ── Test 1: Returns 64-char hex string (SHA-256 = 256 bits = 32 bytes = 64 hex chars) ──
  it("hashPushToken returns a 64-character lowercase hex string", () => {
    const hash = hashPushToken("fcm:someRegistrationToken123");

    expect(typeof hash).toBe("string");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── Test 2: Deterministic — same input → same hash ────────────────────────
  it("hashPushToken is deterministic (same input → same hash)", () => {
    const token = "apns:exampleDeviceToken456";
    const hash1 = hashPushToken(token);
    const hash2 = hashPushToken(token);

    expect(hash1).toBe(hash2);
  });

  // ── Test 3: Different inputs produce different hashes ─────────────────────
  it("different tokens produce different hashes", () => {
    const hash1 = hashPushToken("token-alpha");
    const hash2 = hashPushToken("token-beta");

    expect(hash1).not.toBe(hash2);
  });

  // ── Test 4: Hash does not contain the raw token (non-reversible check) ────
  it("hash output does not contain the raw token string", () => {
    const rawToken = "web:push-subscription-endpoint-abc";
    const hash = hashPushToken(rawToken);

    // The raw token text should not appear anywhere in the hex digest
    expect(hash).not.toContain(rawToken);
    expect(hash).not.toContain("web");
    expect(hash).not.toContain("push");
  });

  // ── Test 5: notification.repository uses tokenHash as lookup key ──────────
  it("notification.repository.ts uses tokenHash (not raw token) for upsert/deactivate", () => {
    const repo = read("src/modules/notifications/notification.repository.ts");

    // hashPushToken must be imported
    expect(repo).toContain("hashPushToken");
    expect(repo).toContain("push-token-hash");

    // upsertPushToken must compute and use tokenHash
    expect(repo).toContain("tokenHash");
    expect(repo).toContain("where: { tokenHash }");

    // deactivatePushToken must also use tokenHash for the where clause
    const deactivateSection = repo.slice(repo.indexOf("deactivatePushToken"));
    expect(deactivateSection).toContain("tokenHash");
  });
});
