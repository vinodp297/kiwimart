"use server";
// src/server/actions/admin-listing-moderation.ts
// ─── Admin Listing Moderation Server Actions ──────────────────────────────────
// Actions for the listing review queue: approve, request changes, reject.

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { listingRepository } from "@/modules/listings/listing.repository";
import { audit } from "@/server/lib/audit";
import { requirePermission } from "@/shared/auth/requirePermission";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { createNotification } from "@/modules/notifications/notification.service";
import {
  sendListingApprovedEmail,
  sendListingNeedsChangesEmail,
  sendListingRejectedEmail,
} from "@/server/email";
import { logger } from "@/shared/logger";
import { fireAndForget } from "@/lib/fire-and-forget";
import type { ActionResult } from "@/types";

// ── approveListing ──────────────────────────────────────────────────────────

export async function approveListing(
  listingId: string,
): Promise<ActionResult<void>> {
  try {
    const admin = await requirePermission("MODERATE_CONTENT");

    // Rate limit — 100 listing moderation actions per hour per admin (keyed by admin ID)
    try {
      const limit = await rateLimit(
        "adminListingMod",
        `admin:${admin.id}:approveListing`,
      );
      if (!limit.success) {
        return {
          success: false,
          error: "Too many requests. Please slow down.",
        };
      }
    } catch (rlErr) {
      logger.warn("admin:rate-limit-unavailable", {
        action: "approveListing",
        adminId: admin.id,
        error: rlErr instanceof Error ? rlErr.message : String(rlErr),
      });
      // Fail open — allow the action if rate limiter is unavailable
    }

    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);

    const listing = await listingRepository.findForModeration(listingId);

    if (!listing || listing.deletedAt) {
      return { success: false, error: "Listing not found." };
    }

    if (listing.sellerId === admin.id) {
      return {
        success: false,
        error:
          "You cannot approve your own listing. Another admin must review it.",
      };
    }

    if (
      listing.status !== "PENDING_REVIEW" &&
      listing.status !== "NEEDS_CHANGES"
    ) {
      return {
        success: false,
        error: `Cannot approve a listing with status "${listing.status}".`,
      };
    }

    await listingRepository.approveListing(listingId, admin.id);

    audit({
      userId: admin.id,
      action: "LISTING_APPROVED",
      entityType: "Listing",
      entityId: listingId,
      metadata: { title: listing.title, sellerId: listing.sellerId },
      ip,
    });

    // Notify seller
    fireAndForget(
      createNotification({
        userId: listing.sellerId,
        type: "LISTING_APPROVED",
        title: "Listing approved!",
        body: `Your listing "${listing.title}" has been approved and is now live.`,
        listingId,
        link: `/listings/${listingId}`,
      }),
      "admin.approveListing.notification",
      { listingId },
    );

    // Email seller
    if (listing.seller?.email) {
      fireAndForget(
        sendListingApprovedEmail({
          to: listing.seller.email,
          sellerName: listing.seller.displayName ?? "there",
          listingTitle: listing.title,
          listingUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://buyzi.co.nz"}/listings/${listingId}`,
        }),
        "admin.approveListing.email",
        { listingId },
      );
    }

    revalidatePath("/admin/listings");
    revalidatePath(`/listings/${listingId}`);
    revalidatePath("/search");

    return { success: true, data: undefined };
  } catch (err) {
    logger.error("admin:approve-listing-failed", {
      listingId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: "Failed to approve listing. Please try again.",
    };
  }
}

// ── requestListingChanges ───────────────────────────────────────────────────

export async function requestListingChanges(
  listingId: string,
  note: string,
): Promise<ActionResult<void>> {
  try {
    const admin = await requirePermission("MODERATE_CONTENT");

    // Rate limit — 100 listing moderation actions per hour per admin (keyed by admin ID)
    try {
      const limit = await rateLimit(
        "adminListingMod",
        `admin:${admin.id}:requestListingChanges`,
      );
      if (!limit.success) {
        return {
          success: false,
          error: "Too many requests. Please slow down.",
        };
      }
    } catch (rlErr) {
      logger.warn("admin:rate-limit-unavailable", {
        action: "requestListingChanges",
        adminId: admin.id,
        error: rlErr instanceof Error ? rlErr.message : String(rlErr),
      });
      // Fail open — allow the action if rate limiter is unavailable
    }

    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);

    if (!note.trim()) {
      return { success: false, error: "A moderation note is required." };
    }

    const listing = await listingRepository.findForModeration(listingId);

    if (!listing || listing.deletedAt) {
      return { success: false, error: "Listing not found." };
    }

    if (listing.sellerId === admin.id) {
      return {
        success: false,
        error:
          "You cannot moderate your own listing. Another admin must review it.",
      };
    }

    if (listing.status !== "PENDING_REVIEW") {
      return {
        success: false,
        error: `Cannot request changes on a listing with status "${listing.status}".`,
      };
    }

    await listingRepository.requestChanges(listingId, admin.id, note.trim());

    audit({
      userId: admin.id,
      action: "LISTING_NEEDS_CHANGES",
      entityType: "Listing",
      entityId: listingId,
      metadata: { title: listing.title, note: note.trim() },
      ip,
    });

    // Notify seller
    fireAndForget(
      createNotification({
        userId: listing.sellerId,
        type: "LISTING_NEEDS_CHANGES",
        title: "Listing needs changes",
        body: `Your listing "${listing.title}" requires changes before it can be approved: ${note.trim()}`,
        listingId,
        link: `/sell/edit/${listingId}`,
      }),
      "admin.requestListingChanges.notification",
      { listingId },
    );

    // Email seller
    if (listing.seller?.email) {
      fireAndForget(
        sendListingNeedsChangesEmail({
          to: listing.seller.email,
          sellerName: listing.seller.displayName ?? "there",
          listingTitle: listing.title,
          moderationNote: note.trim(),
          editUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://buyzi.co.nz"}/sell/edit/${listingId}`,
        }),
        "admin.requestListingChanges.email",
        { listingId },
      );
    }

    revalidatePath("/admin/listings");

    return { success: true, data: undefined };
  } catch (err) {
    logger.error("admin:request-listing-changes-failed", {
      listingId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: "Failed to request changes. Please try again.",
    };
  }
}

// ── rejectListing ───────────────────────────────────────────────────────────

export async function rejectListing(
  listingId: string,
  reason: string,
): Promise<ActionResult<void>> {
  try {
    const admin = await requirePermission("MODERATE_CONTENT");

    // Rate limit — 100 listing moderation actions per hour per admin (keyed by admin ID)
    try {
      const limit = await rateLimit(
        "adminListingMod",
        `admin:${admin.id}:rejectListing`,
      );
      if (!limit.success) {
        return {
          success: false,
          error: "Too many requests. Please slow down.",
        };
      }
    } catch (rlErr) {
      logger.warn("admin:rate-limit-unavailable", {
        action: "rejectListing",
        adminId: admin.id,
        error: rlErr instanceof Error ? rlErr.message : String(rlErr),
      });
      // Fail open — allow the action if rate limiter is unavailable
    }

    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);

    if (!reason.trim()) {
      return { success: false, error: "A rejection reason is required." };
    }

    const listing = await listingRepository.findForModeration(listingId);

    if (!listing || listing.deletedAt) {
      return { success: false, error: "Listing not found." };
    }

    if (listing.sellerId === admin.id) {
      return {
        success: false,
        error:
          "You cannot reject your own listing. Another admin must review it.",
      };
    }

    if (
      listing.status !== "PENDING_REVIEW" &&
      listing.status !== "NEEDS_CHANGES"
    ) {
      return {
        success: false,
        error: `Cannot reject a listing with status "${listing.status}".`,
      };
    }

    await listingRepository.rejectListing(listingId, admin.id, reason.trim());

    audit({
      userId: admin.id,
      action: "LISTING_REJECTED",
      entityType: "Listing",
      entityId: listingId,
      metadata: { title: listing.title, reason: reason.trim() },
      ip,
    });

    // Notify seller
    fireAndForget(
      createNotification({
        userId: listing.sellerId,
        type: "LISTING_REJECTED",
        title: "Listing rejected",
        body: `Your listing "${listing.title}" has been rejected: ${reason.trim()}`,
        listingId,
      }),
      "admin.rejectListing.notification",
      { listingId },
    );

    // Email seller
    if (listing.seller?.email) {
      fireAndForget(
        sendListingRejectedEmail({
          to: listing.seller.email,
          sellerName: listing.seller.displayName ?? "there",
          listingTitle: listing.title,
          rejectionReason: reason.trim(),
        }),
        "admin.rejectListing.email",
        { listingId },
      );
    }

    revalidatePath("/admin/listings");

    return { success: true, data: undefined };
  } catch (err) {
    logger.error("admin:reject-listing-failed", {
      listingId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: "Failed to reject listing. Please try again.",
    };
  }
}

// ── getPendingListings (for admin queue page) ───────────────────────────────

export async function getPendingListings() {
  await requirePermission("MODERATE_CONTENT");

  const [pendingReview, needsChanges, stats] = await Promise.all([
    listingRepository.findPendingReview(),
    listingRepository.findNeedsChanges(),
    Promise.all([
      listingRepository.countPendingReview(),
      listingRepository.countNeedsChanges(),
      listingRepository.countApprovedToday(),
    ]),
  ]);

  return {
    pendingReview: pendingReview.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
    })),
    needsChanges: needsChanges.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
      moderatedAt: l.moderatedAt?.toISOString() ?? null,
    })),
    stats: {
      pendingCount: stats[0],
      needsChangesCount: stats[1],
      approvedToday: stats[2],
    },
  };
}
