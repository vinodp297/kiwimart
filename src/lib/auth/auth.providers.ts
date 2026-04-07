// src/lib/auth/auth.providers.ts
// Credentials (email + Argon2id) and Google OAuth providers for NextAuth.

import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import db from "@/lib/db";
import {
  verifyPassword,
  needsRehash,
  hashPassword,
} from "@/server/lib/password";
import { audit } from "@/server/lib/audit";
import { loginSchema } from "@/server/validators";
import { verifyTurnstile } from "@/server/lib/turnstile";
import { logger } from "@/shared/logger";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";

export const credentialsProvider = Credentials({
  credentials: {
    email: { type: "email" },
    password: { type: "password" },
    turnstileToken: { type: "text" }, // Cloudflare Turnstile
  },

  async authorize(credentials, request) {
    const ip = getClientIp(request.headers);
    const limitResult = await rateLimit("auth", ip || "unknown");
    if (!limitResult.success) {
      throw new Error(
        `Too many login attempts. Please try again in ${limitResult.retryAfter} seconds.`,
      );
    }

    const parsed = loginSchema.safeParse(credentials);
    if (!parsed.success) {
      logger.warn("authorize:fail", {
        reason: "zod_parse_failed",
        issues: parsed.error.issues.map((i) => i.message),
      });
      return null;
    }

    const { email, password, turnstileToken } = parsed.data;

    // Verify Cloudflare Turnstile token (bot protection) — FAIL CLOSED.
    // Always verify in production. Empty/missing tokens are rejected by
    // verifyTurnstile() which sends them to Cloudflare (which rejects them).
    // The client MUST provide a valid token — see /api/auth/turnstile-config.
    if (process.env.NODE_ENV === "production") {
      const turnstileOk = await verifyTurnstile(turnstileToken ?? "");
      if (!turnstileOk) {
        logger.warn("authorize:fail", {
          reason: "turnstile",
          tokenPresent: !!turnstileToken,
        });
        return null;
      }
    }

    // Look up user — timing-safe: always hash even if user doesn't exist
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
        isSellerEnabled: true,
        isAdmin: true,
      },
    });

    // Dummy hash compare if user not found (prevent user enumeration via timing)
    const DUMMY_HASH =
      "$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG";
    const hashToVerify = user?.passwordHash ?? DUMMY_HASH;
    const passwordValid = await verifyPassword(hashToVerify, password);

    if (!user || !passwordValid) {
      logger.warn("authorize:fail", {
        reason: "invalid_credentials",
        userFound: !!user,
        passwordValid,
      });
      // Audit failed attempt (without the password)
      audit({
        userId: user?.id ?? null,
        action: "USER_LOGIN",
        metadata: { success: false, reason: "invalid_credentials", email },
      });
      return null;
    }

    if (user.isBanned) {
      logger.warn("authorize:fail", { reason: "banned", userId: user.id });
      audit({
        userId: user.id,
        action: "USER_LOGIN",
        metadata: { success: false, reason: "banned" },
      });
      return null;
    }

    // Transparent rehash if cost params changed
    if (user.passwordHash && needsRehash(user.passwordHash)) {
      const newHash = await hashPassword(password);
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      });
    }

    audit({
      userId: user.id,
      action: "USER_LOGIN",
      metadata: { success: true },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.displayName,
    };
  },
});

export const googleProvider = Google({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  allowDangerousEmailAccountLinking: false,
});
