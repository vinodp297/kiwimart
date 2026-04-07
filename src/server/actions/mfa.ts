"use server";
// src/server/actions/mfa.ts
// ─── MFA Server Actions ─────────────────────────────────────────────────────

import { headers } from "next/headers";
import { userRepository } from "@/modules/users/user.repository";
import { requireUser } from "@/server/lib/requireUser";
import { audit } from "@/server/lib/audit";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import {
  setupMfa,
  verifyMfaSetup,
  disableMfa,
  getBackupCodeCount,
} from "@/modules/auth/mfa.service";
import { verifyMfaCodeSchema } from "@/server/validators";
import { safeActionError } from "@/shared/errors";
import type { ActionResult } from "@/types";

// ── Setup MFA ───────────────────────────────────────────────────────────────

export async function initMfaSetup(): Promise<
  ActionResult<{ secret: string; qrCodeUrl: string; backupCodes: string[] }>
> {
  try {
    const user = await requireUser();

    const _ip = getClientIp(await headers());
    const limit = await rateLimit("auth", `mfa-setup:${user.id}`);
    if (!limit.success) {
      return {
        success: false,
        error: "Too many requests. Please try again in a few minutes.",
      };
    }

    // Check not already enabled
    const dbUser = await userRepository.findMfaInfo(user.id);
    if (!dbUser) return { success: false, error: "User not found." };
    if (dbUser.isMfaEnabled) {
      return { success: false, error: "MFA is already enabled." };
    }

    const result = await setupMfa(user.id, dbUser.email);
    return { success: true, data: result };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Failed to set up MFA."),
    };
  }
}

// ── Confirm MFA Setup ───────────────────────────────────────────────────────

export async function confirmMfaSetup(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    const parsed = verifyMfaCodeSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid code.",
      };
    }

    const ip = getClientIp(await headers());
    const limit = await rateLimit("auth", `mfa-verify:${user.id}`);
    if (!limit.success) {
      return {
        success: false,
        error: "Too many attempts. Please try again in a few minutes.",
      };
    }

    const result = await verifyMfaSetup(user.id, parsed.data.code);
    if (!result.verified) {
      return { success: false, error: "Invalid code. Please try again." };
    }

    audit({
      userId: user.id,
      action: "MFA_ENABLED" as const,
      entityType: "User",
      entityId: user.id,
      ip,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Failed to confirm MFA setup."),
    };
  }
}

// ── Disable MFA ─────────────────────────────────────────────────────────────

export async function disableMfaAction(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    const parsed = verifyMfaCodeSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid code.",
      };
    }

    const ip = getClientIp(await headers());
    const limit = await rateLimit("auth", `mfa-disable:${user.id}`);
    if (!limit.success) {
      return {
        success: false,
        error: "Too many attempts. Please try again in a few minutes.",
      };
    }

    const result = await disableMfa(user.id, parsed.data.code);
    if (!result.success) {
      return {
        success: false,
        error: "Invalid code. MFA was not disabled.",
      };
    }

    audit({
      userId: user.id,
      action: "MFA_DISABLED" as const,
      entityType: "User",
      entityId: user.id,
      ip,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Failed to disable MFA."),
    };
  }
}

// ── Get MFA Status ──────────────────────────────────────────────────────────

export async function getMfaStatus(): Promise<
  ActionResult<{ enabled: boolean; backupCodesRemaining: number }>
> {
  try {
    const user = await requireUser();

    const dbUser = await userRepository.findMfaInfo(user.id);
    if (!dbUser) return { success: false, error: "User not found." };

    const backupCodesRemaining = dbUser.isMfaEnabled
      ? await getBackupCodeCount(user.id)
      : 0;

    return {
      success: true,
      data: { enabled: dbUser.isMfaEnabled, backupCodesRemaining },
    };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Failed to get MFA status."),
    };
  }
}
