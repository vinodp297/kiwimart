// src/types/next-auth.d.ts
// ─── Auth.js Type Augmentation ────────────────────────────────────────────────
// Adds KiwiMart-specific fields to the Auth.js Session and User types.
// Without this, TypeScript won't know about username, sellerEnabled, etc.

import type { DefaultSession, DefaultUser } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      username: string;
      sellerEnabled: boolean;
      isAdmin: boolean;
      idVerified: boolean;
    } & DefaultSession['user'];
  }

  interface User extends DefaultUser {
    username?: string;
    sellerEnabled?: boolean;
    isAdmin?: boolean;
    idVerified?: boolean;
  }
}

