// src/modules/users/user.service.ts
// ─── User Service ────────────────────────────────────────────────────────────
// Profile, password, and verification operations. Framework-free.

import db from "@/lib/db";
import { audit } from "@/server/lib/audit";
import { hashPassword, verifyPassword } from "@/server/lib/password";
import { encrypt, decrypt, isEncryptionConfigured } from "@/lib/encryption";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import crypto from "crypto";
import type { UpdateProfileInput, ChangePasswordInput } from "./user.types";

/** Encrypt a phone number if ENCRYPTION_KEY is set, otherwise store plaintext. */
function encryptPhone(phone: string): string {
  return isEncryptionConfigured() ? encrypt(phone) : phone;
}

/** Decrypt a phone number. If it doesn't look like base64 ciphertext, return as-is. */
function decryptPhone(stored: string): string {
  if (!isEncryptionConfigured()) return stored;
  try {
    return decrypt(stored);
  } catch {
    // Likely stored before encryption was enabled — return raw value
    return stored;
  }
}

export class UserService {
  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<void> {
    await db.user.update({
      where: { id: userId },
      data: {
        displayName: input.displayName,
        region: input.region || null,
        bio: input.bio || null,
      },
    });
    logger.info("user.profile.updated", { userId });
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    ip: string,
  ): Promise<void> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user?.passwordHash) {
      throw AppError.validation(
        "Password change is not available for social login accounts.",
      );
    }

    const valid = await verifyPassword(
      user.passwordHash,
      input.currentPassword,
    );
    if (!valid) {
      audit({
        userId,
        action: "PASSWORD_CHANGED",
        metadata: { success: false, reason: "invalid_current_password" },
        ip,
      });
      throw AppError.validation("Current password is incorrect.");
    }

    const newHash = await hashPassword(input.newPassword);

    await db.$transaction([
      db.user.update({
        where: { id: userId },
        data: { passwordHash: newHash },
      }),
      db.session.deleteMany({ where: { userId } }),
    ]);

    audit({
      userId,
      action: "PASSWORD_CHANGED",
      entityType: "User",
      entityId: userId,
      metadata: { success: true },
      ip,
    });

    logger.info("user.password.changed", { userId });
  }

  async requestPhoneVerification(
    userId: string,
    phone: string,
    ip: string,
  ): Promise<{ expiresAt: string }> {
    const phoneClean = phone.replace(/[\s\-()]/g, "");
    const { isValidNzPhone } =
      await import("@/server/services/sms/sms.service");
    if (!isValidNzPhone(phoneClean)) {
      throw AppError.validation(
        "Please enter a valid New Zealand phone number.",
      );
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.phoneVerificationToken.deleteMany({ where: { userId } });

    await db.phoneVerificationToken.create({
      data: { userId, codeHash, phone: phoneClean, expiresAt },
    });

    const { sendSms, formatNzPhoneE164 } =
      await import("@/server/services/sms/sms.service");
    const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi";
    await sendSms({
      to: formatNzPhoneE164(phoneClean),
      body:
        `Your ${appName} verification code is: ${code}. ` +
        `Valid for 10 minutes. Do not share this code.`,
    });

    await db.user.update({
      where: { id: userId },
      data: { phone: encryptPhone(phoneClean) },
    });

    audit({
      userId,
      action: "PHONE_VERIFIED",
      metadata: { step: "code_requested", phone: phoneClean.slice(-4) },
      ip,
    });

    return { expiresAt: expiresAt.toISOString() };
  }

  async verifyPhoneCode(
    userId: string,
    code: string,
    ip: string,
  ): Promise<void> {
    if (!/^\d{6}$/.test(code)) {
      throw AppError.validation("Please enter a 6-digit code.");
    }

    const token = await db.phoneVerificationToken.findFirst({
      where: {
        userId,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!token) {
      throw AppError.validation(
        "Verification code expired. Please request a new one.",
      );
    }

    if (token.attempts >= 3) {
      throw AppError.validation(
        "Too many attempts. Please request a new code.",
      );
    }

    await db.phoneVerificationToken.update({
      where: { id: token.id },
      data: { attempts: { increment: 1 } },
    });

    const inputHash = crypto.createHash("sha256").update(code).digest("hex");
    if (inputHash !== token.codeHash) {
      throw AppError.validation("Invalid verification code. Please try again.");
    }

    await db.$transaction([
      db.phoneVerificationToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
      db.user.update({
        where: { id: userId },
        data: {
          phoneVerified: true,
          phoneVerifiedAt: new Date(),
          phone: encryptPhone(token.phone),
        },
      }),
    ]);

    audit({
      userId,
      action: "PHONE_VERIFIED",
      entityType: "User",
      entityId: userId,
      metadata: { step: "verified", phone: token.phone.slice(-4) },
      ip,
    });

    logger.info("user.phone.verified", { userId });
  }

  /** Retrieve and decrypt a user's phone number. */
  async getDecryptedPhone(userId: string): Promise<string | null> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (!user?.phone) return null;
    return decryptPhone(user.phone);
  }
}

export const userService = new UserService();
