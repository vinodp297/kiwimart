// src/modules/users/export.repository.ts
// ─── Export Repository — data access for PII data export ─────────────────────

import db from "@/lib/db";

export const exportRepository = {
  /** Fetch PII-safe profile fields for a user. */
  async findProfile(userId: string) {
    return db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        bio: true,
        phone: true,
        isPhoneVerified: true,
        region: true,
        suburb: true,
        dateOfBirth: true,
        idVerified: true,
        nzbn: true,
        gstNumber: true,
        isSellerEnabled: true,
        hasMarketingConsent: true,
        createdAt: true,
        updatedAt: true,
        // NEVER: passwordHash, mfaSecret, mfaBackupCodes
      },
    });
  },

  /** Fetch all orders for a user (buyer or seller). */
  async findOrders(userId: string) {
    return db.order.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      select: {
        id: true,
        status: true,
        itemNzd: true,
        shippingNzd: true,
        totalNzd: true,
        fulfillmentType: true,
        shippingName: true,
        shippingLine1: true,
        shippingLine2: true,
        shippingCity: true,
        shippingRegion: true,
        shippingPostcode: true,
        trackingNumber: true,
        createdAt: true,
        completedAt: true,
        cancelledAt: true,
        cancelReason: true,
      },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Fetch all messages sent by a user. */
  async findMessages(userId: string) {
    return db.message.findMany({
      where: { senderId: userId },
      select: { id: true, body: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Fetch all reviews written by a user. */
  async findReviews(userId: string) {
    return db.review.findMany({
      where: { authorId: userId },
      select: { id: true, rating: true, comment: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Fetch all listings created by a user. */
  async findListings(userId: string) {
    return db.listing.findMany({
      where: { sellerId: userId },
      select: {
        id: true,
        title: true,
        description: true,
        priceNzd: true,
        condition: true,
        status: true,
        region: true,
        suburb: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Fetch all offers made by a user (as buyer). */
  async findOffersMade(userId: string) {
    return db.offer.findMany({
      where: { buyerId: userId },
      select: { id: true, amountNzd: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Fetch all offers received by a user (as seller). */
  async findOffersReceived(userId: string) {
    return db.offer.findMany({
      where: { sellerId: userId },
      select: { id: true, amountNzd: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Fetch all watchlist items for a user. */
  async findWatchlist(userId: string) {
    return db.watchlistItem.findMany({
      where: { userId },
      select: { id: true, listingId: true, createdAt: true },
    });
  },
};
