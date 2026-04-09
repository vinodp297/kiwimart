// src/lib/auth/index.ts
// Assembles NextAuth configuration from split modules and re-exports
// the public API: handlers, auth, signIn, signOut.

import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import db from "@/lib/db";
import { credentialsProvider, googleProvider } from "./auth.providers";
import { callbacks, events } from "./auth.callbacks";
import { SECONDS_PER_HOUR } from "@/lib/time";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),

  session: {
    strategy: "jwt",
    // 1-hour expiry — short window limits exposure if Redis is unavailable
    // and a token can't be blocklisted after sign-out.
    maxAge: SECONDS_PER_HOUR,
  },

  jwt: {
    maxAge: SECONDS_PER_HOUR,
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
