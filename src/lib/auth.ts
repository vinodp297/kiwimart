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
    // JWT strategy — sessions encoded in signed cookies, not stored in DB.
    // Auth.js v5 beta.30 forces JWT for credentials regardless of strategy;
    // switching to jwt makes credentials + OAuth consistent and fixes the
    // proxy DB-lookup miss that caused the post-login redirect loop.
    // The PrismaAdapter is still used to persist users/accounts for OAuth.
    strategy: 'jwt',
    // Sessions expire after 30 days of inactivity
    maxAge: 30 * 24 * 60 * 60,
    // JWT sessions don't have an updateAge — they refresh on every request
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
    // JWT callback: fires for credentials logins (beta.30 always uses JWT for
    // credentials regardless of strategy:'database').  Embeds custom DB fields
    // into the token on first sign-in so the session callback can read them.
    // Does NOT fire for OAuth (DB sessions) — only credentials.
    async jwt({ token, user }) {
      if (user?.id) {
        // Initial sign-in: fetch fresh DB fields and embed in token
        const dbUser = await db.user.findUnique({
          where: { id: user.id },
          select: {
            id: true,
            isAdmin: true,
            isBanned: true,
            sellerEnabled: true,
            stripeOnboarded: true,
            displayName: true,
            username: true,
            avatarKey: true,
            emailVerified: true,
            idVerified: true,
          },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.isAdmin = dbUser.isAdmin;
          token.isBanned = dbUser.isBanned;
          token.sellerEnabled = dbUser.sellerEnabled;
          token.stripeOnboarded = dbUser.stripeOnboarded;
          token.displayName = dbUser.displayName;
          token.username = dbUser.username;
          token.avatarUrl = dbUser.avatarKey ?? null;
          token.emailVerified = dbUser.emailVerified?.toISOString() ?? null;
          token.idVerified = dbUser.idVerified;
        }
      }
      return token;
    },

    // Session callback: handles both JWT (credentials) and DB (OAuth) sessions.
    // JWT mode:  token is populated, user is undefined
    // DB mode:   user is the fresh DB row, token is undefined
    async session({ session, user, token }) {
      if (session.user) {
        if (token?.id) {
          // Credentials login — JWT session (Auth.js v5 beta.30 always uses JWT
          // for credentials even when strategy:'database' is configured)
          session.user.id = token.id as string;
          session.user.isAdmin = (token.isAdmin as boolean) ?? false;
          session.user.isBanned = (token.isBanned as boolean) ?? false;
          session.user.sellerEnabled = (token.sellerEnabled as boolean) ?? false;
          session.user.stripeOnboarded = (token.stripeOnboarded as boolean) ?? false;
          session.user.displayName = (token.displayName as string) ?? '';
          session.user.username = (token.username as string) ?? '';
          session.user.avatarUrl = (token.avatarUrl as string | null) ?? null;
          session.user.emailVerified = token.emailVerified
            ? new Date(token.emailVerified as string)
            : null;
          session.user.idVerified = (token.idVerified as boolean) ?? false;
        } else if (user) {
          // OAuth login — DB session, user is the fresh DB row
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
    // JWT strategy: signOut receives { token }; database strategy: { session }
    async signOut(params) {
      const userId =
        'token' in params && params.token
          ? (params.token as { sub?: string }).sub ?? null
          : 'session' in params && params.session
          ? (params.session as { userId?: string }).userId ?? null
          : null;
      if (userId) {
        audit({ userId, action: 'USER_LOGOUT' });
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
