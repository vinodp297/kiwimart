// src/lib/auth/auth.callbacks.ts
// NextAuth callbacks (jwt, session, signIn) and events (signOut).

import db from "@/lib/db";
import { blockToken, isTokenBlocked } from "@/server/lib/jwtBlocklist";
import { isMfaVerified } from "@/server/lib/mfaSession";
import {
  getSessionVersion,
  invalidateAllSessions,
} from "@/server/lib/sessionStore";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { JWT_REFRESH_THRESHOLD } from "@/lib/auth";
import type { NextAuthConfig } from "next-auth";

export const callbacks: NonNullable<NextAuthConfig["callbacks"]> = {
  // JWT callback: fires on every request for JWT-based sessions.
  // 1. Check jti blocklist — reject individually-revoked tokens.
  // 2. Check session version — reject tokens issued before the last sign-out.
  // 3. Assign a jti if the token doesn't have one yet (first issue).
  // 4. On initial sign-in: embed session version + custom DB fields.
  async jwt({ token, user, trigger: _trigger }) {
    // For admin tokens, fail CLOSED if Redis is unavailable — a Redis outage
    // must NOT grant admin access with a stolen/revoked JWT.
    const isAdminToken = !!token?.isAdmin;

    if (token?.jti) {
      const blocked = await isTokenBlocked(token.jti as string, {
        failClosed: isAdminToken,
      });
      if (blocked) return null; // invalidate session
    }

    // If the server's version for this user is higher than the one baked into
    // the token, the user signed out (or was force-logged-out) after this
    // token was issued → reject it.
    if (token.sub && typeof token.sessionVersion === "number") {
      const currentVersion = await getSessionVersion(token.sub, {
        failClosed: isAdminToken,
      });
      if (currentVersion > token.sessionVersion) {
        logger.info("jwt.session_version_mismatch", {
          userId: token.sub,
          tokenVersion: token.sessionVersion,
          currentVersion,
        });
        return null; // invalidate session
      }
    }

    if (!token.jti) {
      token.jti = crypto.randomUUID();
    }

    if (user?.id) {
      // Stamp the current session version into the token so we can detect
      // subsequent sign-outs via the version-mismatch check above.
      token.sessionVersion = await getSessionVersion(user.id);

      const dbUser = await db.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          isAdmin: true,
          isBanned: true,
          isSellerEnabled: true,
          isStripeOnboarded: true,
          displayName: true,
          username: true,
          avatarKey: true,
          emailVerified: true,
          idVerified: true,
          isMfaEnabled: true,
        },
      });
      if (dbUser) {
        token.id = dbUser.id;
        token.isAdmin = dbUser.isAdmin;
        token.isBanned = dbUser.isBanned;
        token.isSellerEnabled = dbUser.isSellerEnabled;
        token.isStripeOnboarded = dbUser.isStripeOnboarded;
        token.displayName = dbUser.displayName;
        token.username = dbUser.username;
        token.avatarKey = dbUser.avatarKey ?? null;
        token.emailVerified = dbUser.emailVerified?.toISOString() ?? null;
        token.idVerified = dbUser.idVerified;
        token.mfaPending = dbUser.isMfaEnabled;
      }
    }

    if (token.mfaPending && token.sub) {
      const verified = token.jti
        ? await isMfaVerified(token.jti as string)
        : false;
      if (verified) {
        token.mfaPending = false;
      }
    }

    // Sliding refresh: if the token was issued more than JWT_REFRESH_THRESHOLD
    // seconds ago, rotate the jti so the old one is no longer valid. This keeps
    // active sessions alive without extending the absolute maxAge.
    const issuedAt = typeof token.iat === "number" ? token.iat : 0;
    const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
    if (issuedAt > 0 && ageSeconds > JWT_REFRESH_THRESHOLD) {
      const oldJti = token.jti as string | undefined;
      const newJti = crypto.randomUUID();
      token.jti = newJti;
      // Blocklist the old jti if it exists so it cannot be replayed.
      if (oldJti && typeof token.exp === "number") {
        await blockToken(oldJti, token.exp).catch(() => {
          // Non-critical — if blocklisting fails the old token expires naturally.
          logger.warn("jwt.refresh.blocklist_failed", { oldJti });
        });
      }
    }

    return token;
  },

  // Session callback: handles both JWT (credentials) and DB (OAuth) sessions.
  // JWT mode:  token is populated, user is undefined
  // DB mode:   user is the fresh DB row, token is undefined
  // null token: jwt() returned null (blocklisted) — Auth.js clears cookie before
  //             calling session(), so this guard is purely defensive.
  async session({ session, user, token }) {
    if (!token && !user) return session; // blocked token — return bare session
    if (session.user) {
      if (token?.id) {
        // Credentials login — JWT session (Auth.js v5 beta.30 always uses JWT
        // for credentials even when strategy:'database' is configured)
        session.user.id = token.id as string;
        session.user.isAdmin = (token.isAdmin as boolean) ?? false;
        session.user.isBanned = (token.isBanned as boolean) ?? false;
        session.user.isSellerEnabled =
          (token.isSellerEnabled as boolean) ?? false;
        session.user.isStripeOnboarded =
          (token.isStripeOnboarded as boolean) ?? false;
        session.user.displayName = (token.displayName as string) ?? "";
        session.user.username = (token.username as string) ?? "";
        session.user.avatarKey = (token.avatarKey as string | null) ?? null;
        session.user.emailVerified = token.emailVerified
          ? new Date(token.emailVerified as string)
          : null;
        session.user.idVerified = (token.idVerified as boolean) ?? false;
        session.user.mfaPending = (token.mfaPending as boolean) ?? false;
      } else if (user) {
        // OAuth login — DB session, user is the fresh DB row
        const dbUser = user as typeof user & {
          isAdmin: boolean;
          isBanned: boolean;
          isSellerEnabled: boolean;
          isStripeOnboarded: boolean;
          displayName: string;
          username: string;
          avatarKey?: string | null;
          idVerified: boolean;
        };

        session.user.id = dbUser.id;
        session.user.isAdmin = dbUser.isAdmin;
        session.user.isBanned = dbUser.isBanned;
        session.user.isSellerEnabled = dbUser.isSellerEnabled;
        session.user.isStripeOnboarded = dbUser.isStripeOnboarded;
        session.user.displayName = dbUser.displayName;
        session.user.username = dbUser.username;
        session.user.avatarKey = dbUser.avatarKey ?? null;
        session.user.emailVerified = dbUser.emailVerified ?? null;
        session.user.idVerified = dbUser.idVerified;
        session.user.mfaPending = false; // OAuth users don't have MFA
      }
    }
    return session;
  },

  async signIn({ user, account }) {
    // Block banned users at the OAuth level too
    if (account?.provider !== "credentials") {
      const dbUser = await db.user.findUnique({
        where: { email: user.email! },
        select: { isBanned: true },
      });
      if (dbUser?.isBanned) return false;
    }
    return true;
  },
};

export const events: NonNullable<NextAuthConfig["events"]> = {
  // Audit logout, bump session version (invalidates ALL sessions for the
  // user across every device/tab), and blocklist this specific JWT.
  // JWT strategy:      receives { token }
  // Database strategy: receives { session }
  async signOut(params) {
    const userId =
      "token" in params && params.token
        ? ((params.token as { sub?: string }).sub ?? null)
        : "session" in params && params.session
          ? ((params.session as { userId?: string }).userId ?? null)
          : null;
    if (userId) {
      audit({ userId, action: "USER_LOGOUT" });
      // Increment session version — every existing JWT for this user
      // (including bfcache-restored ones) becomes invalid on the next
      // jwt() callback check.
      await invalidateAllSessions(userId);
    }

    // Also blocklist this specific token as defence-in-depth
    if ("token" in params && params.token) {
      const t = params.token as { jti?: string; exp?: number };
      if (t.jti && t.exp) {
        await blockToken(t.jti, t.exp);
      }
    }
  },
};
