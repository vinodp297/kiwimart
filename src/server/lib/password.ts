// src/server/lib/password.ts
// ─── Password Hashing — Argon2id ─────────────────────────────────────────────
// Uses argon2 npm package (bindings to the reference C implementation).
// Parameters follow OWASP Password Storage Cheat Sheet (2024):
//   • Algorithm: Argon2id (combines Argon2i + Argon2d — resistant to both
//     side-channel and GPU attacks)
//   • Memory: 64 MB (m=65536)
//   • Iterations: 3 (t=3)
//   • Parallelism: 1 (p=1)
//   • Output length: 32 bytes
//
// Never runs on the Edge Runtime — argon2 requires Node.js native bindings.
// Called only from server actions and API routes that run in Node.js context.

import argon2 from "argon2";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;

/**
 * Hash a plaintext password.
 * Returns a string in the PHC format: $argon2id$v=19$m=65536,t=3,p=1$...
 * Safe to store directly in the database.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored Argon2id hash.
 * Constant-time comparison — safe against timing attacks.
 * Returns true if password matches, false otherwise.
 * Never throws — all errors are caught and return false.
 */
export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Malformed hash or argon2 error — treat as mismatch
    return false;
  }
}

/**
 * Check if a stored hash needs to be rehashed (e.g., if cost params changed).
 * Call after a successful verifyPassword and rehash transparently if true.
 */
export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, ARGON2_OPTIONS);
}

/**
 * Check if a password has appeared in a known data breach using the
 * HaveIBeenPwned k-anonymity API. Never sends the full password — only the
 * first 5 hex characters of the SHA-1 hash are transmitted.
 *
 * Returns true if the password is breached, false if it is safe.
 * Wraps network errors and returns false (fail-open) — never blocks registration
 * if the breach-check API is unavailable.
 */
export async function isPasswordBreached(password: string): Promise<boolean> {
  try {
    const hashBuffer = await crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(password),
    );
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();

    const prefix = hashHex.slice(0, 5);
    const suffix = hashHex.slice(5);

    const response = await fetch(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      { headers: { "Add-Padding": "true" } },
    );

    if (!response.ok) return false; // API error — fail-open

    const text = await response.text();
    return text.split("\n").some((line) => line.startsWith(suffix));
  } catch {
    // Network failure or SubtleCrypto error — fail-open, do not block registration
    return false;
  }
}
