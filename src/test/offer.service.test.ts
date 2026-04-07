// src/test/offer.service.test.ts
// ─── Tests for OfferService ─────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import { offerService } from "@/modules/offers/offer.service";
import db from "@/lib/db";
import { AppError } from "@/shared/errors";

// ── Additional mocks for notification / email / lock tests ─────────────────
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

import { createNotification } from "@/modules/notifications/notification.service";
import { withLock } from "@/server/lib/distributedLock";
import { sendOfferReceivedEmail, sendOfferResponseEmail } from "@/server/email";

describe("OfferService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockListing = {
    id: "listing-1",
    sellerId: "seller-1",
    title: "iPhone 15",
    priceNzd: 100000, // $1000.00 in cents
    isOffersEnabled: true,
    seller: { email: "seller@test.com", displayName: "Seller" },
  };

  // ── createOffer ───────────────────────────────────────────────────────────

  describe("createOffer", () => {
    it("creates valid offer at 80% of price", async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never);
      vi.mocked(db.offer.findFirst).mockResolvedValue(null);
      vi.mocked(db.offer.create).mockResolvedValue({ id: "offer-1" } as never);
      vi.mocked(db.user.findUnique).mockResolvedValue({
        displayName: "Buyer",
      } as never);

      const result = await offerService.createOffer(
        { listingId: "listing-1", amount: 800 },
        "buyer-1",
        "127.0.0.1",
      );

      expect(result.offerId).toBe("offer-1");
      expect(db.offer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountNzd: 80000,
            buyerId: "buyer-1",
            sellerId: "seller-1",
          }),
        }),
      );
    });

    it("rejects offer on own listing", async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never);

      await expect(
        offerService.createOffer(
          { listingId: "listing-1", amount: 800 },
          "seller-1", // same as listing.sellerId
          "127.0.0.1",
        ),
      ).rejects.toThrow("own listing");
    });

    it("rejects offer below 50% floor", async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never);

      await expect(
        offerService.createOffer(
          { listingId: "listing-1", amount: 400 }, // 40% of $1000
          "buyer-1",
          "127.0.0.1",
        ),
      ).rejects.toThrow("50%");
    });

    it("rejects offer equal to or above asking price", async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never);

      await expect(
        offerService.createOffer(
          { listingId: "listing-1", amount: 1000 }, // 100% = asking price
          "buyer-1",
          "127.0.0.1",
        ),
      ).rejects.toThrow("Buy Now");
    });

    it("rejects offer when listings not found", async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(null);

      await expect(
        offerService.createOffer(
          { listingId: "listing-nope", amount: 800 },
          "buyer-1",
          "127.0.0.1",
        ),
      ).rejects.toThrow(AppError);
    });

    it("rejects offer when offers disabled on listing", async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue({
        ...mockListing,
        isOffersEnabled: false,
      } as never);

      await expect(
        offerService.createOffer(
          { listingId: "listing-1", amount: 800 },
          "buyer-1",
          "127.0.0.1",
        ),
      ).rejects.toThrow("not accepting offers");
    });

    it("rejects duplicate pending offer", async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never);
      vi.mocked(db.offer.findFirst).mockResolvedValue({
        id: "existing",
      } as never);

      await expect(
        offerService.createOffer(
          { listingId: "listing-1", amount: 800 },
          "buyer-1",
          "127.0.0.1",
        ),
      ).rejects.toThrow("already have a pending offer");
    });

    it("rejects zero or negative offer amount", async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never);

      await expect(
        offerService.createOffer(
          { listingId: "listing-1", amount: 0 },
          "buyer-1",
          "127.0.0.1",
        ),
      ).rejects.toThrow("50%");
    });

    it("sends notification to seller on offer creation", async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never);
      vi.mocked(db.offer.findFirst).mockResolvedValue(null);
      vi.mocked(db.offer.create).mockResolvedValue({ id: "offer-1" } as never);
      vi.mocked(db.user.findUnique).mockResolvedValue({
        displayName: "Buyer",
      } as never);

      await offerService.createOffer(
        { listingId: "listing-1", amount: 800 },
        "buyer-1",
        "127.0.0.1",
      );

      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "seller-1",
          type: "OFFER_RECEIVED",
        }),
      );
    });

    it("sends email to seller on offer creation", async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never);
      vi.mocked(db.offer.findFirst).mockResolvedValue(null);
      vi.mocked(db.offer.create).mockResolvedValue({ id: "offer-1" } as never);
      vi.mocked(db.user.findUnique).mockResolvedValue({
        displayName: "Buyer",
      } as never);

      await offerService.createOffer(
        { listingId: "listing-1", amount: 800 },
        "buyer-1",
        "127.0.0.1",
      );

      expect(sendOfferReceivedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "seller@test.com",
          sellerName: "Seller",
          buyerName: "Buyer",
        }),
      );
    });
  });

  // ── respondOffer ──────────────────────────────────────────────────────────

  describe("respondOffer", () => {
    const mockOffer = {
      id: "offer-1",
      sellerId: "seller-1",
      buyerId: "buyer-1",
      status: "PENDING",
      listingId: "listing-1",
      amountNzd: 80000,
      expiresAt: new Date(Date.now() + 86400000), // tomorrow
      buyer: { email: "buyer@test.com", displayName: "Buyer" },
      listing: { id: "listing-1", title: "iPhone 15" },
    };

    it("accepts offer and reserves listing atomically", async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(mockOffer as never);
      // Transaction callback — execute with db as the tx mock
      vi.mocked(db.$transaction).mockImplementation(async (cb) => {
        if (typeof cb === "function") return await cb(db as never);
        return [] as never;
      });
      vi.mocked(db.offer.update).mockResolvedValue({} as never);
      vi.mocked(db.listing.update).mockResolvedValue({} as never);
      vi.mocked(db.offer.updateMany).mockResolvedValue({ count: 0 } as never);

      await offerService.respondOffer(
        { offerId: "offer-1", action: "ACCEPT" },
        "seller-1",
        "127.0.0.1",
      );

      // Should use $transaction for atomicity
      expect(db.$transaction).toHaveBeenCalled();
    });

    it("declines offer without changing listing", async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(mockOffer as never);
      vi.mocked(db.offer.update).mockResolvedValue({} as never);

      await offerService.respondOffer(
        { offerId: "offer-1", action: "DECLINE" },
        "seller-1",
        "127.0.0.1",
      );

      expect(db.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "DECLINED" }),
        }),
      );
      expect(db.listing.update).not.toHaveBeenCalled();
    });

    it("rejects if seller does not own offer", async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(mockOffer as never);

      await expect(
        offerService.respondOffer(
          { offerId: "offer-1", action: "ACCEPT" },
          "wrong-seller",
          "127.0.0.1",
        ),
      ).rejects.toThrow("permission");
    });

    it("rejects if offer already responded", async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue({
        ...mockOffer,
        status: "ACCEPTED",
      } as never);

      await expect(
        offerService.respondOffer(
          { offerId: "offer-1", action: "DECLINE" },
          "seller-1",
          "127.0.0.1",
        ),
      ).rejects.toThrow("already been responded");
    });

    it("rejects if offer has expired", async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue({
        ...mockOffer,
        expiresAt: new Date(Date.now() - 86400000), // yesterday
      } as never);

      await expect(
        offerService.respondOffer(
          { offerId: "offer-1", action: "ACCEPT" },
          "seller-1",
          "127.0.0.1",
        ),
      ).rejects.toThrow("expired");
    });

    it("throws NOT_FOUND when offer does not exist", async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(null);

      await expect(
        offerService.respondOffer(
          { offerId: "nope", action: "ACCEPT" },
          "seller-1",
          "127.0.0.1",
        ),
      ).rejects.toThrow(AppError);
    });

    it("declines all other pending offers when accepting (in transaction)", async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(mockOffer as never);
      vi.mocked(db.$transaction).mockImplementation(async (cb) => {
        if (typeof cb === "function") return await cb(db as never);
        return [] as never;
      });
      vi.mocked(db.offer.update).mockResolvedValue({} as never);
      vi.mocked(db.listing.update).mockResolvedValue({} as never);
      vi.mocked(db.offer.updateMany).mockResolvedValue({ count: 3 } as never);

      await offerService.respondOffer(
        { offerId: "offer-1", action: "ACCEPT" },
        "seller-1",
        "127.0.0.1",
      );

      expect(db.$transaction).toHaveBeenCalled();
      expect(db.offer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            listingId: "listing-1",
            id: { not: "offer-1" },
            status: "PENDING",
          }),
          data: expect.objectContaining({ status: "DECLINED" }),
        }),
      );
    });

    it("acquires distributed lock when accepting offer", async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(mockOffer as never);
      vi.mocked(db.$transaction).mockImplementation(async (cb) => {
        if (typeof cb === "function") return await cb(db as never);
        return [] as never;
      });
      vi.mocked(db.offer.update).mockResolvedValue({} as never);
      vi.mocked(db.listing.update).mockResolvedValue({} as never);
      vi.mocked(db.offer.updateMany).mockResolvedValue({ count: 0 } as never);

      await offerService.respondOffer(
        { offerId: "offer-1", action: "ACCEPT" },
        "seller-1",
        "127.0.0.1",
      );

      expect(withLock).toHaveBeenCalledWith(
        "listing:purchase:listing-1",
        expect.any(Function),
      );
    });

    it("does not use lock when declining", async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(mockOffer as never);
      vi.mocked(db.offer.update).mockResolvedValue({} as never);

      await offerService.respondOffer(
        { offerId: "offer-1", action: "DECLINE" },
        "seller-1",
        "127.0.0.1",
      );

      expect(withLock).not.toHaveBeenCalled();
    });

    it("notifies buyer on acceptance", async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(mockOffer as never);
      vi.mocked(db.$transaction).mockImplementation(async (cb) => {
        if (typeof cb === "function") return await cb(db as never);
        return [] as never;
      });
      vi.mocked(db.offer.update).mockResolvedValue({} as never);
      vi.mocked(db.listing.update).mockResolvedValue({} as never);
      vi.mocked(db.offer.updateMany).mockResolvedValue({ count: 0 } as never);

      await offerService.respondOffer(
        { offerId: "offer-1", action: "ACCEPT" },
        "seller-1",
        "127.0.0.1",
      );

      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "buyer-1",
          type: "OFFER_ACCEPTED",
        }),
      );
    });

    it("notifies buyer on decline", async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(mockOffer as never);
      vi.mocked(db.offer.update).mockResolvedValue({} as never);

      await offerService.respondOffer(
        { offerId: "offer-1", action: "DECLINE" },
        "seller-1",
        "127.0.0.1",
      );

      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "OFFER_DECLINED",
        }),
      );
    });

    it("sends email to buyer on response", async () => {
      vi.mocked(db.offer.findUnique).mockResolvedValue(mockOffer as never);
      vi.mocked(db.offer.update).mockResolvedValue({} as never);

      await offerService.respondOffer(
        { offerId: "offer-1", action: "DECLINE" },
        "seller-1",
        "127.0.0.1",
      );

      expect(sendOfferResponseEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "buyer@test.com",
          accepted: false,
        }),
      );
    });
  });
});
