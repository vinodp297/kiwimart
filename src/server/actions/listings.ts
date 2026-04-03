"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/listings.ts
// ─── Listing Server Actions ───────────────────────────────────────────────────

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { userRepository } from "@/modules/users/user.repository";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { audit } from "@/server/lib/audit";
import { requireUser } from "@/server/lib/requireUser";
import { listingService } from "@/modules/listings/listing.service";
import { createNotification } from "@/modules/notifications/notification.service";
import {
  sendPriceDropEmail,
  sendListingApprovedEmail,
  sendListingRejectedEmail,
} from "@/server/email";
import { logger } from "@/shared/logger";
import {
  createListingSchema,
  updateListingSchema,
  toggleWatchSchema,
  saveDraftSchema,
} from "@/server/validators";
import {
  runAutoReview,
  type AutoReviewInput,
  type SellerProfile,
} from "@/server/services/listing-review/auto-review.service";
import { getKeywordLists } from "@/lib/dynamic-lists";
import type { ActionResult, ListingCard } from "@/types";

// ── createListing ─────────────────────────────────────────────────────────────

export async function createListing(
  raw: unknown,
): Promise<ActionResult<{ listingId: string; slug: string }>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);

  // 1. Authenticate + ban check (fresh DB lookup every call)
  let authedUser;
  try {
    authedUser = await requireUser();
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Authentication required."),
    };
  }

  // 2. Authorise — check email verified, seller terms accepted, stripe onboarded
  // Note: requireUser() already hits the DB but doesn't return these fields.
  // A future optimisation would be to include them in the requireUser() select.
  const userDetails = await userRepository.findForListingAuth(authedUser.id);
  if (!userDetails?.emailVerified) {
    return {
      success: false,
      error: "Please verify your email address before creating a listing.",
      reason: "email_not_verified",
    };
  }
  if (!userDetails.sellerTermsAcceptedAt) {
    return {
      success: false,
      error:
        "Please accept seller terms before listing items. Go to Seller Hub to accept.",
    };
  }
  if (!authedUser.stripeOnboarded) {
    return {
      success: false,
      error: "Please set up your payment account before listing items.",
    };
  }

  // 3. Validate
  const parsed = createListingSchema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    // Debug: log exact validation failures so we can diagnose in Vercel logs
    logger.error("listing:validation-failed", {
      fieldErrors: flat.fieldErrors,
      formErrors: flat.formErrors,
      rawInput: JSON.stringify(raw).slice(0, 2000),
    });

    // Build a user-friendly summary of what went wrong
    const fieldMessages: string[] = [];
    for (const [field, msgs] of Object.entries(flat.fieldErrors)) {
      const msg = (msgs as string[])?.[0];
      if (msg) fieldMessages.push(`${field}: ${msg}`);
    }
    const summary =
      fieldMessages.length > 0
        ? `Please fix ${fieldMessages.length} issue${fieldMessages.length > 1 ? "s" : ""}: ${fieldMessages.join("; ")}`
        : "Please fix the errors in your listing and try again.";

    return {
      success: false,
      error: summary,
      fieldErrors: flat.fieldErrors,
    };
  }
  const data = parsed.data;

  // 4. Rate limit — 10 listings per hour per user
  const limit = await rateLimit("listing", authedUser.id);
  if (!limit.success) {
    return {
      success: false,
      error: `Too many listings created. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  // 5a. Validate category exists
  const category = await db.category.findUnique({
    where: { id: data.categoryId },
    select: { id: true },
  });
  if (!category) {
    return {
      success: false,
      error: "Invalid category.",
      fieldErrors: { categoryId: ["Invalid category"] },
    };
  }

  // 5b. Validate image keys exist and are safe (scanned in image upload action)
  // This is a safety net — images should already be verified in Step 1.
  const images = await db.listingImage.findMany({
    where: { r2Key: { in: data.imageKeys } },
    select: { id: true, r2Key: true, scanned: true, safe: true },
  });
  const missingKeys = data.imageKeys.filter(
    (key) => !images.some((img) => img.r2Key === key),
  );
  const unsafeImages = images.filter((img) => !img.scanned || !img.safe);
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
        scanned: i.scanned,
        safe: i.safe,
      })),
      totalExpected: data.imageKeys.length,
      totalFound: images.length,
    });
    return {
      success: false,
      error: `There's an issue with your photos: ${issues.join(" and ")}. Please go back to Step 1 and re-upload them.`,
      fieldErrors: { imageKeys: [`${issues.join("; ")}`] },
    };
  }

  // 5c. Create listing in a transaction
  const listing = await db.$transaction(async (tx) => {
    const created = await tx.listing.create({
      data: {
        sellerId: authedUser.id,
        title: data.title,
        description: data.description,
        priceNzd: Math.round(data.price * 100), // Convert dollars → cents
        gstIncluded: data.gstIncluded,
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
        offersEnabled: data.offersEnabled,
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
      },
      select: { id: true },
    });

    // Enable seller if this is their first listing
    if (!userDetails.sellerEnabled) {
      await tx.user.update({
        where: { id: authedUser.id },
        data: { sellerEnabled: true },
      });
    }

    return created;
  });

  // 5d. Record initial price history point
  db.listingPriceHistory
    .create({
      data: { listingId: listing.id, priceNzd: Math.round(data.price * 100) },
    })
    .catch(() => {});

  // 6. Auto-review the listing
  const priceNzd = Math.round(data.price * 100);
  try {
    // Fetch seller profile for auto-review
    const [sellerData, trustMetrics, activeListingCount] = await Promise.all([
      userRepository.findForAutoReview(authedUser.id),
      db.trustMetrics.findUnique({
        where: { userId: authedUser.id },
        select: { isFlaggedForFraud: true, disputeRate: true },
      }),
      db.listing.count({
        where: { sellerId: authedUser.id, status: "ACTIVE", deletedAt: null },
      }),
    ]);

    // Determine seller level from verification status
    let sellerLevel = "LEVEL_1"; // basic
    if (sellerData?.idVerified) sellerLevel = "LEVEL_3";
    else if (sellerData?.phoneVerified) sellerLevel = "LEVEL_2";

    const sellerProfile: SellerProfile = {
      id: authedUser.id,
      sellerLevel,
      isBanned: sellerData?.isBanned ?? false,
      isFlaggedForFraud: trustMetrics?.isFlaggedForFraud ?? false,
      disputeRate: trustMetrics?.disputeRate ?? 0,
      totalApprovedListings: activeListingCount,
    };

    const autoReviewInput: AutoReviewInput = {
      listingId: listing.id,
      title: data.title,
      description: data.description,
      priceNzd,
      categoryId: data.categoryId,
      images: images.map((img) => ({ safe: img.safe })),
    };

    const reviewResult = await runAutoReview(autoReviewInput, sellerProfile);

    // Update listing based on verdict
    if (reviewResult.verdict === "reject") {
      await db.listing.update({
        where: { id: listing.id },
        data: {
          status: "REMOVED",
          autoRiskScore: reviewResult.score,
          autoRiskFlags: reviewResult.flags,
          moderationNote: reviewResult.rejectReason ?? null,
          moderatedAt: new Date(),
        },
      });

      audit({
        userId: authedUser.id,
        action: "LISTING_AUTO_REJECTED",
        entityType: "Listing",
        entityId: listing.id,
        metadata: {
          title: data.title,
          score: reviewResult.score,
          flags: reviewResult.flags,
          reason: reviewResult.rejectReason,
        },
        ip,
      });

      // Notify seller of rejection
      Promise.all([
        createNotification({
          userId: authedUser.id,
          type: "LISTING_REJECTED",
          title: "Listing not approved",
          body:
            reviewResult.rejectReason ??
            "Your listing did not pass our review.",
          listingId: listing.id,
        }),
        sendListingRejectedEmail({
          to: authedUser.email,
          sellerName: userDetails?.displayName ?? authedUser.email,
          listingTitle: data.title,
          rejectionReason:
            reviewResult.rejectReason ??
            "Your listing did not pass our review.",
        }),
      ]).catch(() => {});

      return {
        success: false,
        error:
          reviewResult.rejectReason ?? "Your listing could not be published.",
      };
    } else if (reviewResult.verdict === "publish") {
      await db.listing.update({
        where: { id: listing.id },
        data: {
          status: "ACTIVE",
          autoRiskScore: reviewResult.score,
          autoRiskFlags: reviewResult.flags,
          publishedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      audit({
        userId: authedUser.id,
        action: "LISTING_APPROVED",
        entityType: "Listing",
        entityId: listing.id,
        metadata: {
          title: data.title,
          score: reviewResult.score,
          flags: reviewResult.flags,
          autoApproved: true,
        },
        ip,
      });

      // Notify seller that listing is now live
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      Promise.all([
        createNotification({
          userId: authedUser.id,
          type: "LISTING_APPROVED",
          title: "Your listing is live!",
          body: `"${data.title}" has been approved and is now visible to buyers.`,
          listingId: listing.id,
        }),
        sendListingApprovedEmail({
          to: authedUser.email,
          sellerName: userDetails?.displayName ?? authedUser.email,
          listingTitle: data.title,
          listingUrl: `${appUrl}/listings/${listing.id}`,
        }),
      ]).catch(() => {});
    } else {
      // verdict === "queue" — keep as PENDING_REVIEW
      await db.listing.update({
        where: { id: listing.id },
        data: {
          autoRiskScore: reviewResult.score,
          autoRiskFlags: reviewResult.flags,
        },
      });

      audit({
        userId: authedUser.id,
        action: "LISTING_CREATED",
        entityType: "Listing",
        entityId: listing.id,
        metadata: {
          title: data.title,
          score: reviewResult.score,
          flags: reviewResult.flags,
          queued: true,
        },
        ip,
      });

      // Notify seller that listing is under review
      createNotification({
        userId: authedUser.id,
        type: "LISTING_UNDER_REVIEW",
        title: "Listing under review",
        body: "Your listing has been submitted and is under review. We'll notify you once it's approved.",
        listingId: listing.id,
      }).catch(() => {});
    }
  } catch (err) {
    // If auto-review fails, keep listing as PENDING_REVIEW for manual review
    logger.error("auto-review:failed", {
      listingId: listing.id,
      error: err instanceof Error ? err.message : String(err),
    });

    audit({
      userId: authedUser.id,
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

  // 7. Revalidate affected cache paths
  revalidatePath("/");
  revalidatePath("/search");

  return {
    success: true,
    data: { listingId: listing.id, slug: listing.id },
  };
}

// ── saveDraft ─────────────────────────────────────────────────────────────────
// Saves a partial listing as a DRAFT. All fields are optional — the seller
// can save at any point in the wizard and come back later.
// If draftId is provided, updates the existing draft. Otherwise creates new.

export async function saveDraft(
  raw: unknown,
): Promise<ActionResult<{ draftId: string }>> {
  try {
    const user = await requireUser();

    const parsed = saveDraftSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          "We couldn't save your draft. Please check your entries and try again.",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }
    const data = parsed.data;

    // Rate limit
    const limit = await rateLimit("listing", user.id);
    if (!limit.success) {
      return {
        success: false,
        error: `Too many saves. Try again in ${limit.retryAfter} seconds.`,
      };
    }

    // If updating an existing draft, verify ownership
    if (data.draftId) {
      const existing = await db.listing.findUnique({
        where: { id: data.draftId },
        select: { sellerId: true, status: true, deletedAt: true },
      });
      if (!existing || existing.deletedAt) {
        return { success: false, error: "Draft not found." };
      }
      if (existing.sellerId !== user.id) {
        return { success: false, error: "Not authorised." };
      }
      if (existing.status !== "DRAFT") {
        return {
          success: false,
          error: "This listing is no longer a draft.",
        };
      }

      // Update existing draft
      await db.listing.update({
        where: { id: data.draftId },
        data: {
          ...(data.title != null ? { title: data.title } : {}),
          ...(data.description != null
            ? { description: data.description }
            : {}),
          ...(data.price != null
            ? { priceNzd: Math.round(data.price * 100) }
            : {}),
          ...(data.gstIncluded != null
            ? { gstIncluded: data.gstIncluded }
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
          ...(data.offersEnabled != null
            ? { offersEnabled: data.offersEnabled }
            : {}),
          ...(data.isUrgent != null ? { isUrgent: data.isUrgent } : {}),
          ...(data.isNegotiable != null
            ? { isNegotiable: data.isNegotiable }
            : {}),
          ...(data.shipsNationwide != null
            ? { shipsNationwide: data.shipsNationwide }
            : {}),
        },
      });

      // Update images if provided
      if (data.imageKeys && data.imageKeys.length > 0) {
        // Disconnect existing images and reconnect with new order
        await db.listingImage.updateMany({
          where: { listingId: data.draftId },
          data: { listingId: null },
        });
        for (let i = 0; i < data.imageKeys.length; i++) {
          await db.listingImage.updateMany({
            where: { r2Key: data.imageKeys[i] },
            data: { listingId: data.draftId, order: i },
          });
        }
      }

      revalidatePath("/dashboard/seller");
      return { success: true, data: { draftId: data.draftId } };
    }

    // Create new draft — use defaults for required DB fields
    const draft = await db.listing.create({
      data: {
        sellerId: user.id,
        title: data.title || "Untitled Draft",
        description: data.description || "",
        priceNzd: data.price != null ? Math.round(data.price * 100) : 0,
        gstIncluded: data.gstIncluded ?? false,
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
        offersEnabled: data.offersEnabled ?? true,
        isUrgent: data.isUrgent ?? false,
        isNegotiable: data.isNegotiable ?? false,
        shipsNationwide: data.shipsNationwide ?? false,
      },
      select: { id: true },
    });

    // Associate images with the draft
    if (data.imageKeys && data.imageKeys.length > 0) {
      for (let i = 0; i < data.imageKeys.length; i++) {
        await db.listingImage.updateMany({
          where: { r2Key: data.imageKeys[i] },
          data: { listingId: draft.id, order: i },
        });
      }
    }

    // Audit (fire-and-forget)
    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);
    audit({
      userId: user.id,
      action: "LISTING_CREATED",
      entityType: "Listing",
      entityId: draft.id,
      metadata: { title: data.title },
      ip,
    });

    revalidatePath("/dashboard/seller");
    return { success: true, data: { draftId: draft.id } };
  } catch (err) {
    logger.error("listing:save-draft-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't save your draft. Please check your connection and try again.",
      ),
    };
  }
}

// ── updateListing ─────────────────────────────────────────────────────────────
// Updates a listing. If the price decreases, records previousPriceNzd and
// priceDroppedAt for the Price Dropped badge in ListingCard.

export async function updateListing(
  raw: unknown,
): Promise<ActionResult<{ listingId: string }>> {
  const user = await requireUser();
  const parsed = updateListingSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors in your listing and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const data = parsed.data;
  const { listingId } = data;

  // Load current listing to check ownership + existing price
  const existing = await db.listing.findUnique({
    where: { id: listingId },
    select: {
      sellerId: true,
      priceNzd: true,
      deletedAt: true,
      title: true,
      description: true,
      categoryId: true,
      status: true,
    },
  });

  if (!existing || existing.deletedAt) {
    return { success: false, error: "Listing not found." };
  }
  if (existing.sellerId !== user.id && !user.isAdmin) {
    return { success: false, error: "Not authorised." };
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

  await db.listing.update({
    where: { id: listingId },
    data: {
      ...(data.title != null ? { title: data.title } : {}),
      ...(data.description != null ? { description: data.description } : {}),
      ...(newPriceNzd != null ? { priceNzd: newPriceNzd } : {}),
      ...(data.gstIncluded != null ? { gstIncluded: data.gstIncluded } : {}),
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
      ...(data.offersEnabled != null
        ? { offersEnabled: data.offersEnabled }
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
    },
  });

  // If resubmitting from NEEDS_CHANGES, re-run auto-review
  if (existing.status === "NEEDS_CHANGES") {
    try {
      const [sellerData, trustMetrics, activeListingCount] = await Promise.all([
        userRepository.findForAutoReview(user.id),
        db.trustMetrics.findUnique({
          where: { userId: user.id },
          select: { isFlaggedForFraud: true, disputeRate: true },
        }),
        db.listing.count({
          where: { sellerId: user.id, status: "ACTIVE", deletedAt: null },
        }),
      ]);

      let sellerLevel = "LEVEL_1";
      if (sellerData?.idVerified) sellerLevel = "LEVEL_3";
      else if (sellerData?.phoneVerified) sellerLevel = "LEVEL_2";

      const listingImages = await db.listingImage.findMany({
        where: { listingId },
        select: { safe: true },
      });

      const reviewResult = await runAutoReview(
        {
          listingId,
          title: data.title ?? existing.title,
          description: data.description ?? existing.description,
          priceNzd: newPriceNzd ?? existing.priceNzd,
          categoryId: data.categoryId ?? existing.categoryId,
          images: listingImages.map((img) => ({ safe: img.safe })),
        },
        {
          id: user.id,
          sellerLevel,
          isBanned: sellerData?.isBanned ?? false,
          isFlaggedForFraud: trustMetrics?.isFlaggedForFraud ?? false,
          disputeRate: trustMetrics?.disputeRate ?? 0,
          totalApprovedListings: activeListingCount,
        },
      );

      await db.listing.update({
        where: { id: listingId },
        data: {
          autoRiskScore: reviewResult.score,
          autoRiskFlags: reviewResult.flags,
          ...(reviewResult.verdict === "publish"
            ? {
                status: "ACTIVE",
                publishedAt: new Date(),
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              }
            : reviewResult.verdict === "reject"
              ? { status: "REMOVED", moderationNote: reviewResult.rejectReason }
              : {}),
        },
      });

      if (reviewResult.verdict === "reject") {
        createNotification({
          userId: user.id,
          type: "LISTING_REJECTED",
          title: "Listing not approved",
          body:
            reviewResult.rejectReason ??
            "Your listing did not pass our review.",
          listingId,
        }).catch(() => {});
        return {
          success: false,
          error:
            reviewResult.rejectReason ?? "Your listing could not be published.",
        };
      }

      if (reviewResult.verdict === "queue") {
        createNotification({
          userId: user.id,
          type: "LISTING_UNDER_REVIEW",
          title: "Listing resubmitted for review",
          body: "Your updated listing is under review. We'll notify you once it's approved.",
          listingId,
        }).catch(() => {});
      }

      // P1-2: Notify admins of the resubmission (fire-and-forget)
      // Only notify when listing is queued for manual review (not auto-published)
      if (reviewResult.verdict === "queue") {
        const listingTitleForAdmin = data.title ?? existing.title;
        const sellerNameForAdmin = sellerData?.displayName ?? user.email;
        userRepository
          .findAdmins(["SUPER_ADMIN", "TRUST_SAFETY_ADMIN"])
          .then((admins) => {
            const notifications = admins.map((admin) =>
              createNotification({
                userId: admin.id,
                type: "SYSTEM",
                title: "Listing resubmitted for review",
                body: `${sellerNameForAdmin} has resubmitted "${listingTitleForAdmin}" after changes were requested.`,
                link: "/admin/listings",
              }),
            );
            return Promise.allSettled(notifications);
          })
          .catch(() => {});
      }
    } catch (err) {
      logger.error("auto-review:resubmit-failed", {
        listingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    revalidatePath(`/listings/${listingId}`);
    revalidatePath("/dashboard/seller");
    revalidatePath("/admin/listings");
    return { success: true, data: { listingId } };
  }

  // Keyword scan for ACTIVE and PENDING_REVIEW listings edited outside the NEEDS_CHANGES flow.
  // A seller could bypass content policy by editing a live or queued listing post-approval.
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
          (await userRepository.findDisplayName(user.id)) ?? user.email;
        const listingTitleForAdmin = data.title ?? existing.title;

        userRepository
          .findAdmins(["SUPER_ADMIN", "TRUST_SAFETY_ADMIN"])
          .then((admins) =>
            Promise.allSettled(
              admins.map((admin) =>
                createNotification({
                  userId: admin.id,
                  type: "SYSTEM",
                  title: "Listing updated while under review",
                  body: `${sellerNameForAdmin} edited their listing "${listingTitleForAdmin}" while it is pending review.`,
                  link: "/admin/listings",
                }),
              ),
            ),
          )
          .catch(() => {});

        audit({
          userId: user.id,
          action: "LISTING_EDITED_WHILE_PENDING",
          entityType: "Listing",
          entityId: listingId,
          metadata: {
            listingId,
            sellerId: user.id,
            previousStatus: existing.status,
          },
        });
      }

      if (foundKeyword) {
        const moderationNote =
          "Listing removed: prohibited content detected after edit.";
        await db.listing.update({
          where: { id: listingId },
          data: { status: "REMOVED", moderationNote },
        });

        const sellerInfo = await userRepository.findEmailInfo(user.id);

        const listingTitle = data.title ?? existing.title;
        Promise.all([
          createNotification({
            userId: user.id,
            type: "LISTING_REJECTED",
            title: "Listing removed",
            body: moderationNote,
            listingId,
          }),
          sendListingRejectedEmail({
            to: user.email,
            sellerName: sellerInfo?.displayName ?? user.email,
            listingTitle,
            rejectionReason: moderationNote,
          }),
        ]).catch(() => {});

        audit({
          userId: user.id,
          action: "LISTING_REMOVED_POST_EDIT",
          entityType: "Listing",
          entityId: listingId,
          metadata: {
            listingId,
            detectedKeyword: foundKeyword,
            previousStatus: existing.status,
          },
        });

        revalidatePath(`/listings/${listingId}`);
        revalidatePath("/dashboard/seller");
        return {
          success: false,
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

  // Price history tracking + notify watchlist users of price drop (fire-and-forget)
  if (newPriceNzd != null && newPriceNzd !== existing.priceNzd) {
    // Record price change in history
    db.listingPriceHistory
      .create({
        data: { listingId, priceNzd: newPriceNzd },
      })
      .catch(() => {});
  }

  if (newPriceNzd != null && newPriceNzd < existing.priceNzd) {
    const listingTitle = data.title ?? existing.title;
    const priceDrop = Math.round(
      ((existing.priceNzd - newPriceNzd) / existing.priceNzd) * 100,
    );
    const newPriceFormatted = `$${(newPriceNzd / 100).toFixed(2)}`;
    const oldPriceFormatted = `$${(existing.priceNzd / 100).toFixed(2)}`;
    const savings = `$${((existing.priceNzd - newPriceNzd) / 100).toFixed(2)}`;

    db.watchlistItem
      .findMany({
        where: { listingId, priceAlertEnabled: true },
        select: {
          userId: true,
          user: { select: { email: true, displayName: true } },
        },
      })
      .then(async (watchers) => {
        const promises: Promise<unknown>[] = [];
        for (const watcher of watchers) {
          if (watcher.userId === existing.sellerId) continue;

          // In-app notification
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

          // Email notification
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

  revalidatePath(`/listings/${listingId}`);
  revalidatePath("/dashboard/seller");
  revalidatePath("/search");

  return { success: true, data: { listingId } };
}

// ── deleteListing ─────────────────────────────────────────────────────────────

export async function deleteListing(
  listingId: string,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    await listingService.deleteListing(listingId, user.id, user.isAdmin);
    revalidatePath("/dashboard/seller");
    revalidatePath("/search");
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't delete this listing. Please try again.",
      ),
    };
  }
}

// ── toggleWatch ───────────────────────────────────────────────────────────────

export async function toggleWatch(
  raw: unknown,
): Promise<ActionResult<{ watching: boolean }>> {
  try {
    const user = await requireUser();
    const parsed = toggleWatchSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: "This listing could not be found. It may have been removed.",
      };
    }
    const result = await listingService.toggleWatch(
      parsed.data.listingId,
      user.id,
    );
    return { success: true, data: result };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't update your watchlist. Please try again.",
      ),
    };
  }
}

// ── getListingForEdit ─────────────────────────────────────────────────────────
// Fetches listing data pre-populated for the edit form.
// Only the listing owner (or admin) can access.

export async function getListingForEdit(listingId: string): Promise<
  ActionResult<{
    id: string;
    title: string;
    description: string;
    priceNzd: number;
    gstIncluded: boolean;
    condition: string;
    status: string;
    moderationNote: string | null;
    categoryId: string;
    subcategoryName: string | null;
    region: string;
    suburb: string;
    shippingOption: string;
    shippingNzd: number | null;
    offersEnabled: boolean;
    isUrgent: boolean;
    isNegotiable: boolean;
    shipsNationwide: boolean;
    images: {
      id: string;
      r2Key: string;
      thumbnailKey: string | null;
      order: number;
    }[];
  }>
> {
  try {
    const user = await requireUser();

    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        sellerId: true,
        title: true,
        description: true,
        priceNzd: true,
        gstIncluded: true,
        condition: true,
        status: true,
        moderationNote: true,
        categoryId: true,
        subcategoryName: true,
        region: true,
        suburb: true,
        shippingOption: true,
        shippingNzd: true,
        offersEnabled: true,
        isUrgent: true,
        isNegotiable: true,
        shipsNationwide: true,
        deletedAt: true,
        images: {
          orderBy: { order: "asc" },
          select: { id: true, r2Key: true, thumbnailKey: true, order: true },
        },
      },
    });

    if (!listing || listing.deletedAt) {
      return { success: false, error: "Listing not found." };
    }
    if (listing.sellerId !== user.id && !user.isAdmin) {
      return {
        success: false,
        error: "You don't have permission to edit this listing.",
      };
    }

    return {
      success: true,
      data: {
        id: listing.id,
        title: listing.title,
        description: listing.description,
        priceNzd: listing.priceNzd,
        gstIncluded: listing.gstIncluded,
        condition: listing.condition,
        status: listing.status,
        moderationNote: listing.moderationNote,
        categoryId: listing.categoryId,
        subcategoryName: listing.subcategoryName,
        region: listing.region,
        suburb: listing.suburb,
        shippingOption: listing.shippingOption,
        shippingNzd: listing.shippingNzd,
        offersEnabled: listing.offersEnabled,
        isUrgent: listing.isUrgent,
        isNegotiable: listing.isNegotiable,
        shipsNationwide: listing.shipsNationwide,
        images: listing.images,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't load this listing for editing. Please try again.",
      ),
    };
  }
}

// ── getListingById ────────────────────────────────────────────────────────────
// Public server function — delegated to ListingService

export async function getListingById(id: string) {
  return listingService.getListingById(id);
}
