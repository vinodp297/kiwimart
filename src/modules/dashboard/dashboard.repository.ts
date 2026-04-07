// src/modules/dashboard/dashboard.repository.ts
// ─── Dashboard Repository — read-only data access for buyer/seller dashboards ─

import db from "@/lib/db";

export const dashboardRepository = {
  // ── Buyer dashboard queries ───────────────────────────────────────────────

  async findBuyerOrders(buyerId: string, take = 50) {
    return db.order.findMany({
      where: { buyerId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        listingId: true,
        itemNzd: true,
        shippingNzd: true,
        totalNzd: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        trackingNumber: true,
        trackingUrl: true,
        dispatchedAt: true,
        listing: {
          select: {
            title: true,
            images: {
              where: { order: 0 },
              select: { r2Key: true, thumbnailKey: true },
              take: 1,
            },
          },
        },
        seller: { select: { displayName: true, username: true } },
        reviews: {
          where: { reviewerRole: "BUYER" },
          select: { id: true },
          take: 1,
        },
      },
    });
  },

  async findBuyerWatchlist(userId: string, take = 50) {
    return db.watchlistItem.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        createdAt: true,
        isPriceAlertEnabled: true,
        listing: {
          select: {
            id: true,
            title: true,
            priceNzd: true,
            condition: true,
            region: true,
            suburb: true,
            status: true,
            images: {
              where: { order: 0, isSafe: true },
              select: { r2Key: true, thumbnailKey: true },
              take: 1,
            },
            seller: { select: { displayName: true } },
          },
        },
      },
    });
  },

  async findUserThreads(userId: string, take = 30) {
    return db.messageThread.findMany({
      where: {
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
      orderBy: { lastMessageAt: "desc" },
      take,
      select: {
        id: true,
        listingId: true,
        participant1Id: true,
        participant2Id: true,
        lastMessageAt: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            body: true,
            senderId: true,
            isRead: true,
            createdAt: true,
            sender: { select: { displayName: true } },
          },
        },
      },
    });
  },

  async findListingsByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return db.listing.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        images: {
          where: { order: 0 },
          select: { r2Key: true, thumbnailKey: true },
          take: 1,
        },
      },
    });
  },

  // ── Seller dashboard queries ──────────────────────────────────────────────

  async aggregateCompletedOrders(sellerId: string) {
    return db.order.aggregate({
      where: { sellerId, status: "COMPLETED" },
      _count: true,
      _sum: { totalNzd: true },
    });
  },

  async countRecentSales(sellerId: string, since: Date) {
    return db.order.count({
      where: {
        sellerId,
        status: "COMPLETED",
        completedAt: { gte: since },
      },
    });
  },

  async countActiveListings(sellerId: string) {
    return db.listing.count({
      where: { sellerId, status: "ACTIVE", deletedAt: null },
    });
  },

  async countPendingOrders(sellerId: string) {
    return db.order.count({
      where: {
        sellerId,
        status: { in: ["PAYMENT_HELD", "DISPATCHED"] },
      },
    });
  },

  async aggregateReviews(subjectId: string) {
    return db.review.aggregate({
      where: { subjectId, reviewerRole: "BUYER", isApproved: true },
      _avg: { rating: true },
      _count: true,
    });
  },

  async aggregatePendingPayouts(userId: string) {
    return db.payout.aggregate({
      where: { userId, status: "PENDING" },
      _sum: { amountNzd: true },
    });
  },

  async findSellerListings(sellerId: string, take = 50) {
    return db.listing.findMany({
      where: {
        sellerId,
        status: {
          in: ["ACTIVE", "DRAFT", "PENDING_REVIEW", "NEEDS_CHANGES"],
        },
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        title: true,
        priceNzd: true,
        condition: true,
        categoryId: true,
        subcategoryName: true,
        region: true,
        suburb: true,
        shippingOption: true,
        shippingNzd: true,
        isOffersEnabled: true,
        viewCount: true,
        watcherCount: true,
        expiresAt: true,
        createdAt: true,
        status: true,
        images: {
          where: { order: 0, isSafe: true },
          select: { r2Key: true, thumbnailKey: true },
          take: 1,
        },
        _count: { select: { offers: { where: { status: "PENDING" } } } },
      },
    });
  },

  async findSellerOrders(sellerId: string, take = 50) {
    return db.order.findMany({
      where: { sellerId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        listingId: true,
        totalNzd: true,
        status: true,
        createdAt: true,
        trackingNumber: true,
        dispute: {
          select: { openedAt: true, sellerStatement: true },
        },
        listing: {
          select: {
            title: true,
            images: {
              where: { order: 0 },
              select: { r2Key: true, thumbnailKey: true },
              take: 1,
            },
          },
        },
        buyer: { select: { displayName: true } },
      },
    });
  },

  async findSellerPayouts(userId: string, take = 30) {
    return db.payout.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        amountNzd: true,
        status: true,
        orderId: true,
        paidAt: true,
        createdAt: true,
        order: { select: { listing: { select: { title: true } } } },
      },
    });
  },
};
