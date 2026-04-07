"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/watchlist.ts
// ─── Watchlist Actions ──────────────────────────────────────────────────────

import { watchlistRepository } from "@/modules/listings/watchlist.repository";
import { requireUser } from "@/server/lib/requireUser";
import type { ActionResult } from "@/types";
import { togglePriceAlertSchema as TogglePriceAlertSchema } from "@/server/validators";

export async function togglePriceAlert(
  raw: unknown,
): Promise<ActionResult<{ enabled: boolean }>> {
  try {
    const user = await requireUser();
    const parsed = TogglePriceAlertSchema.safeParse(raw);
    if (!parsed.success)
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };

    const { listingId, enabled } = parsed.data;

    const item = await watchlistRepository.findByUserAndListing(
      user.id,
      listingId,
    );

    if (!item) return { success: false, error: "Item not in your watchlist." };

    await watchlistRepository.updatePriceAlert(item.id, enabled);

    return { success: true, data: { enabled } };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't update your price alert. Please try again.",
      ),
    };
  }
}
