"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/verification.application.ts
// ─── Seller Verification Application Actions ─────────────────────────────────

import db from "@/lib/db";
import { requireUser } from "@/server/lib/requireUser";
import { requireAdmin } from "@/server/lib/requireAdmin";
import { audit } from "@/server/lib/audit";
import { createNotification } from "@/modules/notifications/notification.service";
import type { ActionResult } from "@/types";
import { reviewVerificationSchema as ReviewSchema } from "@/server/validators";

// ── Apply for Seller Verification ───────────────────────────────────────────

export async function applyForVerification(): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    // Check not already verified
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: {
        isVerifiedSeller: true,
        phone: true,
        verificationApplication: { select: { status: true } },
        _count: {
          select: {
            sellerOrders: { where: { status: "COMPLETED" } },
            reviews: { where: { approved: true } },
          },
        },
      },
    });

    if (!dbUser) return { success: false, error: "User not found." };
    if (dbUser.isVerifiedSeller)
      return { success: false, error: "You are already a verified seller." };
    if (dbUser.verificationApplication?.status === "PENDING") {
      return {
        success: false,
        error: "Your verification application is already under review.",
      };
    }

    // Check requirements
    if (dbUser._count.sellerOrders < 1) {
      return {
        success: false,
        error: "You need at least 1 completed sale to apply.",
      };
    }

    // Check avg rating >= 4.0 (ratings are stored as 1-50 in DB)
    const reviewAgg = await db.review.aggregate({
      where: { sellerId: user.id, approved: true },
      _avg: { rating: true },
    });
    const avgRating = reviewAgg._avg.rating ? reviewAgg._avg.rating / 10 : 0;
    if (avgRating < 4.0 && dbUser._count.reviews > 0) {
      return {
        success: false,
        error: "You need a rating of 4.0 or above to apply.",
      };
    }

    if (!dbUser.phone) {
      return {
        success: false,
        error: "Please add a phone number to your account first.",
      };
    }

    // Create or update application
    await db.verificationApplication.upsert({
      where: { sellerId: user.id },
      create: {
        sellerId: user.id,
        status: "PENDING",
      },
      update: {
        status: "PENDING",
        appliedAt: new Date(),
        reviewedAt: null,
        reviewedBy: null,
        adminNotes: null,
      },
    });

    // Notify admins
    const admins = await db.user.findMany({
      where: { isAdmin: true },
      select: { id: true },
      take: 10,
    });
    for (const admin of admins) {
      createNotification({
        userId: admin.id,
        type: "SYSTEM",
        title: "New verification application",
        body: `${user.email} has applied for seller verification.`,
        link: "/admin/sellers",
      }).catch(() => {});
    }

    audit({
      userId: user.id,
      action: "SELLER_VERIFICATION_APPLIED",
      entityType: "User",
      entityId: user.id,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "Your verification application couldn't be submitted. Please try again.",
      ),
    };
  }
}

// ── Approve / Reject Verification (Admin) ───────────────────────────────────

export async function reviewVerificationApplication(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    const parsed = ReviewSchema.safeParse(raw);
    if (!parsed.success)
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };

    const { sellerId, decision, notes } = parsed.data;

    const app = await db.verificationApplication.findUnique({
      where: { sellerId },
      select: { id: true, status: true },
    });
    if (!app) return { success: false, error: "Application not found." };
    if (app.status !== "PENDING")
      return { success: false, error: "Application already reviewed." };

    // Update application
    await db.verificationApplication.update({
      where: { sellerId },
      data: {
        status: decision,
        reviewedAt: new Date(),
        reviewedBy: guard.userId,
        adminNotes: notes,
      },
    });

    // If approved, mark user as verified seller
    if (decision === "APPROVED") {
      await db.user.update({
        where: { id: sellerId },
        data: { isVerifiedSeller: true, verifiedSellerAt: new Date() },
      });

      createNotification({
        userId: sellerId,
        type: "SYSTEM",
        title: "Seller verification approved!",
        body: `Congratulations! You are now a Verified Seller on ${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}.`,
        link: "/dashboard/seller",
      }).catch(() => {});
    } else {
      createNotification({
        userId: sellerId,
        type: "SYSTEM",
        title: "Verification application update",
        body: notes
          ? `Your verification application was not approved: ${notes}`
          : "Your verification application was not approved at this time.",
        link: "/account/settings",
      }).catch(() => {});
    }

    audit({
      userId: guard.userId,
      action:
        decision === "APPROVED"
          ? "SELLER_VERIFICATION_APPROVED"
          : "SELLER_VERIFICATION_REJECTED",
      entityType: "User",
      entityId: sellerId,
      metadata: { decision, notes },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't process this verification review. Please try again.",
      ),
    };
  }
}
