// src/lib/auth.ts
// ─── Auth.js v5 Configuration ────────────────────────────────────────────────
// Providers: Credentials (email + Argon2id) + Google OAuth
// Session strategy: database sessions for instant revocation
// Security extras:
//   * Session tokens stored as secure, httpOnly, sameSite=lax cookies
//   * CSRF protection: Auth.js built-in double-submit cookie
//   * Cloudflare Turnstile verified inside credentials authorize()
//   * Failed login attempts audit-logged (without the password)
//   * Banning a user deletes their session rows → instant revocation
//
// References:
//   https://authjs.dev/getting-started/installation?framework=next.js

import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import db from '@/lib/db';
import { verifyPassword, needsRehash, hashPassword } from '@/server/lib/password';
import { audit } from '@/server/lib/audit';
import { loginSchema } from '@/server/validators';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),

  session: {
    // DATABASE strategy — sessions stored in DB, not JWT
    // Enables instant revocation: delete session row → user is logged out
    strategy: 'database',
    // Sessions expire after 30 days of inactivity
    maxAge: 30 * 24 * 60 * 60,
    // Refresh session data from DB every 24h
    updateAge: 24 * 60 * 60,
  },

  pages: {
    signIn: '/login',
    error: '/login',
    verifyRequest: '/verify-email',
  },

  providers: [
    // ── Credentials (email + password) ───────────────────────────────────────
    Credentials({
      credentials: {
        email: { type: 'email' },
        password: { type: 'password' },
        turnstileToken: { type: 'text' }, // Cloudflare Turnstile
      },

      async authorize(credentials) {
        // 1. Validate input shape with Zod
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password, turnstileToken } = parsed.data;

        // 2. Verify Cloudflare Turnstile token (bot protection)
        if (process.env.NODE_ENV === 'production') {
          const turnstileOk = await verifyTurnstile(turnstileToken);
          if (!turnstileOk) {
            // Turnstile verification failed — silent return null
            return null;
          }
        }

        // 3. Look up user — timing-safe: always hash even if user doesn't exist
        const user = await db.user.findUnique({
          where: { email: email.toLowerCase() },
          select: {
            id: true,
            email: true,
            displayName: true,
            passwordHash: true,
            emailVerified: true,
            isBanned: true,
            bannedReason: true,
            sellerEnabled: true,
            isAdmin: true,
          },
        });

        // 4. Dummy hash compare if user not found (prevent user enumeration via timing)
        const DUMMY_HASH =
          '$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG';
        const hashToVerify = user?.passwordHash ?? DUMMY_HASH;
        const passwordValid = await verifyPassword(hashToVerify, password);

        if (!user || !passwordValid) {
          // Audit failed attempt (without the password)
          audit({
            userId: user?.id ?? null,
            action: 'USER_LOGIN',
            metadata: { success: false, reason: 'invalid_credentials', email },
          });
          return null;
        }

        // 5. Check bans
        if (user.isBanned) {
          audit({
            userId: user.id,
            action: 'USER_LOGIN',
            metadata: { success: false, reason: 'banned' },
          });
          return null;
        }

        // 6. Transparent rehash if cost params changed
        if (user.passwordHash && needsRehash(user.passwordHash)) {
          const newHash = await hashPassword(password);
          await db.user.update({
            where: { id: user.id },
            data: { passwordHash: newHash },
          });
        }

        // 7. Audit successful login
        audit({
          userId: user.id,
          action: 'USER_LOGIN',
          metadata: { success: true },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
        };
      },
    }),

    // ── Google OAuth ──────────────────────────────────────────────────────────
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Auto-link Google accounts to existing email accounts
      allowDangerousEmailAccountLinking: false,
    }),
  ],

  callbacks: {
    // With database sessions, the session callback receives { session, user }
    // where `user` is the full User row from the database (always fresh).
    // No JWT involved — no stale claims.
    async session({ session, user }) {
      if (session.user && user) {
        // user is the DB row — always fresh, never stale
        const dbUser = user as typeof user & {
          isAdmin: boolean;
          isBanned: boolean;
          sellerEnabled: boolean;
          stripeOnboarded: boolean;
          displayName: string;
          username: string;
          avatarUrl?: string | null;
          idVerified: boolean;
        };

        session.user.id = dbUser.id;
        session.user.isAdmin = dbUser.isAdmin;
        session.user.isBanned = dbUser.isBanned;
        session.user.sellerEnabled = dbUser.sellerEnabled;
        session.user.stripeOnboarded = dbUser.stripeOnboarded;
        session.user.displayName = dbUser.displayName;
        session.user.username = dbUser.username;
        session.user.avatarUrl = dbUser.avatarUrl ?? null;
        session.user.emailVerified = dbUser.emailVerified ?? null;
        session.user.idVerified = dbUser.idVerified;
      }
      return session;
    },

    // Control sign-in flow
    async signIn({ user, account }) {
      // Block banned users at the OAuth level too
      if (account?.provider !== 'credentials') {
        const dbUser = await db.user.findUnique({
          where: { email: user.email! },
          select: { isBanned: true },
        });
        if (dbUser?.isBanned) return false;
      }
      return true;
    },
  },

  events: {
    // Audit logout events
    // With database sessions, signOut receives the session object
    async signOut(params) {
      const session = ('session' in params ? params.session : null) as
        | { userId?: string }
        | null;
      if (session?.userId) {
        audit({
          userId: session.userId,
          action: 'USER_LOGOUT',
        });
      }
    },
  },
});

// ── Cloudflare Turnstile verification ─────────────────────────────────────────

async function verifyTurnstile(token: string): Promise<boolean> {
  if (!token) return false;

  try {
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY!,
          response: token,
        }),
      }
    );
    const data = (await res.json()) as { success: boolean };
    return data.success;
  } catch {
    // Network error — fail open in development, fail closed in production
    return process.env.NODE_ENV !== 'production';
  }
}
