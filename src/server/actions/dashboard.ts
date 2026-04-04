"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/dashboard.ts
// ─── Dashboard Data Server Actions ───────────────────────────────────────────
// Secure data-fetching for buyer and seller dashboards.

import { requireUser } from "@/server/lib/requireUser";
import type { ActionResult } from "@/types";
import { dashboardService } from "@/modules/dashboard/dashboard.service";

// Re-export types for existing consumers
export type {
  DashboardUser,
  BuyerOrderRow,
  WatchlistRow,
  ThreadRow,
  MessageRow,
  SellerStatsRow,
  SellerListingRow,
  SellerPayoutRow,
  SellerOrderRow,
} from "@/modules/dashboard/dashboard.service";

// Re-import for return type annotations
import type {
  DashboardUser,
  BuyerOrderRow,
  WatchlistRow,
  ThreadRow,
  SellerStatsRow,
  SellerListingRow,
  SellerOrderRow,
  SellerPayoutRow,
} from "@/modules/dashboard/dashboard.service";

// ── fetchBuyerDashboard ─────────────────────────────────────────────────────

export async function fetchBuyerDashboard(): Promise<
  ActionResult<{
    user: DashboardUser;
    orders: BuyerOrderRow[];
    watchlist: WatchlistRow[];
    threads: ThreadRow[];
  }>
> {
  try {
    let authedUser: Awaited<ReturnType<typeof requireUser>>;
    try {
      authedUser = await requireUser();
    } catch {
      return {
        success: false,
        error: "Please sign in to view your dashboard.",
      };
    }

    const result = await dashboardService.fetchBuyerDashboard(authedUser.id);
    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: result.data };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't load your dashboard. Please refresh the page.",
      ),
    };
  }
}

// ── fetchSellerDashboard ────────────────────────────────────────────────────

export async function fetchSellerDashboard(): Promise<
  ActionResult<{
    user: DashboardUser;
    stats: SellerStatsRow;
    listings: SellerListingRow[];
    orders: SellerOrderRow[];
    payouts: SellerPayoutRow[];
  }>
> {
  try {
    let authedUser: Awaited<ReturnType<typeof requireUser>>;
    try {
      authedUser = await requireUser();
    } catch {
      return {
        success: false,
        error: "Please sign in to view your dashboard.",
      };
    }

    const result = await dashboardService.fetchSellerDashboard(authedUser.id);
    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: result.data };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't load your seller dashboard. Please refresh the page.",
      ),
    };
  }
}
