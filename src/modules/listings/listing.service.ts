// src/modules/listings/listing.service.ts
// ─── Listing Service ─────────────────────────────────────────────────────────
// Listing CRUD and watchlist operations. Framework-free.

import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import { createNotification } from "@/modules/notifications/notification.service";
import { notificationRepository } from "@/modules/notifications/notification.repository";
import { userRepository } from "@/modules/users/user.repository";
import {
  sendPriceDropEmail,
  sendListingApprovedEmail,
  sendListingRejectedEmail,
} from "@/server/email";
import {
  runAutoReview,
  type AutoReviewInput,
  type SellerProfile,
} from "@/server/services/listing-review/auto-review.service";
import { getKeywordLists } from "@/lib/dynamic-lists";
import type { Prisma } from "@prisma/client";
import { listingRepository } from "./listing.repository";

// ── Types for service inputs ────────────────────────────────────────────────

export interface CreateListingInput {
  title: string;
  description: string;
  price: number;
  isGstIncluded: boolean;
  condition: string;
  categoryId: string;
  subcategoryName?: string | null;
  region: string;
  suburb: string;
  shippingOption: string;
  shippingPrice?: number | null;
  pickupAddress?: string | null;
  isOffersEnabled: boolean;
  isUrgent: boolean;
  isNegotiable: boolean;
  shipsNationwide: boolean;
  imageKeys: string[];
  attributes: { label: string; value: string }[];
}

export interface SaveDraftInput {
  draftId?: string;
  title?: string;
  description?: string;
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
  imageKeys?: string[] | null;
}

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

type CreateResult =
  | { ok: true; listingId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

type UpdateResult =
  | { ok: true; listingId: string }
  | { ok: false; error: string };

type DraftResult =
  | { ok: true; draftId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export class ListingService {
  // ── deleteListing ─────────────────────────────────────────────────────────

  async deleteListing(
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

    audit({
      userId,
      action: "LISTING_DELETED",
      entityType: "Listing",
      entityId: listingId,
      metadata: { title: listing.title },
    });

    logger.info("listing.deleted", { listingId, userId });
  }

  // ── toggleWatch ───────────────────────────────────────────────────────────

  async toggleWatch(
    listingId: string,
    userId: string,
  ): Promise<{ watching: boolean }> {
    const existing = await listingRepository.findWatchlistItem(
      userId,
      listingId,
    );

    if (existing) {
      await listingRepository.removeWatch(userId, listingId);
      return { watching: false };
    }

    const listing = await listingRepository.findByIdActive(listingId);
    if (!listing) throw AppError.notFound("Listing");

    if (listing.sellerId === userId) {
      throw new AppError(
        "INVALID_OPERATION",
        "You cannot add your own listing to your watchlist.",
        400,
      );
    }

    await listingRepository.addWatch(userId, listingId);
    return { watching: true };
  }

  // ── getListingById ────────────────────────────────────────────────────────

  async getListingById(id: string) {
    const listing = await listingRepository.findByIdWithSellerAndImages(id);

    if (!listing) return null;

    // Increment view count (fire-and-forget)
    listingRepository.incrementViewCount(id);

    return listing;
  }

  // ── createListing ─────────────────────────────────────────────────────────

  async createListing(
    userId: string,
    email: string,
    isStripeOnboarded: boolean,
    data: CreateListingInput,
    ip: string,
  ): Promise<CreateResult> {
    // 1. Authorise — check email verified, seller terms, stripe
    const userDetails = await userRepository.findForListingAuth(userId);
    if (!userDetails?.emailVerified) {
      return {
        ok: false,
        error: "Please verify your email address before creating a listing.",
      };
    }
    if (!userDetails.sellerTermsAcceptedAt) {
      return {
        ok: false,
        error:
          "Please accept seller terms before listing items. Go to Seller Hub to accept.",
      };
    }
    if (!isStripeOnboarded) {
      return {
        ok: false,
        error: "Please set up your payment account before listing items.",
      };
    }

    // 2. Validate category exists
    const category = await listingRepository.findCategoryById(data.categoryId);
    if (!category) {
      return {
        ok: false,
        error: "Invalid category.",
        fieldErrors: { categoryId: ["Invalid category"] },
      };
    }

    // 3. Validate image keys exist and are safe
    const images = await listingRepository.findImagesByKeys(data.imageKeys);
    const missingKeys = data.imageKeys.filter(
      (key) => !images.some((img) => img.r2Key === key),
    );
    const unsafeImages = images.filter((img) => !img.isScanned || !img.isSafe);
    if (missingKeys.length > 0 || unsafeImages.length > 0) {
      const issues: string[] = [];
      if (missingKeys.length > 0)
        issues.push(
          `${missingKeys.length} photo${missingKeys.length > 1 ? "s" : ""} could not be found`,
        );
      if (unsafeImages.length > 0)
        issues.push(
          `${unsafeImages.length} photo${unsafeImages.length > 1 ? "s" : ""} didn't pass verification`,
        );
      logger.error("listing:image-validation-failed", {
        missingKeys,
        unsafeImages: unsafeImages.map((i) => ({
          id: i.id,
          isScanned: i.isScanned,
          isSafe: i.isSafe,
        })),
        totalExpected: data.imageKeys.length,
        totalFound: images.length,
      });
      return {
        ok: false,
        error: `There's an issue with your photos: ${issues.join(" and ")}. Please go back to Step 1 and re-upload them.`,
        fieldErrors: { imageKeys: [`${issues.join("; ")}`] },
      };
    }

    // 4. Create listing in a transaction
    const priceNzd = Math.round(data.price * 100);
    const listing = await listingRepository.$transaction(async (tx) => {
      const created = await listingRepository.create(
        {
          sellerId: userId,
          title: data.title,
          description: data.description,
          priceNzd,
          isGstIncluded: data.isGstIncluded,
          condition: data.condition,
          status: "PENDING_REVIEW",
          categoryId: data.categoryId,
          subcategoryName: data.subcategoryName ?? null,
          region: data.region,
          suburb: data.suburb,
          shippingOption: data.shippingOption,
          shippingNzd:
            data.shippingPrice != null
              ? Math.round(data.shippingPrice * 100)
              : null,
          pickupAddress: data.pickupAddress ?? null,
          isOffersEnabled: data.isOffersEnabled,
          isUrgent: data.isUrgent,
          isNegotiable: data.isNegotiable,
          shipsNationwide: data.shipsNationwide,
          images: {
            create: data.imageKeys.map((key, i) => ({
              r2Key: key,
              order: i,
            })),
          },
          attrs: {
            create: data.attributes.map((attr, i) => ({
              label: attr.label,
              value: attr.value,
              order: i,
            })),
          },
        } as Parameters<typeof listingRepository.create>[0],
        tx,
      );

      if (!userDetails.isSellerEnabled) {
        await listingRepository.enableSeller(userId, tx);
      }

      return created;
    });

    // 5. Record initial price history (fire-and-forget)
    listingRepository.createPriceHistory(listing.id, priceNzd);

    // 6. Auto-review the listing
    try {
      const autoReviewResult = await this.runAutoReviewFlow(
        listing.id,
        {
          title: data.title,
          description: data.description,
          priceNzd,
          categoryId: data.categoryId,
          images: images.map((img) => ({ isSafe: img.isSafe })),
        },
        userId,
        email,
        userDetails.displayName,
        ip,
      );
      if (autoReviewResult && !autoReviewResult.ok) {
        return autoReviewResult;
      }
    } catch (err) {
      logger.error("auto-review:failed", {
        listingId: listing.id,
        error: err instanceof Error ? err.message : String(err),
      });

      audit({
        userId,
        action: "LISTING_CREATED",
        entityType: "Listing",
        entityId: listing.id,
        metadata: {
          title: data.title,
          price: data.price,
          autoReviewFailed: true,
        },
        ip,
      });
    }

    return { ok: true, listingId: listing.id };
  }

  // ── saveDraft ─────────────────────────────────────────────────────────────

  async saveDraft(
    userId: string,
    data: SaveDraftInput,
    ip: string,
  ): Promise<DraftResult> {
    // Build the partial field update object for drafts
    const buildDraftFields = () => ({
      ...(data.title != null ? { title: data.title } : {}),
      ...(data.description != null ? { description: data.description } : {}),
      ...(data.price != null ? { priceNzd: Math.round(data.price * 100) } : {}),
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
        ? { shippingNzd: Math.round(data.shippingPrice * 100) }
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
    });

    // Update existing draft
    if (data.draftId) {
      const existing = await listingRepository.findByIdForDraftUpdate(
        data.draftId,
      );
      if (!existing || existing.deletedAt) {
        return { ok: false, error: "Draft not found." };
      }
      if (existing.sellerId !== userId) {
        return { ok: false, error: "Not authorised." };
      }
      if (existing.status !== "DRAFT") {
        return { ok: false, error: "This listing is no longer a draft." };
      }

      await listingRepository.updateListing(
        data.draftId,
        buildDraftFields() as Prisma.ListingUncheckedUpdateInput,
      );

      // Update images if provided
      if (data.imageKeys && data.imageKeys.length > 0) {
        const draftId = data.draftId;
        const keys = data.imageKeys;
        await listingRepository.disconnectDraftImages(draftId);
        for (let i = 0; i < keys.length; i++) {
          await listingRepository.associateImageByKey(keys[i]!, draftId, i);
        }
      }

      return { ok: true, draftId: data.draftId };
    }

    // Create new draft
    const draft = await listingRepository.create({
      sellerId: userId,
      title: data.title || "Untitled Draft",
      description: data.description || "",
      priceNzd: data.price != null ? Math.round(data.price * 100) : 0,
      isGstIncluded: data.isGstIncluded ?? false,
      condition: data.condition ?? "GOOD",
      status: "DRAFT",
      categoryId: data.categoryId || "",
      subcategoryName: data.subcategoryName ?? null,
      region: data.region ?? "Auckland",
      suburb: data.suburb ?? "",
      shippingOption: data.shippingOption ?? "PICKUP",
      shippingNzd:
        data.shippingPrice != null
          ? Math.round(data.shippingPrice * 100)
          : null,
      pickupAddress: data.pickupAddress ?? null,
      isOffersEnabled: data.isOffersEnabled ?? true,
      isUrgent: data.isUrgent ?? false,
      isNegotiable: data.isNegotiable ?? false,
      shipsNationwide: data.shipsNationwide ?? false,
    } as Parameters<typeof listingRepository.create>[0]);

    // Associate images with the draft
    if (data.imageKeys && data.imageKeys.length > 0) {
      const keys = data.imageKeys;
      for (let i = 0; i < keys.length; i++) {
        await listingRepository.associateImageByKey(keys[i]!, draft.id, i);
      }
    }

    audit({
      userId,
      action: "LISTING_CREATED",
      entityType: "Listing",
      entityId: draft.id,
      metadata: { title: data.title },
      ip,
    });

    return { ok: true, draftId: draft.id };
  }

  // ── updateListing ─────────────────────────────────────────────────────────

  async updateListing(
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

    const newPriceNzd =
      data.price != null ? Math.round(data.price * 100) : undefined;
    const priceDropData =
      newPriceNzd != null && newPriceNzd < existing.priceNzd
        ? {
            previousPriceNzd: existing.priceNzd,
            priceDroppedAt: new Date(),
          }
        : {};

    // ── Optimistic lock: include the last-known updatedAt in the WHERE clause.
    // If another request already modified this listing, updateMany returns
    // count=0 and we surface CONCURRENT_MODIFICATION rather than silently
    // overwriting the other writer's changes.
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
          ? { shippingNzd: Math.round(data.shippingPrice * 100) }
          : {}),
        ...(data.pickupAddress !== undefined
          ? { pickupAddress: data.pickupAddress ?? null }
          : {}),
        ...(data.isOffersEnabled != null
          ? { isOffersEnabled: data.isOffersEnabled }
          : {}),
        ...(data.isUrgent != null ? { isUrgent: data.isUrgent } : {}),
        ...(data.isNegotiable != null
          ? { isNegotiable: data.isNegotiable }
          : {}),
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
      // Distinguish concurrent modification (listing still exists) from a
      // race where the listing was deleted between our read and write.
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

        const autoReviewResult = await this.runAutoReviewFlow(
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
          // Check if it got queued (stayed as PENDING_REVIEW)
          const sellerName =
            (await userRepository.findDisplayName(userId)) ?? email;
          const listingTitle = data.title ?? existing.title;
          notificationRepository
            .notifyAdmins(
              {
                type: "SYSTEM",
                title: "Listing resubmitted for review",
                body: `${sellerName} has resubmitted "${listingTitle}" after changes were requested.`,
                link: "/admin/listings",
              },
              ["SUPER_ADMIN", "TRUST_SAFETY_ADMIN"],
            )
            .catch(() => {});
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

          notificationRepository
            .notifyAdmins(
              {
                type: "SYSTEM",
                title: "Listing updated while under review",
                body: `${sellerNameForAdmin} edited their listing "${listingTitleForAdmin}" while it is pending review.`,
                link: "/admin/listings",
              },
              ["SUPER_ADMIN", "TRUST_SAFETY_ADMIN"],
            )
            .catch(() => {});

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
          ]).catch(() => {});

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
      this.notifyPriceDrop(
        listingId,
        existing.sellerId,
        data.title ?? existing.title,
        existing.priceNzd,
        newPriceNzd,
      );
    }

    return { ok: true, listingId };
  }

  // ── getListingForEdit ─────────────────────────────────────────────────────

  async getListingForEdit(listingId: string, userId: string, isAdmin: boolean) {
    const listing = await listingRepository.findByIdForEdit(listingId);

    if (!listing || listing.deletedAt) {
      return { ok: false as const, error: "Listing not found." };
    }
    if (listing.sellerId !== userId && !isAdmin) {
      return {
        ok: false as const,
        error: "You don't have permission to edit this listing.",
      };
    }

    return {
      ok: true as const,
      data: {
        id: listing.id,
        title: listing.title,
        description: listing.description,
        priceNzd: listing.priceNzd,
        isGstIncluded: listing.isGstIncluded,
        condition: listing.condition,
        status: listing.status,
        moderationNote: listing.moderationNote,
        categoryId: listing.categoryId,
        subcategoryName: listing.subcategoryName,
        region: listing.region,
        suburb: listing.suburb,
        shippingOption: listing.shippingOption,
        shippingNzd: listing.shippingNzd,
        isOffersEnabled: listing.isOffersEnabled,
        isUrgent: listing.isUrgent,
        isNegotiable: listing.isNegotiable,
        shipsNationwide: listing.shipsNationwide,
        images: listing.images,
      },
    };
  }

  // ── Private: runAutoReviewFlow ────────────────────────────────────────────

  private async runAutoReviewFlow(
    listingId: string,
    input: Omit<AutoReviewInput, "listingId">,
    userId: string,
    email: string,
    displayName: string | null,
    ip?: string,
  ): Promise<{ ok: false; error: string } | null> {
    const [sellerData, trustMetrics, activeListingCount] = await Promise.all([
      userRepository.findForAutoReview(userId),
      listingRepository.findTrustMetrics(userId),
      listingRepository.countBySeller(userId),
    ]);

    let sellerLevel = "LEVEL_1";
    if (sellerData?.idVerified) sellerLevel = "LEVEL_3";
    else if (sellerData?.isPhoneVerified) sellerLevel = "LEVEL_2";

    const sellerProfile: SellerProfile = {
      id: userId,
      sellerLevel,
      isBanned: sellerData?.isBanned ?? false,
      isFlaggedForFraud: trustMetrics?.isFlaggedForFraud ?? false,
      disputeRate: trustMetrics?.disputeRate ?? 0,
      totalApprovedListings: activeListingCount,
    };

    const autoReviewInput: AutoReviewInput = {
      listingId,
      ...input,
    };

    const reviewResult = await runAutoReview(autoReviewInput, sellerProfile);
    const resolvedDisplayName = displayName ?? sellerData?.displayName ?? email;

    if (reviewResult.verdict === "reject") {
      await listingRepository.updateListing(listingId, {
        status: "REMOVED",
        autoRiskScore: reviewResult.score,
        autoRiskFlags: reviewResult.flags,
        moderationNote: reviewResult.rejectReason ?? null,
        moderatedAt: new Date(),
      });

      audit({
        userId,
        action: "LISTING_AUTO_REJECTED",
        entityType: "Listing",
        entityId: listingId,
        metadata: {
          title: input.title,
          score: reviewResult.score,
          flags: reviewResult.flags,
          reason: reviewResult.rejectReason,
        },
        ip,
      });

      Promise.all([
        createNotification({
          userId,
          type: "LISTING_REJECTED",
          title: "Listing not approved",
          body:
            reviewResult.rejectReason ??
            "Your listing did not pass our review.",
          listingId,
        }),
        sendListingRejectedEmail({
          to: email,
          sellerName: resolvedDisplayName,
          listingTitle: input.title,
          rejectionReason:
            reviewResult.rejectReason ??
            "Your listing did not pass our review.",
        }),
      ]).catch(() => {});

      return {
        ok: false,
        error:
          reviewResult.rejectReason ?? "Your listing could not be published.",
      };
    } else if (reviewResult.verdict === "publish") {
      await listingRepository.updateListing(listingId, {
        status: "ACTIVE",
        autoRiskScore: reviewResult.score,
        autoRiskFlags: reviewResult.flags,
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      audit({
        userId,
        action: "LISTING_APPROVED",
        entityType: "Listing",
        entityId: listingId,
        metadata: {
          title: input.title,
          score: reviewResult.score,
          flags: reviewResult.flags,
          autoApproved: true,
        },
        ip,
      });

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      Promise.all([
        createNotification({
          userId,
          type: "LISTING_APPROVED",
          title: "Your listing is live!",
          body: `"${input.title}" has been approved and is now visible to buyers.`,
          listingId,
        }),
        sendListingApprovedEmail({
          to: email,
          sellerName: resolvedDisplayName,
          listingTitle: input.title,
          listingUrl: `${appUrl}/listings/${listingId}`,
        }),
      ]).catch(() => {});
    } else {
      // verdict === "queue" — keep as PENDING_REVIEW
      await listingRepository.updateListing(listingId, {
        autoRiskScore: reviewResult.score,
        autoRiskFlags: reviewResult.flags,
      });

      audit({
        userId,
        action: "LISTING_CREATED",
        entityType: "Listing",
        entityId: listingId,
        metadata: {
          title: input.title,
          score: reviewResult.score,
          flags: reviewResult.flags,
          queued: true,
        },
        ip,
      });

      createNotification({
        userId,
        type: "LISTING_UNDER_REVIEW",
        title: "Listing under review",
        body: "Your listing has been submitted and is under review. We'll notify you once it's approved.",
        listingId,
      }).catch(() => {});
    }

    return null; // success — no error
  }

  // ── Private: notifyPriceDrop ──────────────────────────────────────────────

  private notifyPriceDrop(
    listingId: string,
    sellerId: string,
    listingTitle: string,
    oldPriceNzd: number,
    newPriceNzd: number,
  ) {
    const priceDrop = Math.round(
      ((oldPriceNzd - newPriceNzd) / oldPriceNzd) * 100,
    );
    const newPriceFormatted = `$${(newPriceNzd / 100).toFixed(2)}`;
    const oldPriceFormatted = `$${(oldPriceNzd / 100).toFixed(2)}`;
    const savings = `$${((oldPriceNzd - newPriceNzd) / 100).toFixed(2)}`;

    listingRepository
      .findWatchersWithPriceAlert(listingId)
      .then(async (watchers) => {
        const promises: Promise<unknown>[] = [];
        for (const watcher of watchers) {
          if (watcher.userId === sellerId) continue;

          promises.push(
            createNotification({
              userId: watcher.userId,
              type: "PRICE_DROP",
              title: `Price dropped ${priceDrop}%! 📉`,
              body: `"${listingTitle}" dropped from ${oldPriceFormatted} to ${newPriceFormatted} — ${savings} savings!`,
              listingId,
              link: `/listings/${listingId}`,
            }),
          );

          if (watcher.user?.email) {
            promises.push(
              sendPriceDropEmail({
                to: watcher.user.email,
                buyerName: watcher.user.displayName ?? "there",
                listingTitle,
                oldPrice: oldPriceFormatted,
                newPrice: newPriceFormatted,
                savings,
                dropPercent: priceDrop,
                listingUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://kiwimart.co.nz"}/listings/${listingId}`,
              }),
            );
          }
        }

        const results = await Promise.allSettled(promises);
        const failures = results.filter((r) => r.status === "rejected");
        if (failures.length > 0) {
          logger.warn("Some price drop notifications failed", {
            listingId,
            totalSent: promises.length,
            failures: failures.length,
          });
        }
      })
      .catch((err) => {
        logger.error("Failed to send price drop notifications", {
          listingId,
          err,
        });
      });
  }
}

export const listingService = new ListingService();
