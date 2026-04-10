// src/modules/listings/listing-lifecycle.service.ts
// ─── Listing update, delete, and status transitions ─────────────────────────

import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import { createNotification } from "@/modules/notifications/notification.service";
import { fireAndForget } from "@/lib/fire-and-forget";
import { notificationRepository } from "@/modules/notifications/notification.repository";
import { userRepository } from "@/modules/users/user.repository";
import { sendListingRejectedEmail } from "@/server/email";
import { getKeywordLists } from "@/lib/dynamic-lists";
import { toCents } from "@/lib/currency";
import type { Prisma } from "@prisma/client";
import { listingRepository } from "./listing.repository";
import { runAutoReviewFlow, notifyPriceDrop } from "./listing-review.service";
import { invalidateCache } from "@/server/lib/cache";
import { listingDetailKey } from "./listing-engagement.service";

// ── Types ───────────────────────────────────────────────────────────────────

export interface UpdateListingInput {
  listingId: string;
  title?: string | null;
  description?: string | null;
  price?: number | null;
  isGstIncluded?: boolean | null;
  condition?: string | null;
  categoryId?: string | null;
  subcategoryName?: string | null;
  region?: string | null;
  suburb?: string | null;
  shippingOption?: string | null;
  shippingPrice?: number | null;
  pickupAddress?: string | null;
  isOffersEnabled?: boolean | null;
  isUrgent?: boolean | null;
  isNegotiable?: boolean | null;
  shipsNationwide?: boolean | null;
}

export type UpdateResult =
  | { ok: true; listingId: string }
  | { ok: false; error: string };

// ── deleteListing ───────────────────────────────────────────────────────────

export async function deleteListing(
  listingId: string,
  userId: string,
  isAdmin: boolean,
): Promise<void> {
  if (!listingId) throw AppError.validation("Invalid listing ID.");

  const listing = await listingRepository.findByIdForDelete(listingId);
  if (!listing) throw AppError.notFound("Listing");

  if (listing.sellerId !== userId && !isAdmin) {
    throw AppError.unauthorised(
      "You do not have permission to delete this listing.",
    );
  }
  if (listing.status === "SOLD") {
    throw new AppError(
      "ORDER_WRONG_STATE",
      "Sold listings cannot be deleted.",
      400,
    );
  }

  await listingRepository.softDelete(listingId);
  void invalidateCache(listingDetailKey(listingId));

  audit({
    userId,
    action: "LISTING_DELETED",
    entityType: "Listing",
    entityId: listingId,
    metadata: { title: listing.title },
  });

  logger.info("listing.deleted", { listingId, userId });
}

// ── updateListing ───────────────────────────────────────────────────────────

export async function updateListing(
  userId: string,
  email: string,
  isAdmin: boolean,
  data: UpdateListingInput,
): Promise<UpdateResult> {
  const { listingId } = data;

  const existing = await listingRepository.findByIdForUpdate(listingId);
  if (!existing || existing.deletedAt) {
    return { ok: false, error: "Listing not found." };
  }
  if (existing.sellerId !== userId && !isAdmin) {
    return { ok: false, error: "Not authorised." };
  }

  const newPriceNzd = data.price != null ? toCents(data.price) : undefined;
  const priceDropData =
    newPriceNzd != null && newPriceNzd < existing.priceNzd
      ? {
          previousPriceNzd: existing.priceNzd,
          priceDroppedAt: new Date(),
        }
      : {};

  // Optimistic lock: include the last-known updatedAt in the WHERE clause
  const mainUpdateResult = await listingRepository.updateListingOptimistic(
    listingId,
    {
      ...(data.title != null ? { title: data.title } : {}),
      ...(data.description != null ? { description: data.description } : {}),
      ...(newPriceNzd != null ? { priceNzd: newPriceNzd } : {}),
      ...(data.isGstIncluded != null
        ? { isGstIncluded: data.isGstIncluded }
        : {}),
      ...(data.condition != null ? { condition: data.condition } : {}),
      ...(data.categoryId != null ? { categoryId: data.categoryId } : {}),
      ...(data.subcategoryName !== undefined
        ? { subcategoryName: data.subcategoryName ?? null }
        : {}),
      ...(data.region != null ? { region: data.region } : {}),
      ...(data.suburb != null ? { suburb: data.suburb } : {}),
      ...(data.shippingOption != null
        ? { shippingOption: data.shippingOption }
        : {}),
      ...(data.shippingPrice != null
        ? { shippingNzd: toCents(data.shippingPrice) }
        : {}),
      ...(data.pickupAddress !== undefined
        ? { pickupAddress: data.pickupAddress ?? null }
        : {}),
      ...(data.isOffersEnabled != null
        ? { isOffersEnabled: data.isOffersEnabled }
        : {}),
      ...(data.isUrgent != null ? { isUrgent: data.isUrgent } : {}),
      ...(data.isNegotiable != null ? { isNegotiable: data.isNegotiable } : {}),
      ...(data.shipsNationwide != null
        ? { shipsNationwide: data.shipsNationwide }
        : {}),
      ...priceDropData,
      // If listing was NEEDS_CHANGES, resubmit for review
      ...(existing.status === "NEEDS_CHANGES"
        ? {
            status: "PENDING_REVIEW",
            moderationNote: null,
            resubmissionCount: { increment: 1 },
          }
        : {}),
    } as Prisma.ListingUncheckedUpdateInput,
    existing.updatedAt,
  );

  if (mainUpdateResult.count === 0) {
    const stillExists = await listingRepository.findByIdForUpdate(listingId);
    if (!stillExists || stillExists.deletedAt) {
      return { ok: false, error: "Listing not found." };
    }
    return {
      ok: false,
      error:
        "This listing was modified by another request. Please refresh and try again.",
    };
  }

  // If resubmitting from NEEDS_CHANGES, re-run auto-review
  if (existing.status === "NEEDS_CHANGES") {
    try {
      const listingImages =
        await listingRepository.findImagesByListingId(listingId);

      const autoReviewResult = await runAutoReviewFlow(
        listingId,
        {
          title: data.title ?? existing.title,
          description: data.description ?? existing.description,
          priceNzd: newPriceNzd ?? existing.priceNzd,
          categoryId: data.categoryId ?? existing.categoryId,
          images: listingImages.map((img) => ({ isSafe: img.isSafe })),
        },
        userId,
        email,
        null,
        undefined,
      );

      // Notify admins of the resubmission when queued
      if (!autoReviewResult || autoReviewResult.ok) {
        const sellerName =
          (await userRepository.findDisplayName(userId)) ?? email;
        const listingTitle = data.title ?? existing.title;
        fireAndForget(
          notificationRepository.notifyAdmins(
            {
              type: "SYSTEM",
              title: "Listing resubmitted for review",
              body: `${sellerName} has resubmitted "${listingTitle}" after changes were requested.`,
              link: "/admin/listings",
            },
            ["SUPER_ADMIN", "TRUST_SAFETY_ADMIN"],
          ),
          "listing.resubmit.notifyAdmins",
          { listingId },
        );
      }

      if (autoReviewResult && !autoReviewResult.ok) {
        return autoReviewResult;
      }
    } catch (err) {
      logger.error("auto-review:resubmit-failed", {
        listingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { ok: true, listingId };
  }

  // Keyword scan for ACTIVE and PENDING_REVIEW listings
  if (existing.status === "ACTIVE" || existing.status === "PENDING_REVIEW") {
    try {
      const { banned: bannedKeywords } = await getKeywordLists();
      const updatedTitle = (data.title ?? existing.title).toLowerCase();
      const updatedDesc = (
        data.description ?? existing.description
      ).toLowerCase();
      const foundKeyword = bannedKeywords.find(
        (kw) => updatedTitle.includes(kw) || updatedDesc.includes(kw),
      );

      // Notify admins if listing is edited while under active review
      if (existing.status === "PENDING_REVIEW" && !foundKeyword) {
        const sellerNameForAdmin =
          (await userRepository.findDisplayName(userId)) ?? email;
        const listingTitleForAdmin = data.title ?? existing.title;

        fireAndForget(
          notificationRepository.notifyAdmins(
            {
              type: "SYSTEM",
              title: "Listing updated while under review",
              body: `${sellerNameForAdmin} edited their listing "${listingTitleForAdmin}" while it is pending review.`,
              link: "/admin/listings",
            },
            ["SUPER_ADMIN", "TRUST_SAFETY_ADMIN"],
          ),
          "listing.editWhilePending.notifyAdmins",
          { listingId },
        );

        audit({
          userId,
          action: "LISTING_EDITED_WHILE_PENDING",
          entityType: "Listing",
          entityId: listingId,
          metadata: {
            listingId,
            sellerId: userId,
            previousStatus: existing.status,
          },
        });
      }

      if (foundKeyword) {
        const moderationNote =
          "Listing removed: prohibited content detected after edit.";
        await listingRepository.updateListing(listingId, {
          status: "REMOVED",
          moderationNote,
        });

        const sellerInfo = await userRepository.findEmailInfo(userId);
        const listingTitle = data.title ?? existing.title;
        fireAndForget(
          Promise.all([
            createNotification({
              userId,
              type: "LISTING_REJECTED",
              title: "Listing removed",
              body: moderationNote,
              listingId,
            }),
            sendListingRejectedEmail({
              to: email,
              sellerName: sellerInfo?.displayName ?? email,
              listingTitle,
              rejectionReason: moderationNote,
            }),
          ]),
          "listing.keywordRemoval.notifyAndEmail",
          { listingId, userId },
        );

        audit({
          userId,
          action: "LISTING_REMOVED_POST_EDIT",
          entityType: "Listing",
          entityId: listingId,
          metadata: {
            listingId,
            detectedKeyword: foundKeyword,
            previousStatus: existing.status,
          },
        });

        return {
          ok: false,
          error:
            "Your listing has been removed because it contains prohibited content.",
        };
      }
    } catch (err) {
      logger.error("listing:edit-keyword-scan-failed", {
        listingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Price history tracking + notify watchers of price drop (fire-and-forget)
  if (newPriceNzd != null && newPriceNzd !== existing.priceNzd) {
    listingRepository.createPriceHistory(listingId, newPriceNzd);
  }

  if (newPriceNzd != null && newPriceNzd < existing.priceNzd) {
    notifyPriceDrop(
      listingId,
      existing.sellerId,
      data.title ?? existing.title,
      existing.priceNzd,
      newPriceNzd,
    );
  }

  void invalidateCache(listingDetailKey(listingId));
  return { ok: true, listingId };
}

// ── patchListingViaApi ──────────────────────────────────────────────────────
// Lightweight PATCH for the REST API — no auto-review, no keyword scan.

export async function patchListingViaApi(
  listingId: string,
  userId: string,
  update: Prisma.ListingUncheckedUpdateInput,
): Promise<
  | {
      ok: true;
      listing: {
        id: string;
        title: string;
        status: string;
        priceNzd: number;
        updatedAt: Date;
      };
    }
  | { ok: false; error: string; statusCode: number }
> {
  const existing = await listingRepository.findByIdForDelete(listingId);

  if (!existing) {
    return { ok: false, error: "Listing not found", statusCode: 404 };
  }
  if (existing.sellerId !== userId) {
    return { ok: false, error: "Not your listing", statusCode: 403 };
  }

  const updated = await listingRepository.updateListing(listingId, update);
  void invalidateCache(listingDetailKey(listingId));

  return {
    ok: true,
    listing: {
      id: updated.id,
      title: updated.title,
      status: updated.status,
      priceNzd: updated.priceNzd,
      updatedAt: updated.updatedAt,
    },
  };
}
