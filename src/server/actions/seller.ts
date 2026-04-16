"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/seller.ts
// ─── Seller Onboarding Actions ────────────────────────────────────────────────

import { headers } from "next/headers";
import { verificationRepository } from "@/modules/sellers/verification.repository";
import { userRepository } from "@/modules/users/user.repository";
import { requireUser } from "@/server/lib/requireUser";
import { requireAdmin } from "@/server/lib/requireAdmin";
import { audit } from "@/server/lib/audit";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { logger } from "@/shared/logger";
import { enqueueEmail } from "@/lib/email-queue";
import { createNotification } from "@/modules/notifications/notification.service";
import { env } from "@/env";
import { fireAndForget } from "@/lib/fire-and-forget";
import type { ActionResult } from "@/types";
import {
  approveIdSchema as ApproveIdSchema,
  rejectIdVerificationSchema,
} from "@/server/validators";

// ── Accept Seller Terms ───────────────────────────────────────────────────────

/**
 * Record that the current user has accepted the seller terms & conditions.
 * Idempotent — safe to call multiple times.
 */
export async function acceptSellerTerms(): Promise<ActionResult<void>> {
  // 1. Auth
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (err) {
    return { success: false, error: safeActionError(err, "Unauthorised.") };
  }

  // 2. Authorise — must have seller access
  if (!user.isSellerEnabled) {
    return {
      success: false,
      error: "Seller access is not enabled on your account.",
    };
  }

  // 3. Validate — nothing to validate beyond auth

  // 4. Rate limit — 5 attempts per 15 min (reuse auth limiter)
  const ip = getClientIp(await headers());
  const limit = await rateLimit("auth", `seller-terms:${user.id}`);
  if (!limit.success) {
    return {
      success: false,
      error: "Too many requests. Please try again in a few minutes.",
    };
  }

  // 5. Execute
  await userRepository.update(user.id, { sellerTermsAcceptedAt: new Date() });

  // 6. Audit
  audit({
    userId: user.id,
    action: "SELLER_TERMS_ACCEPTED",
    entityType: "User",
    entityId: user.id,
    ip,
  });

  // 7. Return
  return { success: true, data: undefined };
}

// ── Submit ID Verification Request ───────────────────────────────────────────

/**
 * Mark the current user as having submitted their ID for verification.
 * Sends an admin notification email.
 */
export async function submitIdVerification(): Promise<ActionResult<void>> {
  // 1. Auth
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (err) {
    return { success: false, error: safeActionError(err, "Unauthorised.") };
  }

  // 2. Authorise
  if (!user.isSellerEnabled) {
    return {
      success: false,
      error: "Seller access is not enabled on your account.",
    };
  }

  // 3. Rate limit — prevent repeated submissions
  const ip = getClientIp(await headers());
  const limit = await rateLimit("auth", `id-verify:${user.id}`);
  if (!limit.success) {
    return {
      success: false,
      error: "Too many requests. Please try again in a few minutes.",
    };
  }

  // 4. Check not already submitted or verified
  const dbUser = await userRepository.findIdVerificationStatus(user.id);

  if (!dbUser) return { success: false, error: "User not found." };
  if (dbUser.idVerified)
    return { success: false, error: "Your ID is already verified." };
  if (dbUser.idSubmittedAt) {
    return {
      success: false,
      error: "Your ID verification is already pending review.",
    };
  }

  // 5. Execute
  const now = new Date();
  await userRepository.update(user.id, { idSubmittedAt: now });

  // 6. Audit
  audit({
    userId: user.id,
    action: "ID_VERIFICATION_SUBMITTED",
    entityType: "User",
    entityId: user.id,
    ip,
  });

  // 7. Notify admin by email — queued asynchronously
  const adminEmail = env.ADMIN_EMAIL;
  if (adminEmail) {
    // Email queued — delivered asynchronously (non-blocking)
    await enqueueEmail({
      template: "adminIdVerification",
      to: adminEmail,
      userId: user.id,
      userEmail: user.email,
      submittedAt: now.toISOString(),
      adminUrl: `${env.NEXT_PUBLIC_APP_URL}/admin`,
    }).catch((err: unknown) => {
      logger.error("seller.submitIdVerification.email.failed", {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
    }); // non-fatal — admin is notified via in-app notification too
  }

  return { success: true, data: undefined };
}

// ── Approve ID Verification (Admin) ──────────────────────────────────────────

/**
 * Admin action: mark a user's ID as verified and send them a confirmation email.
 */
export async function approveIdVerification(
  userId: string,
): Promise<ActionResult<void>> {
  // 1. Auth — admin only
  const guard = await requireAdmin();
  if ("error" in guard) return { success: false, error: guard.error };

  // 2. Validate input
  const parsed = ApproveIdSchema.safeParse({ userId });
  if (!parsed.success) {
    return {
      success: false,
      error:
        parsed.error.issues[0]?.message ??
        "Please check your input and try again.",
    };
  }

  // 3. Rate limit — 20 ID verification actions per hour per admin (keyed by admin ID)
  try {
    const idVerifyLimit = await rateLimit(
      "adminIdVerify",
      `admin:${guard.userId}:approveIdVerification`,
    );
    if (!idVerifyLimit.success) {
      return { success: false, error: "Too many requests. Please slow down." };
    }
  } catch (rlErr) {
    logger.warn("admin:rate-limit-unavailable", {
      action: "approveIdVerification",
      adminId: guard.userId,
      error: rlErr instanceof Error ? rlErr.message : String(rlErr),
    });
    // Fail open — allow the action if rate limiter is unavailable
  }

  // 4. Check user exists and has a pending submission
  const target = await userRepository.findForIdApproval(parsed.data.userId);

  if (!target) return { success: false, error: "User not found." };
  if (target.idVerified)
    return { success: false, error: "User is already ID-verified." };
  if (!target.idSubmittedAt) {
    return {
      success: false,
      error: "User has not submitted an ID verification request.",
    };
  }

  // 5. Execute
  const now = new Date();
  await userRepository.update(target.id, {
    idVerified: true,
    idVerifiedAt: now,
  });

  // 5. Audit
  audit({
    userId: guard.userId,
    action: "ID_VERIFICATION_APPROVED",
    entityType: "User",
    entityId: target.id,
    metadata: { approvedBy: guard.userId },
  });

  // 6. Notify the seller via email — queued asynchronously (non-blocking)
  await enqueueEmail({
    template: "adminIdVerification",
    to: target.email,
    userId: target.id,
    userEmail: target.email,
    submittedAt: new Date().toISOString(),
    adminUrl: `${env.NEXT_PUBLIC_APP_URL}/seller/onboarding`,
  }).catch((err: unknown) => {
    logger.error("seller.approveIdVerification.email.failed", {
      error: err instanceof Error ? err.message : String(err),
      userId: target.id,
    });
  }); // non-fatal

  // 7. In-app notification (fire-and-forget)
  fireAndForget(
    createNotification({
      userId: target.id,
      type: "ID_VERIFIED",
      title: "ID verification approved! ✅",
      body: "You are now an ID Verified seller. Unlimited listings and next-day payouts are now enabled.",
      link: "/seller/onboarding",
    }),
    "seller.approveIdVerification.notification",
    { userId: target.id },
  );

  // 8. Return
  return { success: true, data: undefined };
}

// ── rejectIdVerification — Admin rejects ID submission ──────────────────────

export async function rejectIdVerification(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    const parsed = rejectIdVerificationSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    // Rate limit — 20 ID verification actions per hour per admin (keyed by admin ID)
    try {
      const idVerifyLimit = await rateLimit(
        "adminIdVerify",
        `admin:${guard.userId}:rejectIdVerification`,
      );
      if (!idVerifyLimit.success) {
        return {
          success: false,
          error: "Too many requests. Please slow down.",
        };
      }
    } catch (rlErr) {
      logger.warn("admin:rate-limit-unavailable", {
        action: "rejectIdVerification",
        adminId: guard.userId,
        error: rlErr instanceof Error ? rlErr.message : String(rlErr),
      });
      // Fail open — allow the action if rate limiter is unavailable
    }

    const { userId, reason, notes } = parsed.data;

    const target = await userRepository.findForIdApproval(userId);
    if (!target) return { success: false, error: "User not found." };
    if (target.idVerified)
      return { success: false, error: "User is already ID verified." };

    const reasonLabels: Record<string, string> = {
      DOCUMENT_UNREADABLE: "Document was unreadable",
      NAME_MISMATCH: "Name on document doesn't match account",
      DOCUMENT_EXPIRED: "Document has expired",
      SUSPECTED_FRAUD: "Suspected fraudulent document",
      OTHER: notes || "Other reason",
    };
    const rejectionMessage = reasonLabels[reason] ?? reason;

    // Update VerificationApplication
    await verificationRepository.rejectPendingByUser(
      userId,
      guard.userId,
      `${reason}: ${rejectionMessage}`,
    );

    // Clear idSubmittedAt so user can resubmit
    await userRepository.update(userId, { idSubmittedAt: null });

    audit({
      userId: guard.userId,
      action: "ID_VERIFICATION_REJECTED" as const,
      entityType: "User",
      entityId: userId,
      metadata: { reason, notes },
    });

    fireAndForget(
      createNotification({
        userId: target.id,
        type: "SYSTEM",
        title: "ID verification not approved",
        body: `Your ID verification was not approved: ${rejectionMessage}. You can resubmit with updated documents.`,
        link: "/seller/onboarding",
      }),
      "seller.rejectIdVerification.notification",
      { userId: target.id },
    );

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Rejection failed. Please try again."),
    };
  }
}
