// src/lib/auth/index.ts
// Assembles NextAuth configuration from split modules and re-exports
// the public API: handlers, auth, signIn, signOut.

import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import db from "@/lib/db";
import { credentialsProvider, googleProvider } from "./auth.providers";
import { callbacks, events } from "./auth.callbacks";
import { SECONDS_PER_MINUTE } from "@/lib/time";

// 15-minute JWT lifetime — minimises exposure window if Redis is unavailable
// and a revoked token cannot be blocklisted. Sliding refresh (see
// auth.callbacks.ts) transparently re-issues tokens for active sessions so
// users are not logged out mid-session.
export const JWT_MAX_AGE = 15 * SECONDS_PER_MINUTE;

// Tokens older than 5 minutes trigger a silent refresh. Must be less than
// JWT_MAX_AGE to guarantee at least one refresh opportunity per window.
export const JWT_REFRESH_THRESHOLD = 5 * SECONDS_PER_MINUTE;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),

  session: {
    strategy: "jwt",
    maxAge: JWT_MAX_AGE,
  },

  jwt: {
    maxAge: JWT_MAX_AGE,
  },

  pages: {
    signIn: "/login",
    error: "/login",
    verifyRequest: "/verify-email",
  },

  providers: [credentialsProvider, googleProvider],

  callbacks,

  events,
});
