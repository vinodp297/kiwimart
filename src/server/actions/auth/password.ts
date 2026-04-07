"use server";
// src/server/actions/auth/password.ts
// Password reset and email verification resend server actions.

import { headers } from "next/headers";
import crypto from "crypto";
import db from "@/lib/db";
import { userRepository } from "@/modules/users/user.repository";
import { hashPassword } from "@/server/lib/password";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { verifyTurnstile } from "@/server/lib/turnstile";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { enqueueEmail } from "@/lib/email-queue";
import { forgotPasswordSchema, resetPasswordSchema } from "@/server/validators";
import type { ActionResult } from "@/types";

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

  const limit = await rateLimit("auth", ip);
  if (!limit.success) {
    return {
      success: false,
      error: `Too many attempts. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  // Verify Turnstile — FAIL CLOSED in production.
  if (process.env.NODE_ENV === "production") {
    if (!turnstileToken) {
      return { success: false, error: "Bot verification required." };
    }
    const ok = await verifyTurnstile(turnstileToken, ip);
    if (!ok) return { success: false, error: "Bot verification failed." };
  }

  // Look up user — NEVER reveal whether email exists (user enumeration)
  const user = await userRepository.findByEmail(email);

  // Always return success to prevent user enumeration
  if (user) {
    const rawToken = crypto.randomBytes(32).toString("hex");
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

  const limit = await rateLimit("auth", ip);
  if (!limit.success) {
    return {
      success: false,
      error: `Too many attempts. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  // Use auth() directly here since requireUser() may redirect unverified
  // users in some configurations
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
