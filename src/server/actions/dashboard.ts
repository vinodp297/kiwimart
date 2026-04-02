"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/dashboard.ts
// ─── Dashboard Data Server Actions ───────────────────────────────────────────
// Secure data-fetching for buyer and seller dashboards.
// TODO POST-LAUNCH: Split into buyer/seller query services + mappers.
// See architectural review 27-Mar-2026.
// All queries are scoped to the authenticated user's ID.

import { requireUser } from "@/server/lib/requireUser";
import db from "@/lib/db";
import { getImageUrl, getThumbUrl } from "@/lib/image";
import type { ActionResult } from "@/types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DashboardUser {
  id: string;
  displayName: string;
  email: string;
  username: string;
  avatarKey: string | null;
  createdAt: string;
  sellerEnabled: boolean;
  idVerified: boolean;
  phoneVerified: boolean;
  emailVerified: string | null;
  region: string | null;
  bio: string | null;
  onboardingIntent: string | null;
  onboardingCompleted: boolean;
  stripeOnboarded: boolean;
  sellerTermsAcceptedAt: string | null;
}

export interface BuyerOrderRow {
  id: string;
  listingId: string;
  listingTitle: string;
  listingThumbnail: string;
  sellerName: string;
  sellerUsername: string;
  price: number;
  shippingPrice: number;
  total: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  dispatchedAt: string | null;
  canConfirmDelivery: boolean;
  canDispute: boolean;
  hasReview: boolean;
}

export interface WatchlistRow {
  id: string;
  title: string;
  price: number;
  condition: string;
  thumbnailUrl: string;
  sellerName: string;
  region: string;
  suburb: string;
  watchedAt: string;
  status: string;
  priceAlertEnabled: boolean;
}

export interface ThreadRow {
  id: string;
  otherPartyName: string;
  otherPartyUsername: string;
  otherPartyAvatar: string | null;
  listingId: string;
  listingTitle: string;
  listingThumbnail: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  messages: MessageRow[];
}

export interface MessageRow {
  id: string;
  body: string;
  senderId: string;
  senderName: string;
  createdAt: string;
  read: boolean;
}

// ── Condition map ────────────────────────────────────────────────────────────
const COND_MAP: Record<string, string> = {
  NEW: "new",
  LIKE_NEW: "like-new",
  GOOD: "good",
  FAIR: "fair",
  PARTS: "parts",
};

const STATUS_MAP: Record<string, string> = {
  AWAITING_PAYMENT: "awaiting_payment",
  PAYMENT_HELD: "payment_held",
  DISPATCHED: "dispatched",
  DELIVERED: "delivered",
  COMPLETED: "completed",
  DISPUTED: "disputed",
  REFUNDED: "refunded",
  CANCELLED: "cancelled",
};

function r2Url(key: string | null): string {
  return getImageUrl(key);
}

function thumbUrl(
  img: { r2Key: string; thumbnailKey?: string | null } | undefined,
): string {
  return getThumbUrl(img);
}

// ── fetchBuyerDashboard ──────────────────────────────────────────────────────

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
    const userId = authedUser.id;

    const [dbUser, orders, watchlist, threads] = await Promise.all([
      // User profile
      db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          displayName: true,
          email: true,
          username: true,
          avatarKey: true,
          createdAt: true,
          sellerEnabled: true,
          idVerified: true,
          phoneVerified: true,
          emailVerified: true,
          region: true,
          bio: true,
          onboardingIntent: true,
          onboardingCompleted: true,
          stripeOnboarded: true,
          sellerTermsAcceptedAt: true,
        },
      }),
      // Orders as buyer
      db.order.findMany({
        where: { buyerId: userId },
        orderBy: { createdAt: "desc" },
        take: 50,
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
          review: { select: { id: true } },
        },
      }),
      // Watchlist
      db.watchlistItem.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          createdAt: true,
          priceAlertEnabled: true,
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
                where: { order: 0, safe: true },
                select: { r2Key: true, thumbnailKey: true },
                take: 1,
              },
              seller: { select: { displayName: true } },
            },
          },
        },
      }),
      // Message threads
      db.messageThread.findMany({
        where: {
          OR: [{ participant1Id: userId }, { participant2Id: userId }],
        },
        orderBy: { lastMessageAt: "desc" },
        take: 30,
        select: {
          id: true,
          listingId: true,
          participant1Id: true,
          participant2Id: true,
          lastMessageAt: true,
          messages: {
            orderBy: { createdAt: "asc" },
            take: 50,
            select: {
              id: true,
              body: true,
              senderId: true,
              read: true,
              createdAt: true,
              sender: { select: { displayName: true } },
            },
          },
        },
      }),
    ]);

    if (!dbUser) {
      return { success: false, error: "User not found." };
    }

    // Map orders
    const mappedOrders: BuyerOrderRow[] = orders.map((o) => {
      const status = STATUS_MAP[o.status] ?? o.status.toLowerCase();
      return {
        id: o.id,
        listingId: o.listingId,
        listingTitle: o.listing.title,
        listingThumbnail: thumbUrl(o.listing.images[0]),
        sellerName: o.seller.displayName,
        sellerUsername: o.seller.username,
        price: o.itemNzd / 100,
        shippingPrice: o.shippingNzd / 100,
        total: o.totalNzd / 100,
        status,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
        trackingNumber: o.trackingNumber,
        trackingUrl: o.trackingUrl,
        dispatchedAt: o.dispatchedAt?.toISOString() ?? null,
        canConfirmDelivery: status === "dispatched" || status === "delivered",
        canDispute: status === "dispatched" || status === "delivered",
        hasReview: !!o.review,
      };
    });

    // Map watchlist
    const mappedWatchlist: WatchlistRow[] = watchlist.map((w) => ({
      id: w.listing.id,
      title: w.listing.title,
      price: w.listing.priceNzd / 100,
      condition: COND_MAP[w.listing.condition] ?? "good",
      thumbnailUrl: thumbUrl(w.listing.images[0]),
      sellerName: w.listing.seller.displayName,
      region: w.listing.region,
      suburb: w.listing.suburb,
      watchedAt: w.createdAt.toISOString(),
      status: w.listing.status.toLowerCase(),
      priceAlertEnabled: w.priceAlertEnabled,
    }));

    // Map threads — need to look up the other participant
    const otherUserIds = threads.map((t) =>
      t.participant1Id === userId ? t.participant2Id : t.participant1Id,
    );
    const listingIds = threads
      .map((t) => t.listingId)
      .filter(Boolean) as string[];

    const [otherUsers, listings] = await Promise.all([
      otherUserIds.length > 0
        ? db.user.findMany({
            where: { id: { in: otherUserIds } },
            select: {
              id: true,
              displayName: true,
              username: true,
              avatarKey: true,
            },
          })
        : Promise.resolve([]),
      listingIds.length > 0
        ? db.listing.findMany({
            where: { id: { in: listingIds } },
            select: {
              id: true,
              title: true,
              images: {
                where: { order: 0 },
                select: { r2Key: true, thumbnailKey: true },
                take: 1,
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const userMap = new Map(otherUsers.map((u) => [u.id, u]));
    const listingMap = new Map(listings.map((l) => [l.id, l]));

    const mappedThreads: ThreadRow[] = threads.map((t) => {
      const otherId =
        t.participant1Id === userId ? t.participant2Id : t.participant1Id;
      const other = userMap.get(otherId);
      const listing = t.listingId ? listingMap.get(t.listingId) : null;
      const lastMsg = t.messages[t.messages.length - 1];
      const unread = t.messages.filter(
        (m) => m.senderId !== userId && !m.read,
      ).length;

      return {
        id: t.id,
        otherPartyName: other?.displayName ?? "Unknown",
        otherPartyUsername: other?.username ?? "unknown",
        otherPartyAvatar: other?.avatarKey ? r2Url(other.avatarKey) : null,
        listingId: t.listingId ?? "",
        listingTitle: listing?.title ?? "General inquiry",
        listingThumbnail: thumbUrl(listing?.images[0]),
        lastMessage: lastMsg?.body ?? "",
        lastMessageAt: t.lastMessageAt.toISOString(),
        unreadCount: unread,
        messages: t.messages.map((m) => ({
          id: m.id,
          body: m.body,
          senderId: m.senderId === userId ? "me" : m.senderId,
          senderName:
            m.senderId === userId ? "You" : (m.sender.displayName ?? "Unknown"),
          createdAt: m.createdAt.toISOString(),
          read: m.read,
        })),
      };
    });

    return {
      success: true,
      data: {
        user: {
          id: dbUser.id,
          displayName: dbUser.displayName,
          email: dbUser.email,
          username: dbUser.username,
          avatarKey: dbUser.avatarKey,
          createdAt: dbUser.createdAt.toISOString(),
          sellerEnabled: dbUser.sellerEnabled,
          idVerified: dbUser.idVerified,
          phoneVerified: dbUser.phoneVerified,
          emailVerified: dbUser.emailVerified?.toISOString() ?? null,
          region: dbUser.region ?? null,
          bio: dbUser.bio ?? null,
          onboardingIntent: dbUser.onboardingIntent ?? null,
          onboardingCompleted: dbUser.onboardingCompleted,
          stripeOnboarded: dbUser.stripeOnboarded,
          sellerTermsAcceptedAt:
            dbUser.sellerTermsAcceptedAt?.toISOString() ?? null,
        },
        orders: mappedOrders,
        watchlist: mappedWatchlist,
        threads: mappedThreads,
      },
    };
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

// ── Seller Dashboard Stats ───────────────────────────────────────────────────

export interface SellerStatsRow {
  totalSales: number;
  recentSales: number; // Completed in last 12 months — used for tier calculation
  totalRevenue: number;
  activeListings: number;
  pendingOrders: number;
  avgRating: number;
  reviewCount: number;
  pendingPayout: number;
  responseRate: number;
}

export interface SellerListingRow {
  id: string;
  title: string;
  price: number;
  condition: string;
  thumbnailUrl: string;
  viewCount: number;
  watcherCount: number;
  offerCount: number;
  expiresAt: string | null;
  createdAt: string;
  status: string;
  categoryName: string;
  subcategoryName: string;
  region: string;
  suburb: string;
  sellerName: string;
  sellerUsername: string;
  sellerRating: number;
  sellerVerified: boolean;
  shippingOption: string;
  shippingPrice: number | null;
  offersEnabled: boolean;
}

export interface SellerPayoutRow {
  id: string;
  amount: number;
  status: string;
  orderId: string;
  listingTitle: string;
  paidAt: string | null;
  estimatedArrival: string | null;
}

export interface SellerOrderRow {
  id: string;
  listingId: string;
  listingTitle: string;
  listingThumbnail: string;
  buyerName: string;
  total: number;
  status: string;
  createdAt: string;
  trackingNumber: string | null;
  disputeOpenedAt: string | null;
  sellerResponse: string | null;
}

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
    const userId = authedUser.id;

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    const [
      dbUser,
      completedOrders,
      recentSalesCount,
      activeListingCount,
      pendingOrderCount,
      reviewAgg,
      pendingPayoutAgg,
      listings,
      sellerOrders,
      payouts,
    ] = await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          displayName: true,
          email: true,
          username: true,
          avatarKey: true,
          createdAt: true,
          sellerEnabled: true,
          idVerified: true,
          phoneVerified: true,
          emailVerified: true,
          region: true,
          bio: true,
          onboardingIntent: true,
          onboardingCompleted: true,
          stripeOnboarded: true,
          sellerTermsAcceptedAt: true,
        },
      }),
      db.order.aggregate({
        where: { sellerId: userId, status: "COMPLETED" },
        _count: true,
        _sum: { totalNzd: true },
      }),
      // Recent sales (last 12 months) — used for tier calculation
      db.order.count({
        where: {
          sellerId: userId,
          status: "COMPLETED",
          completedAt: { gte: twelveMonthsAgo },
        },
      }),
      db.listing.count({
        where: { sellerId: userId, status: "ACTIVE", deletedAt: null },
      }),
      db.order.count({
        where: {
          sellerId: userId,
          status: { in: ["PAYMENT_HELD", "DISPATCHED"] },
        },
      }),
      db.review.aggregate({
        where: { sellerId: userId, approved: true },
        _avg: { rating: true },
        _count: true,
      }),
      db.payout.aggregate({
        where: { userId, status: "PENDING" },
        _sum: { amountNzd: true },
      }),
      // Active + Draft + Pending + Needs Changes listings
      db.listing.findMany({
        where: {
          sellerId: userId,
          status: {
            in: ["ACTIVE", "DRAFT", "PENDING_REVIEW", "NEEDS_CHANGES"],
          },
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
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
          offersEnabled: true,
          viewCount: true,
          watcherCount: true,
          expiresAt: true,
          createdAt: true,
          status: true,
          images: {
            where: { order: 0, safe: true },
            select: { r2Key: true, thumbnailKey: true },
            take: 1,
          },
          _count: { select: { offers: { where: { status: "PENDING" } } } },
        },
      }),
      // Orders as seller
      db.order.findMany({
        where: { sellerId: userId },
        orderBy: { createdAt: "desc" },
        take: 50,
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
      }),
      // Payouts
      db.payout.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          amountNzd: true,
          status: true,
          orderId: true,
          paidAt: true,
          createdAt: true,
          order: { select: { listing: { select: { title: true } } } },
        },
      }),
    ]);

    if (!dbUser) {
      return { success: false, error: "User not found." };
    }

    const avgRating = reviewAgg._avg.rating ? reviewAgg._avg.rating / 10 : 0;

    const stats: SellerStatsRow = {
      totalSales: completedOrders._count,
      recentSales: recentSalesCount,
      totalRevenue: (completedOrders._sum.totalNzd ?? 0) / 100,
      activeListings: activeListingCount,
      pendingOrders: pendingOrderCount,
      avgRating,
      reviewCount: reviewAgg._count,
      pendingPayout: (pendingPayoutAgg._sum.amountNzd ?? 0) / 100,
      responseRate: 0,
    };

    const mappedListings: SellerListingRow[] = listings.map((l) => ({
      id: l.id,
      title: l.title,
      price: l.priceNzd / 100,
      condition: COND_MAP[l.condition] ?? "good",
      thumbnailUrl: thumbUrl(l.images[0]),
      viewCount: l.viewCount,
      watcherCount: l.watcherCount,
      offerCount: l._count.offers,
      expiresAt: l.expiresAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
      status: l.status.toLowerCase(),
      categoryName: l.categoryId,
      subcategoryName: l.subcategoryName ?? "",
      region: l.region,
      suburb: l.suburb,
      sellerName: dbUser.displayName,
      sellerUsername: dbUser.username,
      sellerRating: stats.avgRating,
      sellerVerified: dbUser.idVerified,
      shippingOption: l.shippingOption.toLowerCase(),
      shippingPrice: l.shippingNzd != null ? l.shippingNzd / 100 : null,
      offersEnabled: l.offersEnabled,
    }));

    const mappedOrders: SellerOrderRow[] = sellerOrders.map((o) => ({
      id: o.id,
      listingId: o.listingId,
      listingTitle: o.listing.title,
      listingThumbnail: thumbUrl(o.listing.images[0]),
      buyerName: o.buyer.displayName,
      total: o.totalNzd / 100,
      status: STATUS_MAP[o.status] ?? o.status.toLowerCase(),
      createdAt: o.createdAt.toISOString(),
      trackingNumber: o.trackingNumber,
      disputeOpenedAt: o.dispute?.openedAt?.toISOString() ?? null,
      sellerResponse: o.dispute?.sellerStatement ?? null,
    }));

    const mappedPayouts: SellerPayoutRow[] = payouts.map((p) => ({
      id: p.id,
      amount: p.amountNzd / 100,
      status: p.status.toLowerCase(),
      orderId: p.orderId,
      listingTitle: p.order.listing.title,
      paidAt: p.paidAt?.toISOString() ?? null,
      estimatedArrival: p.paidAt
        ? null
        : new Date(
            p.createdAt.getTime() + 3 * 24 * 60 * 60 * 1000,
          ).toISOString(),
    }));

    return {
      success: true,
      data: {
        user: {
          id: dbUser.id,
          displayName: dbUser.displayName,
          email: dbUser.email,
          username: dbUser.username,
          avatarKey: dbUser.avatarKey,
          createdAt: dbUser.createdAt.toISOString(),
          sellerEnabled: dbUser.sellerEnabled,
          idVerified: dbUser.idVerified,
          phoneVerified: dbUser.phoneVerified,
          emailVerified: dbUser.emailVerified?.toISOString() ?? null,
          region: dbUser.region ?? null,
          bio: dbUser.bio ?? null,
          onboardingIntent: dbUser.onboardingIntent ?? null,
          onboardingCompleted: dbUser.onboardingCompleted,
          stripeOnboarded: dbUser.stripeOnboarded,
          sellerTermsAcceptedAt:
            dbUser.sellerTermsAcceptedAt?.toISOString() ?? null,
        },
        stats,
        listings: mappedListings,
        orders: mappedOrders,
        payouts: mappedPayouts,
      },
    };
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
