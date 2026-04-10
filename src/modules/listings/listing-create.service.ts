// src/modules/listings/listing-create.service.ts
// ─── Listing creation and draft management ──────────────────────────────────

import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { userRepository } from "@/modules/users/user.repository";
import { toCents } from "@/lib/currency";
import { listingRepository } from "./listing.repository";
import { runAutoReviewFlow } from "./listing-review.service";
import type { Prisma } from "@prisma/client";

// ── Types ───────────────────────────────────────────────────────────────────

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

export type CreateResult =
  | { ok: true; listingId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type DraftResult =
  | { ok: true; draftId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

// ── Shared validation core (Fix 2 — shared orchestration) ──────────────────
// Both createListing and createListingViaApi use this to avoid duplicating
// auth checks, category validation, image validation, and the DB transaction.

interface CoreCreateResult {
  ok: true;
  listingId: string;
  priceNzd: number;
  images: { isSafe: boolean }[];
  userDetails: {
    displayName: string;
    isSellerEnabled: boolean;
  };
}

interface CoreCreateError {
  ok: false;
  error: string;
  code?: string;
  statusCode?: number;
  fieldErrors?: Record<string, string[]>;
}

async function validateAndCreateListing(
  userId: string,
  isStripeOnboarded: boolean,
  data: CreateListingInput,
  _ip: string,
): Promise<CoreCreateResult | CoreCreateError> {
  // 1. Auth checks
  const userDetails = await userRepository.findForListingAuth(userId);
  if (!userDetails?.emailVerified) {
    return {
      ok: false,
      error: "Please verify your email address before creating a listing.",
      code: "EMAIL_NOT_VERIFIED",
      statusCode: 403,
    };
  }
  if (!userDetails.sellerTermsAcceptedAt) {
    return {
      ok: false,
      error:
        "Please accept seller terms before listing items. Go to Seller Hub to accept.",
      code: "TERMS_NOT_ACCEPTED",
      statusCode: 403,
    };
  }
  if (!isStripeOnboarded) {
    return {
      ok: false,
      error: "Please set up your payment account before listing items.",
      code: "STRIPE_NOT_ONBOARDED",
      statusCode: 403,
    };
  }

  // 2. Validate category
  const category = await listingRepository.findCategoryById(data.categoryId);
  if (!category) {
    return {
      ok: false,
      error: "Invalid category.",
      code: "INVALID_CATEGORY",
      statusCode: 400,
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
      code: "IMAGE_VALIDATION_FAILED",
      statusCode: 400,
      fieldErrors: { imageKeys: [`${issues.join("; ")}`] },
    };
  }

  // 4. Create listing in a transaction
  const priceNzd = toCents(data.price);
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
          data.shippingPrice != null ? toCents(data.shippingPrice) : null,
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

  return {
    ok: true,
    listingId: listing.id,
    priceNzd,
    images: images.map((img) => ({ isSafe: img.isSafe })),
    userDetails: {
      displayName: userDetails.displayName,
      isSellerEnabled: userDetails.isSellerEnabled,
    },
  };
}

// ── createListing ───────────────────────────────────────────────────────────

export async function createListing(
  userId: string,
  email: string,
  isStripeOnboarded: boolean,
  data: CreateListingInput,
  ip: string,
): Promise<CreateResult> {
  const coreResult = await validateAndCreateListing(
    userId,
    isStripeOnboarded,
    data,
    ip,
  );

  if (!coreResult.ok) {
    return {
      ok: false,
      error: coreResult.error,
      ...(coreResult.fieldErrors
        ? { fieldErrors: coreResult.fieldErrors }
        : {}),
    };
  }

  // Auto-review the listing
  try {
    const autoReviewResult = await runAutoReviewFlow(
      coreResult.listingId,
      {
        title: data.title,
        description: data.description,
        priceNzd: coreResult.priceNzd,
        categoryId: data.categoryId,
        images: coreResult.images,
      },
      userId,
      email,
      coreResult.userDetails.displayName,
      ip,
    );
    if (autoReviewResult && !autoReviewResult.ok) {
      return autoReviewResult;
    }
  } catch (err) {
    logger.error("auto-review:failed", {
      listingId: coreResult.listingId,
      error: err instanceof Error ? err.message : String(err),
    });

    audit({
      userId,
      action: "LISTING_CREATED",
      entityType: "Listing",
      entityId: coreResult.listingId,
      metadata: {
        title: data.title,
        price: data.price,
        autoReviewFailed: true,
      },
      ip,
    });
  }

  return { ok: true, listingId: coreResult.listingId };
}

// ── createListingViaApi ─────────────────────────────────────────────────────
// Like createListing but skips auto-review and returns { listing: { id, status } }.

export async function createListingViaApi(
  userId: string,
  isStripeOnboarded: boolean,
  data: CreateListingInput,
  ip: string,
): Promise<
  | { ok: true; listing: { id: string; status: string } }
  | { ok: false; error: string; code: string; statusCode: number }
> {
  const coreResult = await validateAndCreateListing(
    userId,
    isStripeOnboarded,
    data,
    ip,
  );

  if (!coreResult.ok) {
    return {
      ok: false,
      error: coreResult.error,
      code: coreResult.code ?? "VALIDATION_FAILED",
      statusCode: coreResult.statusCode ?? 400,
    };
  }

  // Audit + log (no auto-review for API path)
  audit({
    userId,
    action: "LISTING_CREATED",
    entityType: "Listing",
    entityId: coreResult.listingId,
    metadata: { title: data.title, channel: "api" },
    ip,
  });

  logger.info("listing.created.api", {
    listingId: coreResult.listingId,
    userId,
  });

  return {
    ok: true,
    listing: { id: coreResult.listingId, status: "PENDING_REVIEW" },
  };
}

// ── saveDraft ───────────────────────────────────────────────────────────────

export async function saveDraft(
  userId: string,
  data: SaveDraftInput,
  ip: string,
): Promise<DraftResult> {
  // Build the partial field update object for drafts
  const buildDraftFields = () => ({
    ...(data.title != null ? { title: data.title } : {}),
    ...(data.description != null ? { description: data.description } : {}),
    ...(data.price != null ? { priceNzd: toCents(data.price) } : {}),
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
    priceNzd: data.price != null ? toCents(data.price) : 0,
    isGstIncluded: data.isGstIncluded ?? false,
    condition: data.condition ?? "GOOD",
    status: "DRAFT",
    categoryId: data.categoryId || "",
    subcategoryName: data.subcategoryName ?? null,
    region: data.region ?? "Auckland",
    suburb: data.suburb ?? "",
    shippingOption: data.shippingOption ?? "PICKUP",
    shippingNzd:
      data.shippingPrice != null ? toCents(data.shippingPrice) : null,
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
