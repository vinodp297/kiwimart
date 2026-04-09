"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/listings.ts
// ─── Listing Server Actions ───────────────────────────────────────────────────

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { requireUser } from "@/server/lib/requireUser";
import { listingService } from "@/modules/listings/listing.service";
import { logger } from "@/shared/logger";
import {
  createListingSchema,
  updateListingSchema,
  toggleWatchSchema,
  saveDraftSchema,
} from "@/server/validators";
import type { ActionResult } from "@/types";
import { withActionContext } from "@/lib/action-context";

// ── createListing ─────────────────────────────────────────────────────────────

export async function createListing(
  raw: unknown,
): Promise<ActionResult<{ listingId: string; slug: string }>> {
  return withActionContext(async () => {
    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);

    let authedUser;
    try {
      authedUser = await requireUser();
    } catch (err) {
      return {
        success: false,
        error: safeActionError(err, "Authentication required."),
      };
    }

    // Validate input
    const parsed = createListingSchema.safeParse(raw);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      logger.error("listing:validation-failed", {
        fieldErrors: flat.fieldErrors,
        formErrors: flat.formErrors,
        rawInput: JSON.stringify(raw).slice(0, 2000),
      });

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

    // Rate limit
    const limit = await rateLimit("listing", authedUser.id);
    if (!limit.success) {
      return {
        success: false,
        error: `Too many listings created. Try again in ${limit.retryAfter} seconds.`,
      };
    }

    // Delegate to service
    const result = await listingService.createListing(
      authedUser.id,
      authedUser.email,
      authedUser.isStripeOnboarded,
      parsed.data,
      ip,
    );

    if (!result.ok) {
      return {
        success: false,
        error: result.error,
        fieldErrors: "fieldErrors" in result ? result.fieldErrors : undefined,
      };
    }

    revalidatePath("/");
    revalidatePath("/search");

    return {
      success: true,
      data: { listingId: result.listingId, slug: result.listingId },
    };
  }); // end withActionContext
}

// ── saveDraft ─────────────────────────────────────────────────────────────────

export async function saveDraft(
  raw: unknown,
): Promise<ActionResult<{ draftId: string }>> {
  return withActionContext(async () => {
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

      // Rate limit
      const limit = await rateLimit("listing", user.id);
      if (!limit.success) {
        return {
          success: false,
          error: `Too many saves. Try again in ${limit.retryAfter} seconds.`,
        };
      }

      const reqHeaders = await headers();
      const ip = getClientIp(reqHeaders);

      const result = await listingService.saveDraft(user.id, parsed.data, ip);

      if (!result.ok) {
        return {
          success: false,
          error: result.error,
          fieldErrors: "fieldErrors" in result ? result.fieldErrors : undefined,
        };
      }

      revalidatePath("/dashboard/seller");
      return { success: true, data: { draftId: result.draftId } };
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
  }); // end withActionContext
}

// ── updateListing ─────────────────────────────────────────────────────────────

export async function updateListing(
  raw: unknown,
): Promise<ActionResult<{ listingId: string }>> {
  return withActionContext(async () => {
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

    const result = await listingService.updateListing(
      user.id,
      user.email,
      user.isAdmin,
      parsed.data,
    );

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    revalidatePath(`/listings/${parsed.data.listingId}`);
    revalidatePath("/dashboard/seller");
    revalidatePath("/search");
    if (parsed.data.listingId && result.ok) {
      revalidatePath("/admin/listings");
    }

    return { success: true, data: { listingId: result.listingId } };
  }); // end withActionContext
}

// ── deleteListing ─────────────────────────────────────────────────────────────

export async function deleteListing(
  listingId: string,
): Promise<ActionResult<void>> {
  return withActionContext(async () => {
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
  }); // end withActionContext
}

// ── toggleWatch ───────────────────────────────────────────────────────────────

export async function toggleWatch(
  raw: unknown,
): Promise<ActionResult<{ watching: boolean }>> {
  return withActionContext(async () => {
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
  }); // end withActionContext
}

// ── getListingForEdit ─────────────────────────────────────────────────────────

export async function getListingForEdit(listingId: string): Promise<
  ActionResult<{
    id: string;
    title: string;
    description: string;
    priceNzd: number;
    isGstIncluded: boolean;
    condition: string;
    status: string;
    moderationNote: string | null;
    categoryId: string;
    subcategoryName: string | null;
    region: string;
    suburb: string;
    shippingOption: string;
    shippingNzd: number | null;
    isOffersEnabled: boolean;
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
  return withActionContext(async () => {
    try {
      const user = await requireUser();
      const result = await listingService.getListingForEdit(
        listingId,
        user.id,
        user.isAdmin,
      );

      if (!result.ok) {
        return { success: false, error: result.error };
      }

      return { success: true, data: result.data };
    } catch (err) {
      return {
        success: false,
        error: safeActionError(
          err,
          "We couldn't load this listing for editing. Please try again.",
        ),
      };
    }
  }); // end withActionContext
}

// ── getListingById ────────────────────────────────────────────────────────────
// Public server function — delegated to ListingService

export async function getListingById(id: string) {
  return withActionContext(async () => {
    return listingService.getListingById(id);
  }); // end withActionContext
}
