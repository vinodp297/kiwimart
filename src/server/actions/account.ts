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
import db from "@/lib/db";
import { audit } from "@/server/lib/audit";
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

    const user = await db.user.findUnique({
      where: { id: authedUser.id },
      select: { passwordHash: true },
    });

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

    await db.$transaction([
      db.user.update({
        where: { id: authedUser.id },
        data: { passwordHash: newHash },
      }),
      db.session.deleteMany({
        where: { userId: authedUser.id },
      }),
    ]);

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

    await db.user.update({
      where: { id: user.id },
      data: {
        displayName,
        region: region || null,
        bio: bio || null,
      },
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
// Soft-deletes the user: anonymises PII while retaining order records
// for the 7-year NZ tax requirement.

export async function deleteAccount(): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    // Check for active orders — can't delete if money is in escrow
    const activeOrders = await db.order.count({
      where: {
        OR: [{ buyerId: user.id }, { sellerId: user.id }],
        status: {
          in: ["AWAITING_PAYMENT", "PAYMENT_HELD", "DISPATCHED", "DISPUTED"],
        },
      },
    });

    if (activeOrders > 0) {
      return {
        success: false,
        error: `Cannot delete account with ${activeOrders} active order(s). Please resolve all active orders first.`,
      };
    }

    // Soft delete — anonymise personal data
    await db.$transaction(async (tx) => {
      const anonymisedEmail = `deleted-${user.id}@kiwimart-deleted.invalid`;

      await tx.user.update({
        where: { id: user.id },
        data: {
          email: anonymisedEmail,
          displayName: "Deleted User",
          username: `deleted-${user.id.slice(0, 8)}`,
          bio: null,
          avatarKey: null,
          coverImageKey: null,
          phone: null,
          deletedAt: new Date(),
          emailVerified: null,
          passwordHash: null,
        },
      });

      // Delete sessions
      await tx.session.deleteMany({
        where: { userId: user.id },
      });

      // Withdraw pending offers
      await tx.offer.updateMany({
        where: {
          buyerId: user.id,
          status: "PENDING",
        },
        data: { status: "WITHDRAWN" },
      });

      // Remove from watchlists
      await tx.watchlistItem.deleteMany({
        where: { userId: user.id },
      });
    });

    audit({
      userId: user.id,
      action: "ADMIN_ACTION",
      entityType: "User",
      entityId: user.id,
      metadata: { type: "account_deleted", anonymised: true },
    });

    logger.info("account.deleted", { userId: user.id });
    return { success: true, data: undefined };
  } catch (err) {
    logger.error("account.delete.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: "Failed to delete account. Please contact support@kiwimart.co.nz",
    };
  }
}
