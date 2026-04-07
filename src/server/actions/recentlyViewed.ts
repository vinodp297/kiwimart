"use server";
// src/server/actions/recentlyViewed.ts
// ─── Recently Viewed — DB persistence for authenticated users ─────────────────

import { recentlyViewedRepository } from "@/modules/listings/recently-viewed.repository";
import { getImageUrl } from "@/lib/image";
import { requireUser } from "@/server/lib/requireUser";
import { logger } from "@/shared/logger";
import type { ActionResult } from "@/types";

const MAX_PER_USER = 20;

/**
 * Record a listing view for the authenticated user.
 * Upserts so revisits just update the timestamp.
 * Trims to MAX_PER_USER. Fire-and-forget from the page — never blocks render.
 */
export async function recordListingView(
  listingId: string,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    // Upsert the view record
    await recentlyViewedRepository.upsertView(user.id, listingId);

    // Trim old views beyond the cap (keep newest MAX_PER_USER)
    const oldest = await recentlyViewedRepository.findOlderThanCap(
      user.id,
      MAX_PER_USER,
    );

    if (oldest.length > 0) {
      await recentlyViewedRepository.deleteManyByIds(oldest.map((r) => r.id));
    }

    return { success: true, data: undefined };
  } catch (err) {
    logger.error("recentlyViewed.record.failed", {
      listingId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: "Failed to record view" };
  }
}

export interface RecentlyViewedRow {
  id: string;
  title: string;
  price: number;
  condition: string;
  thumbnailUrl: string;
  viewedAt: string;
}

/**
 * Fetch the user's recently viewed listings from the DB.
 * Returns up to `limit` items, newest first.
 */
export async function getRecentlyViewedFromDB(
  limit = 20,
): Promise<ActionResult<RecentlyViewedRow[]>> {
  try {
    const user = await requireUser();

    const rows = await recentlyViewedRepository.findByUser(user.id, limit);

    // Filter out deleted/inactive listings
    const data: RecentlyViewedRow[] = rows
      .filter((r) => r.listing.status === "ACTIVE" && !r.listing.deletedAt)
      .map((r) => {
        const imgKey =
          r.listing.images[0]?.thumbnailKey ?? r.listing.images[0]?.r2Key;
        const thumbnailUrl = getImageUrl(imgKey);
        return {
          id: r.listing.id,
          title: r.listing.title,
          price: r.listing.priceNzd / 100,
          condition: r.listing.condition.toLowerCase(),
          thumbnailUrl,
          viewedAt: r.viewedAt.toISOString(),
        };
      });

    return { success: true, data };
  } catch (err) {
    logger.error("recentlyViewed.fetch.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: "Failed to fetch recently viewed" };
  }
}
