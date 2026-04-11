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

/** Returns true when a Prisma error is a unique-constraint violation on username. */
function isUsernameP2002(err: unknown): boolean {
  if (!(err instanceof Error) || !("code" in err)) return false;
  if ((err as { code: string }).code !== "P2002") return false;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  return String(target ?? "").includes("username");
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

    // Hash password (computed once; reused across retry attempts below)
    const passwordHash = await hashPassword(input.password);

    // Generate username — retry on P2002 collision instead of pre-checking with
    // existsByUsername (which has a TOCTOU race between the check and the insert).
    const baseUsername = generateUsername(input.firstName, input.lastName);
    let user!: Awaited<ReturnType<typeof userRepository.create>>;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate =
        attempt === 0
          ? baseUsername
          : `${baseUsername}${crypto.randomUUID().slice(0, 8)}`;
      try {
        user = await userRepository.create({
          email: input.email,
          username: candidate,
          displayName: `${input.firstName} ${input.lastName}`,
          passwordHash,
          hasMarketingConsent: input.hasMarketingConsent,
          agreedTermsAt: new Date(),
        });
        break;
      } catch (err) {
        if (isUsernameP2002(err) && attempt < 4) continue;
        throw err;
      }
    }

    await enqueueEmail({
      template: "welcome",
      to: user.email,
      displayName: user.displayName,
    });

    audit({
      userId: user.id,
      action: "USER_REGISTER",
      metadata: { email: user.email, username: user.username },
      ip,
      userAgent,
    });

    logger.info("user.registered", {
      userId: user.id,
      username: user.username,
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
    await enqueueEmail({
      template: "passwordReset",
      to: user.email,
      displayName: user.displayName,
      resetUrl,
      expiresInMinutes: 60,
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
