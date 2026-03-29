"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/listings.ts
// ─── Listing Server Actions ───────────────────────────────────────────────────

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { audit } from "@/server/lib/audit";
import { requireUser } from "@/server/lib/requireUser";
import { listingService } from "@/modules/listings/listing.service";
import { createNotification } from "@/modules/notifications/notification.service";
import { sendPriceDropEmail } from "@/server/email";
import { logger } from "@/shared/logger";
import {
  createListingSchema,
  updateListingSchema,
  toggleWatchSchema,
  saveDraftSchema,
} from "@/server/validators";
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
  const userDetails = await db.user.findUnique({
    where: { id: authedUser.id },
    select: {
      emailVerified: true,
      sellerEnabled: true,
      sellerTermsAcceptedAt: true,
    },
  });
  if (!userDetails?.emailVerified) {
    return {
      success: false,
      error: "Please verify your email address before creating a listing.",
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
        status: "ACTIVE",
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
        publishedAt: new Date(),
        // Expire after 30 days
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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

  // 6. Audit (fire-and-forget)
  audit({
    userId: authedUser.id,
    action: "LISTING_CREATED",
    entityType: "Listing",
    entityId: listing.id,
    metadata: { title: data.title, price: data.price },
    ip,
  });

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
    select: { sellerId: true, priceNzd: true, deletedAt: true, title: true },
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
    },
  });

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

// ── getListingById ────────────────────────────────────────────────────────────
// Public server function — delegated to ListingService

export async function getListingById(id: string) {
  return listingService.getListingById(id);
}
