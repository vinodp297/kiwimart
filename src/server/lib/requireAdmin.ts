// src/server/lib/requireAdmin.ts
// ─── Admin Guard ──────────────────────────────────────────────────────────────
// Always performs a fresh DB check — never trusts JWT isAdmin claim alone.
// Banning a user + deleting their session rows gives instant revocation.

import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { audit } from '@/server/lib/audit';

/**
 * Verifies the current session is an active, non-banned admin.
 * Returns { userId } on success or { error } on failure.
 * Always queries the DB — stale JWT claims are rejected.
 */
export async function requireAdmin(): Promise<{ userId: string } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'Authentication required.' };

  // ALWAYS check DB — never trust JWT isAdmin claim
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      isAdmin: true,
      isBanned: true,
    },
  });

  if (!user) return { error: 'User not found.' };

  if (user.isBanned) return { error: 'Account suspended.' };

  if (!user.isAdmin) {
    // Audit attempted admin access with stale/invalid token
    audit({
      userId: session.user.id,
      action: 'ADMIN_ACTION',
      entityType: 'User',
      entityId: session.user.id,
      metadata: {
        denied: true,
        reason: 'not_admin_in_db',
        tokenClaim: (session.user as { isAdmin?: boolean }).isAdmin,
      },
    });
    return { error: 'Unauthorised.' };
  }

  return { userId: user.id };
}
