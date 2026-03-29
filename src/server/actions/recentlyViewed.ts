"use server";
// src/server/actions/recentlyViewed.ts
// ─── Recently Viewed — DB persistence for authenticated users ─────────────────

import db from "@/lib/db";
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
    await db.recentlyViewed.upsert({
      where: {
        userId_listingId: { userId: user.id, listingId },
      },
      update: { viewedAt: new Date() },
      create: { userId: user.id, listingId },
    });

    // Trim old views beyond the cap (keep newest MAX_PER_USER)
    const oldest = await db.recentlyViewed.findMany({
      where: { userId: user.id },
      orderBy: { viewedAt: "desc" },
      skip: MAX_PER_USER,
      select: { id: true },
    });

    if (oldest.length > 0) {
      await db.recentlyViewed.deleteMany({
        where: { id: { in: oldest.map((r) => r.id) } },
      });
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

    const rows = await db.recentlyViewed.findMany({
      where: { userId: user.id },
      orderBy: { viewedAt: "desc" },
      take: limit,
      select: {
        viewedAt: true,
        listing: {
          select: {
            id: true,
            title: true,
            priceNzd: true,
            condition: true,
            status: true,
            deletedAt: true,
            images: {
              where: { order: 0, safe: true },
              select: { r2Key: true, thumbnailKey: true },
              take: 1,
            },
          },
        },
      },
    });

    // Filter out deleted/inactive listings
    const data: RecentlyViewedRow[] = rows
      .filter((r) => r.listing.status === "ACTIVE" && !r.listing.deletedAt)
      .map((r) => {
        const imgKey =
          r.listing.images[0]?.thumbnailKey ?? r.listing.images[0]?.r2Key;
        const thumbnailUrl = imgKey
          ? imgKey.startsWith("http")
            ? imgKey
            : `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${imgKey}`
          : "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=480&h=480&fit=crop";
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
