// src/modules/auth/mfa.service.ts
// ─── TOTP-based MFA Service ──────────────────────────────────────────────────

import { TOTP, Secret } from "otpauth";
import crypto from "crypto";
import { userRepository } from "@/modules/users/user.repository";
import { encrypt, decrypt } from "@/lib/encryption";

// Changing MFA_ISSUER requires TOTP re-enrollment for all existing users —
// the issuer is embedded in the otpauth:// URI stored in each user's authenticator app.
const MFA_ISSUER = "Buyzi";
const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;

function createTotpInstance(secret: string, accountName: string): TOTP {
  return new TOTP({
    issuer: MFA_ISSUER,
    label: accountName,
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: Secret.fromBase32(secret),
  });
}

function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    codes.push(
      crypto
        .randomBytes(BACKUP_CODE_LENGTH)
        .toString("hex")
        .slice(0, BACKUP_CODE_LENGTH)
        .toUpperCase(),
    );
  }
  return codes;
}

/**
 * Generate a new TOTP secret and backup codes for a user.
 * Does NOT enable MFA — call verifyMfaSetup() with a valid code to activate.
 */
export async function setupMfa(
  userId: string,
  email: string,
): Promise<{
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}> {
  const secret = new Secret({ size: 20 });
  const base32Secret = secret.base32;
  const backupCodes = generateBackupCodes();

  const totp = createTotpInstance(base32Secret, email);
  const qrCodeUrl = totp.toString(); // otpauth:// URL

  // Encrypt and store (not yet enabled)
  await userRepository.storeMfaSetup(userId, {
    mfaSecret: encrypt(base32Secret),
    mfaBackupCodes: encrypt(JSON.stringify(backupCodes)),
  });

  return { secret: base32Secret, qrCodeUrl, backupCodes };
}

/**
 * Verify a TOTP code during MFA setup. If valid, enables MFA.
 */
export async function verifyMfaSetup(
  userId: string,
  code: string,
): Promise<{ verified: boolean }> {
  const user = await userRepository.findForMfaVerify(userId);

  if (!user?.mfaSecret) {
    return { verified: false };
  }

  const secret = decrypt(user.mfaSecret);
  const totp = createTotpInstance(secret, user.email);

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    return { verified: false };
  }

  await userRepository.enableMfa(userId);

  return { verified: true };
}

/**
 * Verify a TOTP code or backup code during login.
 */
export async function verifyMfaLogin(
  userId: string,
  code: string,
): Promise<{ verified: boolean; backupCodeUsed: boolean }> {
  const user = await userRepository.findForMfaLogin(userId);

  if (!user?.mfaSecret) {
    return { verified: false, backupCodeUsed: false };
  }

  const secret = decrypt(user.mfaSecret);
  const totp = createTotpInstance(secret, user.email);

  // Try TOTP first
  const delta = totp.validate({ token: code, window: 1 });
  if (delta !== null) {
    return { verified: true, backupCodeUsed: false };
  }

  // Try backup codes
  if (user.mfaBackupCodes) {
    const backupCodes: string[] = JSON.parse(decrypt(user.mfaBackupCodes));
    const upperCode = code.toUpperCase();
    const index = backupCodes.indexOf(upperCode);
    if (index !== -1) {
      // Remove used backup code
      backupCodes.splice(index, 1);
      await userRepository.updateMfaBackupCodes(
        userId,
        encrypt(JSON.stringify(backupCodes)),
      );
      return { verified: true, backupCodeUsed: true };
    }
  }

  return { verified: false, backupCodeUsed: false };
}

/**
 * Disable MFA after verifying current TOTP code.
 */
export async function disableMfa(
  userId: string,
  code: string,
): Promise<{ success: boolean }> {
  const user = await userRepository.findForMfaVerify(userId);

  if (!user?.mfaSecret) {
    return { success: false };
  }

  const secret = decrypt(user.mfaSecret);
  const totp = createTotpInstance(secret, user.email);

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    return { success: false };
  }

  await userRepository.clearMfa(userId);

  return { success: true };
}

/**
 * Check if a user has MFA enabled.
 */
export async function hasMfaEnabled(userId: string): Promise<boolean> {
  return userRepository.findIsMfaEnabled(userId);
}

/**
 * Get the count of remaining backup codes.
 */
export async function getBackupCodeCount(userId: string): Promise<number> {
  const user = await userRepository.findMfaBackupCodes(userId);
  if (!user?.mfaBackupCodes) return 0;
  const codes: string[] = JSON.parse(decrypt(user.mfaBackupCodes));
  return codes.length;
}
