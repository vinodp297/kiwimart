// src/modules/offers/offer.service.ts
// ─── Offer Service ───────────────────────────────────────────────────────────
// Offer lifecycle operations. Framework-free.

import { CONFIG_KEYS, getConfigInt } from "@/lib/platform-config";
import { audit } from "@/server/lib/audit";
import { withLock } from "@/server/lib/distributedLock";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import { createNotification } from "@/modules/notifications/notification.service";
import { sendOfferReceivedEmail, sendOfferResponseEmail } from "@/server/email";
import { listingRepository } from "@/modules/listings/listing.repository";
import { userRepository } from "@/modules/users/user.repository";
import { offerRepository } from "./offer.repository";
import db from "@/lib/db";
import type { CreateOfferInput, RespondOfferInput } from "./offer.types";

export class OfferService {
  async createOffer(
    input: CreateOfferInput,
    userId: string,
    ip: string,
  ): Promise<{ offerId: string }> {
    const listing = await listingRepository.findForOffer(input.listingId);

    if (!listing) throw AppError.notFound("Listing");
    if (!listing.isOffersEnabled) {
      throw AppError.validation("This seller is not accepting offers.");
    }
    if (listing.sellerId === userId) {
      throw AppError.validation(
        "You cannot make an offer on your own listing.",
      );
    }

    const amountCents = Math.round(input.amount * 100);
    if (amountCents >= listing.priceNzd) {
      throw AppError.validation(
        'Your offer must be less than the asking price. Use "Buy Now" instead.',
      );
    }
    const offerMinPct = await getConfigInt(CONFIG_KEYS.OFFER_MIN_PERCENTAGE);
    if (amountCents < listing.priceNzd * (offerMinPct / 100)) {
      throw AppError.validation(
        `Offers below ${offerMinPct}% of the asking price are not accepted.`,
      );
    }

    const existingOffer = await offerRepository.findPendingByBuyerAndListing(
      userId,
      input.listingId,
    );
    if (existingOffer) {
      throw AppError.validation(
        "You already have a pending offer on this listing. Withdraw it to make a new one.",
      );
    }

    const offerExpiryHours = await getConfigInt(CONFIG_KEYS.OFFER_EXPIRY_HOURS);
    const offer = await offerRepository.create({
      listingId: input.listingId,
      buyerId: userId,
      sellerId: listing.sellerId,
      amountNzd: amountCents,
      note: input.note ?? null,
      expiresAt: new Date(Date.now() + offerExpiryHours * 60 * 60 * 1000),
    });

    // Notify seller directly — BullMQ worker does not run on Vercel serverless
    const buyerDisplayName = await userRepository.findDisplayName(userId);
    try {
      await sendOfferReceivedEmail({
        to: listing.seller.email,
        sellerName: listing.seller.displayName,
        buyerName: buyerDisplayName ?? "A buyer",
        listingTitle: listing.title,
        offerAmount: input.amount,
        listingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/listings/${input.listingId}`,
      });
    } catch (err) {
      logger.warn("offer.create.email.failed", {
        listingId: input.listingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    audit({
      userId,
      action: "OFFER_CREATED",
      entityType: "Offer",
      entityId: offer.id,
      metadata: { listingId: input.listingId, amountNzd: amountCents },
      ip,
    });

    // Notify seller of new offer
    createNotification({
      userId: listing.sellerId,
      type: "OFFER_RECEIVED",
      title: "New offer received 💬",
      body: `${buyerDisplayName ?? "A buyer"} offered $${input.amount.toFixed(2)} for "${listing.title}"`,
      listingId: input.listingId,
      link: `/listings/${input.listingId}`,
    }).catch((err: unknown) => {
      logger.error("offer.notification.failed", {
        listingId: input.listingId,
        sellerId: listing.sellerId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    logger.info("offer.created", {
      offerId: offer.id,
      listingId: input.listingId,
      userId,
    });

    return { offerId: offer.id };
  }

  async respondOffer(
    input: RespondOfferInput,
    userId: string,
    ip: string,
  ): Promise<void> {
    const offer = await offerRepository.findByIdWithRelations(input.offerId);

    if (!offer) throw AppError.notFound("Offer");
    if (offer.sellerId !== userId) {
      throw AppError.unauthorised(
        "You do not have permission to respond to this offer.",
      );
    }
    if (offer.status !== "PENDING") {
      throw new AppError(
        "ORDER_WRONG_STATE",
        "This offer has already been responded to.",
        400,
      );
    }
    if (offer.expiresAt < new Date()) {
      throw new AppError("ORDER_WRONG_STATE", "This offer has expired.", 400);
    }

    if (input.action === "ACCEPT") {
      // Lock on listingId — prevents two concurrent ACCEPT calls reserving the same listing
      // (e.g. seller double-clicks, or two admins accept simultaneously)
      try {
        await withLock(`listing:purchase:${offer.listingId}`, async () => {
          // Atomic: accept offer + reserve listing + decline competing offers
          await db.$transaction(async (tx) => {
            await offerRepository.accept(
              input.offerId,
              new Date(Date.now() + 24 * 60 * 60 * 1000),
              tx,
            );
            await listingRepository.setStatus(offer.listingId, "RESERVED", tx);
            await offerRepository.declineCompetitors(
              offer.listingId,
              input.offerId,
              tx,
            );
          });
        });
      } catch (lockErr) {
        // Fail-closed: Redis unavailable in production → surface retry message
        if (
          lockErr instanceof Error &&
          lockErr.message.includes("temporarily unavailable")
        ) {
          throw new AppError(
            "PAYMENT_GATEWAY_ERROR",
            "Service temporarily unavailable. Please try again in a moment.",
            503,
          );
        }
        throw lockErr;
      }
    } else {
      await offerRepository.decline(input.offerId, input.declineReason);
    }

    // Notify buyer directly — BullMQ worker does not run on Vercel serverless
    try {
      await sendOfferResponseEmail({
        to: offer.buyer.email,
        buyerName: offer.buyer.displayName,
        listingTitle: offer.listing.title,
        accepted: input.action === "ACCEPT",
        listingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/listings/${offer.listingId}`,
      });
    } catch (err) {
      logger.warn("offer.respond.email.failed", {
        offerId: input.offerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    audit({
      userId,
      action: input.action === "ACCEPT" ? "OFFER_ACCEPTED" : "OFFER_DECLINED",
      entityType: "Offer",
      entityId: input.offerId,
      ip,
    });

    // Notify buyer of offer response
    if (input.action === "ACCEPT") {
      createNotification({
        userId: offer.buyerId,
        type: "OFFER_ACCEPTED",
        title: "Your offer was accepted! 🎉",
        body: `"${offer.listing.title}" — complete your purchase within 24 hours.`,
        listingId: offer.listingId,
        link: `/listings/${offer.listingId}`,
      }).catch(() => {});
    } else {
      createNotification({
        userId: offer.buyerId,
        type: "OFFER_DECLINED",
        title: "Offer not accepted",
        body: `Your offer on "${offer.listing.title}" was declined. The listing is still available.`,
        listingId: offer.listingId,
        link: `/listings/${offer.listingId}`,
      }).catch(() => {});
    }

    logger.info("offer.responded", {
      offerId: input.offerId,
      action: input.action,
      userId,
    });
  }
}

export const offerService = new OfferService();
