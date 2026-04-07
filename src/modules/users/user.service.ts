// src/modules/users/user.service.ts
// ─── User Service ────────────────────────────────────────────────────────────
// Profile, password, and verification operations. Framework-free.

import { userRepository } from "./user.repository";
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
    await userRepository.update(userId, {
      displayName: input.displayName,
      region: input.region || null,
      bio: input.bio || null,
    });
    logger.info("user.profile.updated", { userId });
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    ip: string,
  ): Promise<void> {
    const user = await userRepository.findPasswordHash(userId);

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

    await userRepository.transaction(async (tx) => {
      await userRepository.update(userId, { passwordHash: newHash }, tx);
      await userRepository.deleteAllSessions(userId, tx);
    });

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

    await userRepository.deletePhoneTokens(userId);

    await userRepository.createPhoneToken({
      userId,
      codeHash,
      phone: phoneClean,
      expiresAt,
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

    await userRepository.update(userId, {
      phone: encryptPhone(phoneClean),
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

    const token = await userRepository.findActivePhoneToken(userId);

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

    await userRepository.incrementPhoneTokenAttempts(token.id);

    const inputHash = crypto.createHash("sha256").update(code).digest("hex");
    if (inputHash !== token.codeHash) {
      throw AppError.validation("Invalid verification code. Please try again.");
    }

    await userRepository.transaction(async (tx) => {
      await userRepository.markPhoneTokenUsed(token.id, tx);
      await userRepository.update(
        userId,
        {
          isPhoneVerified: true,
          phoneVerifiedAt: new Date(),
          phone: encryptPhone(token.phone),
        },
        tx,
      );
    });

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
    const user = await userRepository.findPhone(userId);
    if (!user?.phone) return null;
    return decryptPhone(user.phone);
  }
}

export const userService = new UserService();
