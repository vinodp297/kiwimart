"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/seller.ts
// ─── Seller Onboarding Actions ────────────────────────────────────────────────

import { headers } from "next/headers";
import db from "@/lib/db";
import { userRepository } from "@/modules/users/user.repository";
import { requireUser } from "@/server/lib/requireUser";
import { requireAdmin } from "@/server/lib/requireAdmin";
import { audit } from "@/server/lib/audit";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { getEmailClient, EMAIL_FROM } from "@/infrastructure/email/client";
import { createNotification } from "@/modules/notifications/notification.service";
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

  // 7. Notify admin by email (non-blocking)
  const adminEmail = process.env.ADMIN_EMAIL;
  const emailClient = getEmailClient();
  if (emailClient && adminEmail) {
    emailClient.emails
      .send({
        from: EMAIL_FROM,
        to: adminEmail,
        subject: `[${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}] New ID Verification Request`,
        html: `
          <p>A seller has submitted their ID for verification.</p>
          <ul>
            <li><strong>User ID:</strong> ${user.id}</li>
            <li><strong>Email:</strong> ${user.email}</li>
            <li><strong>Submitted at:</strong> ${now.toISOString()}</li>
          </ul>
          <p>
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/admin">
              Review in Admin Dashboard →
            </a>
          </p>
        `,
      })
      .catch(() => {}); // non-fatal
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

  // 3. Check user exists and has a pending submission
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

  // 4. Execute
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

  // 6. Notify the seller via email (non-blocking)
  const emailClient = getEmailClient();
  if (emailClient) {
    emailClient.emails
      .send({
        from: EMAIL_FROM,
        to: target.email,
        subject: `Your ${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"} ID verification has been approved!`,
        html: `
          <p>Great news! Your identity verification has been approved.</p>
          <p>
            You now have <strong>ID-Verified Seller</strong> status on ${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"},
            which unlocks unlimited listings and next-day payouts.
          </p>
          <p>
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/seller/onboarding">
              View your Seller Hub →
            </a>
          </p>
        `,
      })
      .catch(() => {}); // non-fatal
  }

  // 7. In-app notification (fire-and-forget)
  createNotification({
    userId: target.id,
    type: "ID_VERIFIED",
    title: "ID verification approved! ✅",
    body: "You are now an ID Verified seller. Unlimited listings and next-day payouts are now enabled.",
    link: "/seller/onboarding",
  }).catch(() => {});

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
    await db.verificationApplication.updateMany({
      where: { sellerId: userId, status: "PENDING" },
      data: {
        status: "REJECTED",
        reviewedAt: new Date(),
        reviewedBy: guard.userId,
        adminNotes: `${reason}: ${rejectionMessage}`,
      },
    });

    // Clear idSubmittedAt so user can resubmit
    await userRepository.update(userId, { idSubmittedAt: null });

    audit({
      userId: guard.userId,
      action: "ID_VERIFICATION_REJECTED" as const,
      entityType: "User",
      entityId: userId,
      metadata: { reason, notes },
    });

    createNotification({
      userId: target.id,
      type: "SYSTEM",
      title: "ID verification not approved",
      body: `Your ID verification was not approved: ${rejectionMessage}. You can resubmit with updated documents.`,
      link: "/seller/onboarding",
    }).catch(() => {});

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Rejection failed. Please try again."),
    };
  }
}
