// src/modules/users/auth.service.ts
// ─── Auth Service ────────────────────────────────────────────────────────────
// Registration and password reset flows. Framework-free.

import { userRepository } from "./user.repository";
import { hashPassword } from "@/server/lib/password";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import { verifyTurnstile } from "@/server/lib/turnstile";
import { passwordSchema } from "@/server/validators";
import { enqueueEmail } from "@/lib/email-queue";
import { MS_PER_HOUR } from "@/lib/time";
import crypto from "crypto";
import type { RegisterInput, ResetPasswordInput } from "./user.types";

function generateUsername(firstName: string, lastName: string): string {
  const base = `${firstName}${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);
  return base || "user";
}

export class AuthService {
  async register(
    input: RegisterInput,
    ip: string,
    userAgent?: string,
  ): Promise<{ userId: string }> {
    // Verify Turnstile in production — fail CLOSED if token is absent
    if (process.env.NODE_ENV === "production") {
      if (!input.turnstileToken) {
        throw AppError.validation(
          "Bot verification required. Please complete the security check.",
        );
      }
      const isHuman = await verifyTurnstile(input.turnstileToken);
      if (!isHuman) {
        throw AppError.validation("Bot verification failed. Please try again.");
      }
    }

    // Check email uniqueness
    const existingEmail = await userRepository.existsByEmail(input.email);
    if (existingEmail) {
      throw AppError.validation("An account with this email already exists.");
    }

    // Generate username
    const username = generateUsername(input.firstName, input.lastName);
    const existingUsername = await userRepository.existsByUsername(username);
    const finalUsername = existingUsername
      ? `${username}${Math.floor(Math.random() * 9000) + 1000}`
      : username;

    // Hash password
    const passwordHash = await hashPassword(input.password);

    // Create user
    const user = await userRepository.create({
      email: input.email,
      username: finalUsername,
      displayName: `${input.firstName} ${input.lastName}`,
      passwordHash,
      hasMarketingConsent: input.hasMarketingConsent,
      agreedTermsAt: new Date(),
    });

    // Email queued — delivered asynchronously (non-blocking)
    await enqueueEmail({
      template: "welcome",
      to: user.email,
      displayName: user.displayName,
    }).catch((err) => {
      logger.warn("user.register.email_queue.failed", {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    audit({
      userId: user.id,
      action: "USER_REGISTER",
      metadata: { email: user.email, username: finalUsername },
      ip,
      userAgent,
    });

    logger.info("user.registered", {
      userId: user.id,
      username: finalUsername,
    });

    return { userId: user.id };
  }

  async requestPasswordReset(
    email: string,
    ip: string,
    userAgent: string | null,
  ): Promise<void> {
    const user = await userRepository.findByEmail(email);

    // Always succeed to prevent user enumeration
    if (!user) return;

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    const expiresAt = new Date(Date.now() + MS_PER_HOUR);

    await userRepository.invalidatePendingResetTokens(user.id);

    await userRepository.createResetToken({
      userId: user.id,
      tokenHash,
      expiresAt,
      requestIp: ip,
      userAgent,
    });

    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${rawToken}`;
    // Email queued — delivered asynchronously (non-blocking)
    await enqueueEmail({
      template: "passwordReset",
      to: user.email,
      displayName: user.displayName,
      resetUrl,
      expiresInMinutes: 60,
    }).catch((err) => {
      logger.warn("user.password_reset.email_queue.failed", {
        userId: user.id,
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

  async resetPassword(input: ResetPasswordInput, ip: string): Promise<void> {
    const tokenHash = crypto
      .createHash("sha256")
      .update(input.token)
      .digest("hex");

    const resetRecord = await userRepository.findResetTokenWithUser(tokenHash);

    const GENERIC_ERROR =
      "Invalid or expired reset link. Please request a new one.";
    if (!resetRecord) throw AppError.validation(GENERIC_ERROR);
    if (resetRecord.usedAt) throw AppError.validation(GENERIC_ERROR);
    if (resetRecord.expiresAt < new Date())
      throw AppError.validation(GENERIC_ERROR);

    // Enforce the same password strength rules as changePassword:
    // min 12 chars, uppercase, lowercase, number.
    const pwdCheck = passwordSchema.safeParse(input.password);
    if (!pwdCheck.success) {
      throw AppError.validation(
        pwdCheck.error.issues[0]?.message ??
          "Password does not meet strength requirements.",
      );
    }

    const newHash = await hashPassword(input.password);
    await userRepository.transaction(async (tx) => {
      await tx.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash: newHash },
      });
      await tx.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() },
      });
      await tx.session.deleteMany({ where: { userId: resetRecord.userId } });
    });

    audit({
      userId: resetRecord.userId,
      action: "USER_PASSWORD_CHANGED",
      metadata: { step: "reset_completed" },
      ip,
    });

    logger.info("user.password.reset", { userId: resetRecord.userId });
  }
}

export const authService = new AuthService();
