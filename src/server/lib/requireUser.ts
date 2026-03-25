// src/server/lib/requireUser.ts
// ─── Shared auth + ban check for all sensitive server actions ─────────────────
// With database sessions (strategy: 'database'), session data is always fresh
// from the DB via the adapter. The session() callback populates user fields
// directly from the User row on every request.
//
// Defence-in-depth: we still check isBanned from the session (which IS fresh
// with DB sessions) rather than trusting blindly. If a ban happens between
// session reads (within updateAge window), requireUser() catches it.

import { auth } from '@/lib/auth';
import db from '@/lib/db';

export type AuthenticatedUser = {
  id: string;
  email: string;
  isAdmin: boolean;
  sellerEnabled: boolean;
  stripeOnboarded: boolean;
};

export async function requireUser(): Promise<AuthenticatedUser> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new Error('Unauthorised — please sign in');
  }

  // With DB sessions, session.user.isBanned is fresh from the DB.
  // But as defence-in-depth, also do a direct DB check on mutations
  // to catch bans that happened within the updateAge window.
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      isAdmin: true,
      isBanned: true,
      sellerEnabled: true,
      stripeOnboarded: true,
    },
  });

  if (!user) {
    throw new Error('Unauthorised — user not found');
  }

  if (user.isBanned) {
    // Delete their sessions to force logout on next request
    await db.session.deleteMany({ where: { userId: user.id } }).catch(() => {});
    throw new Error(
      'Your account has been suspended. Contact support@kiwimart.co.nz for help.'
    );
  }

  return {
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    sellerEnabled: user.sellerEnabled,
    stripeOnboarded: user.stripeOnboarded,
  };
}
