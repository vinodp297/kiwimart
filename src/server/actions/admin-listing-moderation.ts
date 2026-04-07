"use server";
// src/server/actions/admin-listing-moderation.ts
// ─── Admin Listing Moderation Server Actions ──────────────────────────────────
// Actions for the listing review queue: approve, request changes, reject.

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import db from "@/lib/db";
import { audit } from "@/server/lib/audit";
import { requirePermission } from "@/shared/auth/requirePermission";
import { getClientIp } from "@/server/lib/rateLimit";
import { createNotification } from "@/modules/notifications/notification.service";
import {
  sendListingApprovedEmail,
  sendListingNeedsChangesEmail,
  sendListingRejectedEmail,
} from "@/server/email";
import { logger } from "@/shared/logger";
import type { ActionResult } from "@/types";

// ── approveListing ──────────────────────────────────────────────────────────

export async function approveListing(
  listingId: string,
): Promise<ActionResult<void>> {
  try {
    const admin = await requirePermission("MODERATE_CONTENT");
    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);

    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        title: true,
        status: true,
        sellerId: true,
        deletedAt: true,
        seller: { select: { email: true, displayName: true } },
      },
    });

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

    await db.listing.update({
      where: { id: listingId },
      data: {
        status: "ACTIVE",
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        moderatedBy: admin.id,
        moderatedAt: new Date(),
        moderationNote: null,
      },
    });

    audit({
      userId: admin.id,
      action: "LISTING_APPROVED",
      entityType: "Listing",
      entityId: listingId,
      metadata: { title: listing.title, sellerId: listing.sellerId },
      ip,
    });

    // Notify seller
    createNotification({
      userId: listing.sellerId,
      type: "LISTING_APPROVED",
      title: "Listing approved!",
      body: `Your listing "${listing.title}" has been approved and is now live.`,
      listingId,
      link: `/listings/${listingId}`,
    }).catch(() => {});

    // Email seller
    if (listing.seller?.email) {
      sendListingApprovedEmail({
        to: listing.seller.email,
        sellerName: listing.seller.displayName ?? "there",
        listingTitle: listing.title,
        listingUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://kiwimart.co.nz"}/listings/${listingId}`,
      }).catch(() => {});
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
    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);

    if (!note.trim()) {
      return { success: false, error: "A moderation note is required." };
    }

    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        title: true,
        status: true,
        sellerId: true,
        deletedAt: true,
        seller: { select: { email: true, displayName: true } },
      },
    });

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

    await db.listing.update({
      where: { id: listingId },
      data: {
        status: "NEEDS_CHANGES",
        moderatedBy: admin.id,
        moderatedAt: new Date(),
        moderationNote: note.trim(),
      },
    });

    audit({
      userId: admin.id,
      action: "LISTING_NEEDS_CHANGES",
      entityType: "Listing",
      entityId: listingId,
      metadata: { title: listing.title, note: note.trim() },
      ip,
    });

    // Notify seller
    createNotification({
      userId: listing.sellerId,
      type: "LISTING_NEEDS_CHANGES",
      title: "Listing needs changes",
      body: `Your listing "${listing.title}" requires changes before it can be approved: ${note.trim()}`,
      listingId,
      link: `/sell/edit/${listingId}`,
    }).catch(() => {});

    // Email seller
    if (listing.seller?.email) {
      sendListingNeedsChangesEmail({
        to: listing.seller.email,
        sellerName: listing.seller.displayName ?? "there",
        listingTitle: listing.title,
        moderationNote: note.trim(),
        editUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://kiwimart.co.nz"}/sell/edit/${listingId}`,
      }).catch(() => {});
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
    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);

    if (!reason.trim()) {
      return { success: false, error: "A rejection reason is required." };
    }

    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        title: true,
        status: true,
        sellerId: true,
        deletedAt: true,
        seller: { select: { email: true, displayName: true } },
      },
    });

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

    await db.listing.update({
      where: { id: listingId },
      data: {
        status: "REMOVED",
        moderatedBy: admin.id,
        moderatedAt: new Date(),
        moderationNote: reason.trim(),
      },
    });

    audit({
      userId: admin.id,
      action: "LISTING_REJECTED",
      entityType: "Listing",
      entityId: listingId,
      metadata: { title: listing.title, reason: reason.trim() },
      ip,
    });

    // Notify seller
    createNotification({
      userId: listing.sellerId,
      type: "LISTING_REJECTED",
      title: "Listing rejected",
      body: `Your listing "${listing.title}" has been rejected: ${reason.trim()}`,
      listingId,
    }).catch(() => {});

    // Email seller
    if (listing.seller?.email) {
      sendListingRejectedEmail({
        to: listing.seller.email,
        sellerName: listing.seller.displayName ?? "there",
        listingTitle: listing.title,
        rejectionReason: reason.trim(),
      }).catch(() => {});
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
    db.listing.findMany({
      where: { status: "PENDING_REVIEW", deletedAt: null },
      orderBy: [{ autoRiskScore: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        priceNzd: true,
        autoRiskScore: true,
        autoRiskFlags: true,
        resubmissionCount: true,
        createdAt: true,
        status: true,
        seller: {
          select: {
            id: true,
            displayName: true,
            email: true,
            isPhoneVerified: true,
            idVerified: true,
          },
        },
        images: {
          orderBy: { order: "asc" },
          take: 1,
          select: { r2Key: true, thumbnailKey: true },
        },
      },
    }),
    db.listing.findMany({
      where: { status: "NEEDS_CHANGES", deletedAt: null },
      orderBy: { moderatedAt: "desc" },
      select: {
        id: true,
        title: true,
        priceNzd: true,
        autoRiskScore: true,
        autoRiskFlags: true,
        moderationNote: true,
        moderatedAt: true,
        createdAt: true,
        status: true,
        seller: {
          select: {
            id: true,
            displayName: true,
            email: true,
            isPhoneVerified: true,
            idVerified: true,
          },
        },
        images: {
          orderBy: { order: "asc" },
          take: 1,
          select: { r2Key: true, thumbnailKey: true },
        },
      },
    }),
    Promise.all([
      db.listing.count({
        where: { status: "PENDING_REVIEW", deletedAt: null },
      }),
      db.listing.count({ where: { status: "NEEDS_CHANGES", deletedAt: null } }),
      db.listing.count({
        where: {
          status: "ACTIVE",
          deletedAt: null,
          OR: [
            {
              moderatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
            {
              publishedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
          ],
        },
      }),
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
