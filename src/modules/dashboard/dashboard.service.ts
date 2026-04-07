// src/modules/dashboard/dashboard.service.ts
// ─── Dashboard Service — orchestrates queries + maps to DTOs ────────────────

import { userRepository } from "@/modules/users/user.repository";
import { getImageUrl, getThumbUrl } from "@/lib/image";
import { dashboardRepository } from "./dashboard.repository";

// ── Types (re-exported by the server action) ────────────────────────────────

export interface DashboardUser {
  id: string;
  displayName: string;
  email: string;
  username: string;
  avatarKey: string | null;
  createdAt: string;
  isSellerEnabled: boolean;
  idVerified: boolean;
  isPhoneVerified: boolean;
  emailVerified: string | null;
  region: string | null;
  bio: string | null;
  onboardingIntent: string | null;
  isOnboardingCompleted: boolean;
  isStripeOnboarded: boolean;
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
  isPriceAlertEnabled: boolean;
}

export interface ThreadRow {
  id: string;
  otherPartyId: string;
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
  isRead: boolean;
}

export interface SellerStatsRow {
  totalSales: number;
  recentSales: number;
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
  isOffersEnabled: boolean;
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

// ── Mapping helpers ─────────────────────────────────────────────────────────

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

function mapDashboardUser(
  dbUser: NonNullable<
    Awaited<ReturnType<typeof userRepository.findForDashboard>>
  >,
): DashboardUser {
  return {
    id: dbUser.id,
    displayName: dbUser.displayName,
    email: dbUser.email,
    username: dbUser.username,
    avatarKey: dbUser.avatarKey,
    createdAt: dbUser.createdAt.toISOString(),
    isSellerEnabled: dbUser.isSellerEnabled,
    idVerified: dbUser.idVerified,
    isPhoneVerified: dbUser.isPhoneVerified,
    emailVerified: dbUser.emailVerified?.toISOString() ?? null,
    region: dbUser.region ?? null,
    bio: dbUser.bio ?? null,
    onboardingIntent: dbUser.onboardingIntent ?? null,
    isOnboardingCompleted: dbUser.isOnboardingCompleted,
    isStripeOnboarded: dbUser.isStripeOnboarded,
    sellerTermsAcceptedAt: dbUser.sellerTermsAcceptedAt?.toISOString() ?? null,
  };
}

import type { ServiceResult } from "@/shared/types/service-result";

// ── Service ─────────────────────────────────────────────────────────────────

class DashboardService {
  async fetchBuyerDashboard(userId: string): Promise<
    ServiceResult<{
      user: DashboardUser;
      orders: BuyerOrderRow[];
      watchlist: WatchlistRow[];
      threads: ThreadRow[];
    }>
  > {
    const [dbUser, orders, watchlist, threads] = await Promise.all([
      userRepository.findForDashboard(userId),
      dashboardRepository.findBuyerOrders(userId),
      dashboardRepository.findBuyerWatchlist(userId),
      dashboardRepository.findUserThreads(userId),
    ]);

    if (!dbUser) return { ok: false, error: "User not found." };

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
        hasReview: o.reviews.length > 0,
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
      isPriceAlertEnabled: w.isPriceAlertEnabled,
    }));

    // Map threads
    const otherUserIds = threads.map((t) =>
      t.participant1Id === userId ? t.participant2Id : t.participant1Id,
    );
    const listingIds = threads
      .map((t) => t.listingId)
      .filter(Boolean) as string[];

    const [otherUsers, listings] = await Promise.all([
      userRepository.findManyByIds(otherUserIds),
      dashboardRepository.findListingsByIds(listingIds),
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
        (m) => m.senderId !== userId && !m.isRead,
      ).length;

      return {
        id: t.id,
        otherPartyId: otherId,
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
          isRead: m.isRead,
        })),
      };
    });

    return {
      ok: true,
      data: {
        user: mapDashboardUser(dbUser),
        orders: mappedOrders,
        watchlist: mappedWatchlist,
        threads: mappedThreads,
      },
    };
  }

  async fetchSellerDashboard(userId: string): Promise<
    ServiceResult<{
      user: DashboardUser;
      stats: SellerStatsRow;
      listings: SellerListingRow[];
      orders: SellerOrderRow[];
      payouts: SellerPayoutRow[];
    }>
  > {
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
      userRepository.findForDashboard(userId),
      dashboardRepository.aggregateCompletedOrders(userId),
      dashboardRepository.countRecentSales(userId, twelveMonthsAgo),
      dashboardRepository.countActiveListings(userId),
      dashboardRepository.countPendingOrders(userId),
      dashboardRepository.aggregateReviews(userId),
      dashboardRepository.aggregatePendingPayouts(userId),
      dashboardRepository.findSellerListings(userId),
      dashboardRepository.findSellerOrders(userId),
      dashboardRepository.findSellerPayouts(userId),
    ]);

    if (!dbUser) return { ok: false, error: "User not found." };

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
      isOffersEnabled: l.isOffersEnabled,
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
      ok: true,
      data: {
        user: mapDashboardUser(dbUser),
        stats,
        listings: mappedListings,
        orders: mappedOrders,
        payouts: mappedPayouts,
      },
    };
  }
}

export const dashboardService = new DashboardService();
