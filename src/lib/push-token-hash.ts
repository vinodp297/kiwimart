// src/lib/push-token-hash.ts
// ─── Push token SHA-256 hashing ───────────────────────────────────────────────
// Raw FCM/APNs/Web Push tokens are sensitive device identifiers. Storing a
// SHA-256 hash as the unique DB key means a DB breach cannot be used to
// directly send rogue push notifications — the attacker gets the hash, not
// the registerable token.
//
// Design:
//   - SHA-256 is deterministic, so the same token always produces the same
//     hash (needed for upsert/deactivate lookups).
//   - The raw token is still required for actual push-service API calls.
//     Callers store the hash in `tokenHash`; the raw token is NOT persisted.

import crypto from "crypto";

/**
 * Return the SHA-256 hex digest of a push token.
 *
 * Used as the `tokenHash` field in PushToken rows so DB uniqueness and
 * lookup use the hash rather than the plaintext registerable token.
 */
export function hashPushToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
