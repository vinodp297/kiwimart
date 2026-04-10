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

  // ── Methods used by the direct-download export (GET /api/v1/me/export) ──────

  /** Orders where the user was the buyer, most recent first. */
  async findOrdersAsBuyer(userId: string) {
    return db.order.findMany({
      where: { buyerId: userId },
      select: {
        id: true,
        status: true,
        itemNzd: true,
        shippingNzd: true,
        totalNzd: true,
        fulfillmentType: true,
        createdAt: true,
        completedAt: true,
        cancelledAt: true,
        cancelReason: true,
      },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Orders where the user was the seller, most recent first. */
  async findOrdersAsSeller(userId: string) {
    return db.order.findMany({
      where: { sellerId: userId },
      select: {
        id: true,
        status: true,
        itemNzd: true,
        shippingNzd: true,
        totalNzd: true,
        fulfillmentType: true,
        createdAt: true,
        completedAt: true,
        cancelledAt: true,
        cancelReason: true,
      },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Reviews this user authored (given), most recent first. */
  async findReviewsGiven(userId: string) {
    return db.review.findMany({
      where: { authorId: userId },
      select: {
        id: true,
        rating: true,
        comment: true,
        reviewerRole: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Reviews this user received as subject, most recent first. */
  async findReviewsReceived(userId: string) {
    return db.review.findMany({
      where: { subjectId: userId },
      select: {
        id: true,
        rating: true,
        comment: true,
        reviewerRole: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Messages sent by this user on or after `since` (privacy-conscious window),
   * most recent first.
   */
  async findRecentMessages(userId: string, since: Date) {
    return db.message.findMany({
      where: { senderId: userId, createdAt: { gte: since } },
      select: { id: true, body: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Disputes linked to any order the user participated in (buyer or seller),
   * most recently opened first.
   */
  async findDisputes(userId: string) {
    return db.dispute.findMany({
      where: {
        order: {
          OR: [{ buyerId: userId }, { sellerId: userId }],
        },
      },
      select: {
        id: true,
        orderId: true,
        reason: true,
        status: true,
        openedAt: true,
        resolvedAt: true,
        resolution: true,
      },
      orderBy: { openedAt: "desc" },
    });
  },
};
