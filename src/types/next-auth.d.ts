// src/types/next-auth.d.ts
// ─── Auth.js Type Augmentation ────────────────────────────────────────────────
// Adds KiwiMart-specific fields to the Auth.js Session and User types.
// With database sessions, session.user is populated from the DB User row
// in the session() callback — these types reflect that.

import type { DefaultSession, DefaultUser } from "next-auth";
import type { JWT as DefaultJWT } from "next-auth/jwt";

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id?: string;
    isAdmin?: boolean;
    isBanned?: boolean;
    sellerEnabled?: boolean;
    stripeOnboarded?: boolean;
    displayName?: string;
    username?: string;
    avatarUrl?: string | null;
    emailVerified?: string | null;
    idVerified?: boolean;
    mfaPending?: boolean;
    sessionVersion?: number;
  }
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      isAdmin: boolean;
      isBanned: boolean;
      sellerEnabled: boolean;
      stripeOnboarded: boolean;
      displayName: string;
      username: string;
      avatarUrl?: string | null;
      // emailVerified kept as Date | null to match Auth.js native type
      // Check truthiness in components: !!session.user.emailVerified
      emailVerified: Date | null;
      idVerified: boolean;
      mfaPending: boolean;
    };
  }

  interface User extends DefaultUser {
    isAdmin?: boolean;
    isBanned?: boolean;
    sellerEnabled?: boolean;
    stripeOnboarded?: boolean;
    displayName?: string;
    username?: string;
    avatarUrl?: string | null;
    emailVerified?: Date | null;
    idVerified?: boolean;
  }
}
