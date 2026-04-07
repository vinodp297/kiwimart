"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/account.ts
// ─── Account Security Server Actions ─────────────────────────────────────────
// Password change, account deletion, session management.
//
// Security:
//   • changePassword requires current password verification
//   • changePassword invalidates all other sessions (JWT rotation)
//   • All actions audit-logged with IP

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/lib/requireUser";
import { getClientIp } from "@/server/lib/rateLimit";
import { audit } from "@/server/lib/audit";
import { userRepository } from "@/modules/users/user.repository";
import { logger } from "@/shared/logger";
import { hashPassword, verifyPassword } from "@/server/lib/password";
import type { ActionResult } from "@/types";
import {
  changePasswordSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type UpdateProfileActionInput,
} from "@/server/validators";

export type { ChangePasswordInput };

// ── changePassword ──────────────────────────────────────────────────────────

export async function changePassword(
  input: ChangePasswordInput,
): Promise<ActionResult<void>> {
  try {
    const reqHeaders = await headers();
    // Use getClientIp() — x-forwarded-for is client-controllable and spoofable.
    // Trusted platform headers (x-real-ip, cf-connecting-ip) are used instead.
    const ip = getClientIp(reqHeaders as unknown as Headers);

    const authedUser = await requireUser();

    const parsed = changePasswordSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: "Please fix the password errors below.",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }

    const { currentPassword, newPassword } = parsed.data;

    const user = await userRepository.findPasswordHash(authedUser.id);

    if (!user?.passwordHash) {
      return {
        success: false,
        error: "Password change is not available for social login accounts.",
      };
    }

    const valid = await verifyPassword(user.passwordHash, currentPassword);
    if (!valid) {
      audit({
        userId: authedUser.id,
        action: "PASSWORD_CHANGED",
        metadata: { success: false, reason: "invalid_current_password" },
        ip,
      });
      return { success: false, error: "Current password is incorrect." };
    }

    const newHash = await hashPassword(newPassword);

    await userRepository.transaction(async (tx) => {
      await userRepository.update(authedUser.id, { passwordHash: newHash }, tx);
      await userRepository.deleteAllSessions(authedUser.id, tx);
    });

    audit({
      userId: authedUser.id,
      action: "PASSWORD_CHANGED",
      entityType: "User",
      entityId: authedUser.id,
      metadata: { success: true },
      ip,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't update your password. Please try again.",
      ),
    };
  }
}

// ── updateProfile ────────────────────────────────────────────────────────────

export type UpdateProfileInput = UpdateProfileActionInput;

export async function updateProfile(
  input: UpdateProfileInput,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    const parsed = updateProfileSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your profile details and try again.",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }

    const { displayName, region, bio } = parsed.data;

    await userRepository.update(user.id, {
      displayName,
      region: region || null,
      bio: bio || null,
    });

    revalidatePath("/account/settings");
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't update your profile. Please try again.",
      ),
    };
  }
}

// ── deleteAccount — NZ Privacy Act 2020 compliance ──────────────────────────
// Performs a full account erasure: anonymises PII, revokes all sessions,
// and creates an immutable ErasureLog record.

export async function deleteAccount(): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    const { performAccountErasure } =
      await import("@/modules/users/erasure.service");

    await performAccountErasure({
      userId: user.id,
      operatorId: "self-service",
    });

    audit({
      userId: user.id,
      action: "ADMIN_ACTION",
      entityType: "User",
      entityId: user.id,
      metadata: { type: "account_deleted", anonymised: true },
    });

    return { success: true, data: undefined };
  } catch (err) {
    logger.error("account.delete.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: `Failed to delete account. Please contact ${process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@buyzi.co.nz"}`,
    };
  }
}
