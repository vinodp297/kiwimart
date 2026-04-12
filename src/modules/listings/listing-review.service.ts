// src/modules/listings/listing-review.service.ts
// ─── Auto-review and price-drop notification helpers ────────────────────────
// Shared by listing-create and listing-lifecycle sub-services.

import { audit } from "@/server/lib/audit";
import { formatCentsAsNzd } from "@/lib/currency";
import { logger } from "@/shared/logger";
import { createNotification } from "@/modules/notifications/notification.service";
import { fireAndForget } from "@/lib/fire-and-forget";
import { userRepository } from "@/modules/users/user.repository";
import { MS_PER_DAY } from "@/lib/time";
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
import { listingRepository } from "./listing.repository";

// ── runAutoReviewFlow ───────────────────────────────────────────────────────

export async function runAutoReviewFlow(
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

    fireAndForget(
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
      ]),
      "listing.autoReview.reject.notifyAndEmail",
      { listingId, userId },
    );

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
      expiresAt: new Date(Date.now() + 30 * MS_PER_DAY),
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
    fireAndForget(
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
      ]),
      "listing.autoReview.approve.notifyAndEmail",
      { listingId, userId },
    );
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

    fireAndForget(
      createNotification({
        userId,
        type: "LISTING_UNDER_REVIEW",
        title: "Listing under review",
        body: "Your listing has been submitted and is under review. We'll notify you once it's approved.",
        listingId,
      }),
      "listing.autoReview.queue.notify",
      { listingId, userId },
    );
  }

  return null; // success — no error
}

// ── notifyPriceDrop ─────────────────────────────────────────────────────────

export function notifyPriceDrop(
  listingId: string,
  sellerId: string,
  listingTitle: string,
  oldPriceNzd: number,
  newPriceNzd: number,
): void {
  const priceDrop = Math.round(
    ((oldPriceNzd - newPriceNzd) / oldPriceNzd) * 100,
  );
  const newPriceFormatted = formatCentsAsNzd(newPriceNzd);
  const oldPriceFormatted = formatCentsAsNzd(oldPriceNzd);
  const savings = formatCentsAsNzd(oldPriceNzd - newPriceNzd);

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
              listingUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://buyzi.co.nz"}/listings/${listingId}`,
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
