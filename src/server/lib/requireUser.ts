// src/server/lib/requireUser.ts
// ─── Shared auth + ban check for all sensitive server actions ─────────────────
// With database sessions (strategy: 'database'), session data is always fresh
// from the DB via the adapter. The session() callback populates user fields
// directly from the User row on every request.
//
// Defence-in-depth: we still check isBanned from the session (which IS fresh
// with DB sessions) rather than trusting blindly. If a ban happens between
// session reads (within updateAge window), requireUser() catches it.

import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { AppError } from "@/shared/errors";

export type AuthenticatedUser = {
  id: string;
  email: string;
  isAdmin: boolean;
  isSellerEnabled: boolean;
  isStripeOnboarded: boolean;
};

export async function requireUser(): Promise<AuthenticatedUser> {
  const session = await auth();

  if (!session?.user?.id) {
    throw AppError.unauthenticated();
  }

  // With DB sessions, session.user.isBanned is fresh from the DB.
  // But as defence-in-depth, also do a direct DB check on mutations
  // to catch bans that happened within the updateAge window.
  //
  // deletedAt: null — rejects users soft-deleted via deleteAccount().
  // A JWT issued before deletion is valid for up to 1 hour; this guard
  // ensures such tokens can never perform any server action.
  const user = await db.user.findUnique({
    where: {
      id: session.user.id,
      deletedAt: null, // Reject soft-deleted accounts
    },
    select: {
      id: true,
      email: true,
      isAdmin: true,
      isBanned: true,
      isSellerEnabled: true,
      isStripeOnboarded: true,
    },
  });

  if (!user) {
    // User not found OR deletedAt is set — treat both as unauthenticated
    throw AppError.unauthenticated();
  }

  if (user.isBanned) {
    // Delete their sessions to force logout on next request
    await db.session
      .deleteMany({ where: { userId: user.id } })
      .catch((err: unknown) => {
        console.error(
          "[requireUser] session cleanup failed",
          err instanceof Error ? err.message : String(err),
        );
      });
    throw AppError.banned();
  }

  return {
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    isSellerEnabled: user.isSellerEnabled,
    isStripeOnboarded: user.isStripeOnboarded,
  };
}
