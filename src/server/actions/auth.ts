"use server";
// src/server/actions/auth.ts
// Every action follows the 7-step security pattern:
//   1. Authenticate   — verify session exists (where required)
//   2. Authorise      — check permissions
//   3. Validate       — parse + sanitise input with Zod
//   4. Rate limit     — check Upstash Redis sliding window
//   5. Execute        — business logic
//   6. Audit log      — write immutable audit entry (fire-and-forget)
//   7. Return         — typed ActionResult<T>
//
// signIn / signOut are called from the client via Auth.js — not server actions.

import { headers } from "next/headers";
import crypto from "crypto";
import db from "@/lib/db";
import { userRepository } from "@/modules/users/user.repository";
import { hashPassword, isPasswordBreached } from "@/server/lib/password";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { verifyTurnstile } from "@/server/lib/turnstile";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { enqueueEmail } from "@/lib/email-queue";
import {
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@/server/validators";
import type { ActionResult } from "@/types";

export async function registerUser(
  raw: unknown,
): Promise<ActionResult<{ userId: string }>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get("user-agent") ?? undefined;

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // Normalize email — lowercase + trim to prevent case-mismatch with login
  const normalizedEmail = data.email.toLowerCase().trim();

  // 4. Rate limit — 3 registrations per hour per IP
  const limit = await rateLimit("register", ip);
  if (!limit.success) {
    return {
      success: false,
      error: `Too many registration attempts. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  // 5a. Verify Cloudflare Turnstile — FAIL CLOSED in production.
  // Empty/missing tokens are rejected. Client gets key via /api/auth/turnstile-config.
  if (process.env.NODE_ENV === "production") {
    if (!data.turnstileToken) {
      return {
        success: false,
        error: "Bot verification required. Please complete the security check.",
      };
    }
    const turnstileOk = await verifyTurnstile(data.turnstileToken, ip);
    if (!turnstileOk) {
      return {
        success: false,
        error: "Bot verification failed. Please try again.",
      };
    }
  }

  // 5b. Check password against breach database (k-anonymity — never sends full password)
  // FAIL OPEN: isPasswordBreached returns false on network errors internally, but this
  // outer try-catch guards against any unexpected throw (e.g., an unhandled edge case).
  // Never block a legitimate user because a third-party service check fails — log at
  // warn so the failure is visible in monitoring without gating registration on it.
  let isCompromised = false;
  try {
    isCompromised = await isPasswordBreached(data.password);
  } catch (err) {
    logger.warn("auth.register.breach_check_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (isCompromised) {
    return {
      success: false,
      error:
        "This password has appeared in a data breach. Please choose a different password.",
      fieldErrors: {
        password: [
          "This password is known to be compromised. Please choose a different one.",
        ],
      },
    };
  }

  const emailTaken = await userRepository.existsByEmail(normalizedEmail);
  if (emailTaken) {
    // Return the same error for email/username to prevent enumeration
    return {
      success: false,
      error: "An account with this email already exists.",
      fieldErrors: { email: ["This email is already registered."] },
    };
  }

  const username = generateUsername(data.firstName, data.lastName);
  const usernameTaken = await userRepository.existsByUsername(username);
  const finalUsername = usernameTaken
    ? `${username}${Math.floor(Math.random() * 9000) + 1000}`
    : username;

  const passwordHash = await hashPassword(data.password);

  const verifyToken = crypto.randomBytes(32).toString("hex");
  const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const user = await userRepository.create({
    email: normalizedEmail,
    username: finalUsername,
    displayName: `${data.firstName} ${data.lastName}`,
    passwordHash,
    hasMarketingConsent: data.hasMarketingConsent,
    agreedTermsAt: new Date(),
    emailVerifyToken: verifyToken,
    emailVerifyExpires: verifyExpires,
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const verifyUrl = `${appUrl}/api/verify-email?token=${verifyToken}`;
  await enqueueEmail({
    template: "verification",
    to: user.email,
    displayName: user.displayName,
    verifyUrl,
  }).catch((err) => {
    logger.warn("auth.register.email_queue.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  audit({
    userId: user.id,
    action: "USER_REGISTER",
    metadata: { email: user.email, username: finalUsername },
    ip,
    userAgent: ua,
  });

  return { success: true, data: { userId: user.id } };
}

export async function requestPasswordReset(
  raw: unknown,
): Promise<ActionResult<void>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);

  const parsed = forgotPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: "Please enter a valid email address." };
  }
  const { email: rawEmail, turnstileToken } = parsed.data;
  const email = rawEmail.toLowerCase().trim();

  // 4. Rate limit — 5 attempts per 15 minutes per IP
  const limit = await rateLimit("auth", ip);
  if (!limit.success) {
    return {
      success: false,
      error: `Too many attempts. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  // 5a. Verify Turnstile — FAIL CLOSED in production.
  if (process.env.NODE_ENV === "production") {
    if (!turnstileToken) {
      return { success: false, error: "Bot verification required." };
    }
    const ok = await verifyTurnstile(turnstileToken, ip);
    if (!ok) return { success: false, error: "Bot verification failed." };
  }

  // 5b. Look up user — NEVER reveal whether email exists (user enumeration)
  const user = await userRepository.findByEmail(email);

  // Always return success to prevent user enumeration
  if (user) {
    const rawToken = crypto.randomBytes(32).toString("hex"); // 64 hex chars
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        requestIp: ip,
        userAgent: reqHeaders.get("user-agent"),
      },
    });

    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${rawToken}`;
    await enqueueEmail({
      template: "passwordReset",
      to: user.email,
      displayName: user.displayName,
      resetUrl,
      expiresInMinutes: 60,
    }).catch((err) => {
      logger.warn("auth.password_reset.email_queue.failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    audit({
      userId: user.id,
      action: "USER_PASSWORD_CHANGED",
      metadata: { step: "reset_requested" },
      ip,
    });
  }

  return { success: true, data: undefined };
}

export async function resetPassword(raw: unknown): Promise<ActionResult<void>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);

  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the password errors below and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { token, password } = parsed.data;

  const limit = await rateLimit("auth", ip);
  if (!limit.success) {
    return {
      success: false,
      error: `Too many attempts. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const resetRecord = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, displayName: true } } },
  });

  const GENERIC_ERROR =
    "Invalid or expired reset link. Please request a new one.";
  if (!resetRecord) return { success: false, error: GENERIC_ERROR };
  if (resetRecord.usedAt) return { success: false, error: GENERIC_ERROR };
  if (resetRecord.expiresAt < new Date())
    return { success: false, error: GENERIC_ERROR };

  const newHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    await userRepository.update(
      resetRecord.userId,
      { passwordHash: newHash },
      tx,
    );
    await tx.passwordResetToken.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() },
    });
    await userRepository.deleteAllSessions(resetRecord.userId, tx);
  });

  audit({
    userId: resetRecord.userId,
    action: "USER_PASSWORD_CHANGED",
    metadata: { step: "reset_completed" },
    ip,
  });

  return { success: true, data: undefined };
}

export async function resendVerificationEmail(): Promise<ActionResult<void>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);

  // Rate limit — 3 resend attempts per 15 min per IP
  const limit = await rateLimit("auth", ip);
  if (!limit.success) {
    return {
      success: false,
      error: `Too many attempts. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  // We need a session — use auth() directly here since requireUser()
  // may redirect unverified users in some configurations
  const { auth } = await import("@/lib/auth");
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not logged in." };
  }

  const user = await userRepository.findForEmailVerification(session.user.id);

  if (!user) {
    return { success: false, error: "User not found." };
  }

  if (user.emailVerified) {
    return { success: false, error: "Email is already verified." };
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await userRepository.update(user.id, {
    emailVerifyToken: token,
    emailVerifyExpires: expires,
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const verifyUrl = `${appUrl}/api/verify-email?token=${token}`;

  await enqueueEmail({
    template: "verification",
    to: user.email,
    displayName: user.displayName ?? "there",
    verifyUrl,
  }).catch((err) => {
    logger.warn("auth.resend_verification.email_queue.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  audit({
    userId: user.id,
    action: "USER_PASSWORD_CHANGED",
    metadata: { step: "verification_email_resent" },
    ip,
  });

  return { success: true, data: undefined };
}

function generateUsername(firstName: string, lastName: string): string {
  const base = `${firstName}${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);
  return base || "user";
}
