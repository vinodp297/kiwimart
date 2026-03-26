// src/server/lib/requireAdmin.ts
// ─── Admin Guard (backward-compatible wrapper) ────────────────────────────────
// Delegates to requireAnyAdmin() but returns the legacy union type so existing
// callers that check `'error' in guard` continue to work unchanged.

import { requireAnyAdmin } from '@/shared/auth/requirePermission'
import { AppError } from '@/shared/errors'

/**
 * Verifies the current session is an active, non-banned admin.
 * Returns { userId } on success or { error } on failure.
 * Always queries the DB — stale JWT claims are rejected.
 */
export async function requireAdmin(): Promise<{ userId: string } | { error: string }> {
  try {
    const admin = await requireAnyAdmin()
    return { userId: admin.id }
  } catch (err) {
    if (err instanceof AppError) {
      return { error: err.message }
    }
    return { error: 'An unexpected error occurred.' }
  }
}
