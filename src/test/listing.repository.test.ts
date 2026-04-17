// src/test/listing.repository.test.ts
// ─── Tests: listingRepository (barrel + query + mutation) ────────────────────
// Covers the mutation repo (soft-delete, reserve/release, watcher add/remove,
// price history, moderation actions, sitemap helpers) and a representative
// set of query methods (findByIdForPurchase, findWatchlistItem, countActive,
// groupByCategory, countByVector raw-SQL, sitemap helpers).
//
// The goal is coverage — every branch on the write path plus the non-trivial
// query paths. Each test asserts (1) the method was forwarded to the right
// Prisma client, (2) with the right where/data shape, and (3) returns the
// value the mock resolves with.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import db from "@/lib/db";

// ── Patch missing db models not in setup.ts ──────────────────────────────────
// Pattern follows listing.service.test.ts — only add what's not already there.
const mockListingGroupBy = vi.fn().mockResolvedValue([]);
const mockListingImageFindMany = vi.fn().mockResolvedValue([]);
const mockListingImageUpdate = vi.fn().mockResolvedValue({});
const mockListingImageUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockListingPriceHistoryFindMany = vi.fn().mockResolvedValue([]);
const mockListingPriceHistoryCreate = vi
  .fn()
  .mockResolvedValue({ id: "price-history-1" });
const mockTrustMetricsFindUnique = vi.fn().mockResolvedValue(null);
const mockCategoryFindUnique = vi.fn().mockResolvedValue(null);

const _db = db as unknown as Record<string, unknown>;
(_db.listing as { groupBy?: unknown }).groupBy = mockListingGroupBy;
if (!_db.listingImage) {
  _db.listingImage = {
    findMany: mockListingImageFindMany,
    update: mockListingImageUpdate,
    updateMany: mockListingImageUpdateMany,
  };
}
if (!_db.listingPriceHistory) {
  _db.listingPriceHistory = {
    findMany: mockListingPriceHistoryFindMany,
    create: mockListingPriceHistoryCreate,
  };
}
if (!_db.trustMetrics)
  _db.trustMetrics = { findUnique: mockTrustMetricsFindUnique };
if (!_db.category) _db.category = { findUnique: mockCategoryFindUnique };

// Lazy import — lets the setup.ts mock shim attach first.
const { listingRepository, getSitemapListings, getSitemapSellers } =
  await import("@/modules/listings/listing.repository");

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// Barrel sanity
// ═══════════════════════════════════════════════════════════════════════════

describe("listingRepository (barrel)", () => {
  it("merges mutation + query methods into a single facade", () => {
    // Spot-check one from each side.
    expect(typeof listingRepository.softDelete).toBe("function");
    expect(typeof listingRepository.findByIdActive).toBe("function");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION — listing lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe("listingMutationRepository.softDelete", () => {
  it("sets deletedAt + status=REMOVED", async () => {
    vi.mocked(db.listing.update).mockResolvedValue({ id: "l_1" } as never);

    await listingRepository.softDelete("l_1");

    expect(db.listing.update).toHaveBeenCalledWith({
      where: { id: "l_1" },
      data: expect.objectContaining({
        deletedAt: expect.any(Date),
        status: "REMOVED",
      }),
    });
  });

  it("uses tx client when transaction is passed", async () => {
    const tx = { listing: { update: vi.fn().mockResolvedValue({}) } };

    await listingRepository.softDelete("l_1", tx as never);

    expect(tx.listing.update).toHaveBeenCalled();
    expect(db.listing.update).not.toHaveBeenCalled();
  });
});

describe("listingMutationRepository.markSold", () => {
  it("sets status=SOLD and soldAt timestamp", async () => {
    vi.mocked(db.listing.update).mockResolvedValue({} as never);

    await listingRepository.markSold("l_1");

    expect(db.listing.update).toHaveBeenCalledWith({
      where: { id: "l_1" },
      data: expect.objectContaining({
        status: "SOLD",
        soldAt: expect.any(Date),
      }),
    });
  });
});

describe("listingMutationRepository.reserveAtomically", () => {
  it("only reserves listings currently in ACTIVE status", async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValueOnce({
      count: 1,
    } as never);

    const result = await listingRepository.reserveAtomically("l_1");

    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: { id: "l_1", status: "ACTIVE" },
      data: { status: "RESERVED" },
    });
    expect(result).toEqual({ count: 1 });
  });

  it("returns count:0 when listing is not ACTIVE (contention / already reserved)", async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValueOnce({
      count: 0,
    } as never);

    const result = await listingRepository.reserveAtomically("l_1");

    expect(result.count).toBe(0);
  });
});

describe("listingMutationRepository.releaseReservation", () => {
  it("only releases listings currently in RESERVED status", async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValueOnce({
      count: 1,
    } as never);

    await listingRepository.releaseReservation("l_1");

    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: { id: "l_1", status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
  });
});

describe("listingMutationRepository.releaseStaleReservations", () => {
  it("filters by reservedUntil < now", async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValueOnce({
      count: 3,
    } as never);
    const now = new Date("2026-01-15T00:00:00Z");

    const result = await listingRepository.releaseStaleReservations(now);

    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: {
        status: "RESERVED",
        reservedUntil: { lt: now },
      },
      data: { status: "ACTIVE", reservedUntil: null },
    });
    expect(result).toEqual({ count: 3 });
  });
});

describe("listingMutationRepository.expireActivePast", () => {
  it("only targets ACTIVE non-deleted listings past expiry", async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValueOnce({
      count: 4,
    } as never);
    const now = new Date();

    await listingRepository.expireActivePast(now);

    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: {
        status: "ACTIVE",
        expiresAt: { lt: now },
        deletedAt: null,
      },
      data: { status: "EXPIRED" },
    });
  });
});

describe("listingMutationRepository.bulkReleaseFromReserved", () => {
  it("forwards the id set and filters by RESERVED status", async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValueOnce({
      count: 2,
    } as never);

    await listingRepository.bulkReleaseFromReserved(["l_1", "l_2"]);

    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["l_1", "l_2"] }, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
  });
});

describe("listingMutationRepository.restoreFromSold", () => {
  it("flips SOLD back to ACTIVE", async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValueOnce({
      count: 1,
    } as never);

    await listingRepository.restoreFromSold("l_1");

    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: { id: "l_1", status: "SOLD" },
      data: { status: "ACTIVE" },
    });
  });
});

describe("listingMutationRepository.updateListingOptimistic", () => {
  it("matches on updatedAt and sets a new updatedAt atomically", async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValueOnce({
      count: 1,
    } as never);
    const expected = new Date("2026-01-01T00:00:00Z");

    await listingRepository.updateListingOptimistic(
      "l_1",
      { priceNzd: 9900 },
      expected,
    );

    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: { id: "l_1", updatedAt: expected },
      data: expect.objectContaining({
        priceNzd: 9900,
        updatedAt: expect.any(Date),
      }),
    });
  });

  it("returns count:0 when the row was updated by someone else", async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValueOnce({
      count: 0,
    } as never);

    const result = await listingRepository.updateListingOptimistic(
      "l_1",
      { priceNzd: 9900 },
      new Date(),
    );

    expect(result.count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION — watchlist
// ═══════════════════════════════════════════════════════════════════════════

describe("listingMutationRepository.addWatch / removeWatch", () => {
  it("addWatch: creates watchlistItem and bumps watcherCount in one txn", async () => {
    vi.mocked(db.$transaction).mockResolvedValueOnce([] as never);

    await listingRepository.addWatch("user_1", "l_1");

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    // $transaction was called with an array of two prisma promises — we just
    // verify the shape (Array) because the individual promises are already set up.
    expect(vi.mocked(db.$transaction).mock.calls[0]?.[0]).toBeInstanceOf(Array);
  });

  it("removeWatch: deletes watchlistItem and decrements watcherCount in one txn", async () => {
    vi.mocked(db.$transaction).mockResolvedValueOnce([] as never);

    await listingRepository.removeWatch("user_1", "l_1");

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.$transaction).mock.calls[0]?.[0]).toBeInstanceOf(Array);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION — moderation
// ═══════════════════════════════════════════════════════════════════════════

describe("listingMutationRepository.approveListing", () => {
  it("sets status ACTIVE, publishedAt, 30-day expiry, admin id", async () => {
    vi.mocked(db.listing.update).mockResolvedValue({} as never);
    const before = Date.now();

    await listingRepository.approveListing("l_1", "admin_1");

    const data = vi.mocked(db.listing.update).mock.calls[0]?.[0]?.data as {
      status: string;
      publishedAt: Date;
      expiresAt: Date;
      moderatedBy: string;
      moderationNote: null;
    };
    expect(data.status).toBe("ACTIVE");
    expect(data.moderatedBy).toBe("admin_1");
    expect(data.moderationNote).toBeNull();
    // 30 days in the future ± 5s
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + thirtyDaysMs - 5000,
    );
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(
      before + thirtyDaysMs + 5000,
    );
  });
});

describe("listingMutationRepository.requestChanges", () => {
  it("sets status NEEDS_CHANGES + stores note", async () => {
    vi.mocked(db.listing.update).mockResolvedValue({} as never);

    await listingRepository.requestChanges(
      "l_1",
      "admin_1",
      "Please add clearer photos",
    );

    expect(db.listing.update).toHaveBeenCalledWith({
      where: { id: "l_1" },
      data: expect.objectContaining({
        status: "NEEDS_CHANGES",
        moderatedBy: "admin_1",
        moderationNote: "Please add clearer photos",
      }),
    });
  });
});

describe("listingMutationRepository.rejectListing", () => {
  it("sets status REMOVED + stores reason", async () => {
    vi.mocked(db.listing.update).mockResolvedValue({} as never);

    await listingRepository.rejectListing("l_1", "admin_1", "Prohibited item");

    expect(db.listing.update).toHaveBeenCalledWith({
      where: { id: "l_1" },
      data: expect.objectContaining({
        status: "REMOVED",
        moderatedBy: "admin_1",
        moderationNote: "Prohibited item",
      }),
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION — images
// ═══════════════════════════════════════════════════════════════════════════

describe("listingMutationRepository.associateImageByKey", () => {
  it("attaches an image to a listing by r2Key with an order", async () => {
    mockListingImageUpdateMany.mockResolvedValueOnce({ count: 1 });

    await listingRepository.associateImageByKey("r2/abc.jpg", "l_1", 2);

    expect(mockListingImageUpdateMany).toHaveBeenCalledWith({
      where: { r2Key: "r2/abc.jpg" },
      data: { listingId: "l_1", order: 2 },
    });
  });
});

describe("listingMutationRepository.disconnectDraftImages", () => {
  it("clears listingId on all images for the listing", async () => {
    mockListingImageUpdateMany.mockResolvedValueOnce({ count: 3 });

    await listingRepository.disconnectDraftImages("l_1");

    expect(mockListingImageUpdateMany).toHaveBeenCalledWith({
      where: { listingId: "l_1" },
      data: { listingId: null },
    });
  });
});

describe("listingMutationRepository.reorderImages", () => {
  it("updates each image's order in parallel", async () => {
    mockListingImageUpdate.mockResolvedValue({});

    await listingRepository.reorderImages("l_1", ["img_a", "img_b", "img_c"]);

    expect(mockListingImageUpdate).toHaveBeenCalledTimes(3);
    expect(mockListingImageUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: "img_a" },
      data: { order: 0 },
    });
    expect(mockListingImageUpdate).toHaveBeenNthCalledWith(3, {
      where: { id: "img_c" },
      data: { order: 2 },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION — seller enablement
// ═══════════════════════════════════════════════════════════════════════════

describe("listingMutationRepository.enableSeller", () => {
  it("flips the user's isSellerEnabled to true", async () => {
    vi.mocked(db.user.update).mockResolvedValue({} as never);

    await listingRepository.enableSeller("user_1");

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { isSellerEnabled: true },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY — id-based lookups
// ═══════════════════════════════════════════════════════════════════════════

describe("listingQueryRepository.findByIdActive", () => {
  it("filters by status=ACTIVE and deletedAt=null", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValueOnce({
      id: "l_1",
      sellerId: "s_1",
    } as never);

    const result = await listingRepository.findByIdActive("l_1");

    expect(db.listing.findUnique).toHaveBeenCalledWith({
      where: { id: "l_1", status: "ACTIVE", deletedAt: null },
      select: { id: true, sellerId: true },
    });
    expect(result).toEqual({ id: "l_1", sellerId: "s_1" });
  });
});

describe("listingQueryRepository.findByIdForPurchase", () => {
  it("returns minimal purchase-time fields", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValueOnce({
      id: "l_1",
      sellerId: "s_1",
      status: "ACTIVE",
      priceNzd: 5000,
      shippingNzd: 500,
      shippingOption: "NATIONWIDE",
      title: "Chair",
      deletedAt: null,
    } as never);

    const result = await listingRepository.findByIdForPurchase("l_1");

    expect(db.listing.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "l_1" },
        select: expect.objectContaining({
          priceNzd: true,
          shippingNzd: true,
        }),
      }),
    );
    expect(result?.priceNzd).toBe(5000);
  });
});

describe("listingQueryRepository.findForOffer", () => {
  it("filters by ACTIVE + not deleted", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValueOnce(null as never);

    await listingRepository.findForOffer("l_1");

    expect(db.listing.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "l_1", status: "ACTIVE", deletedAt: null },
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY — watchlist
// ═══════════════════════════════════════════════════════════════════════════

describe("listingQueryRepository.findWatchlistItem", () => {
  it("looks up by composite userId_listingId", async () => {
    vi.mocked(db.watchlistItem.findUnique).mockResolvedValueOnce({
      userId: "user_1",
      listingId: "l_1",
    } as never);

    const result = await listingRepository.findWatchlistItem("user_1", "l_1");

    expect(db.watchlistItem.findUnique).toHaveBeenCalledWith({
      where: { userId_listingId: { userId: "user_1", listingId: "l_1" } },
    });
    expect(result?.listingId).toBe("l_1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY — counts / aggregates
// ═══════════════════════════════════════════════════════════════════════════

describe("listingQueryRepository.countActive", () => {
  it("counts only ACTIVE non-deleted listings", async () => {
    vi.mocked(db.listing.count).mockResolvedValueOnce(42 as never);

    const count = await listingRepository.countActive();

    expect(db.listing.count).toHaveBeenCalledWith({
      where: { status: "ACTIVE", deletedAt: null },
    });
    expect(count).toBe(42);
  });
});

describe("listingQueryRepository.groupByCategory", () => {
  it("returns categoryId + count pairs", async () => {
    mockListingGroupBy.mockResolvedValueOnce([
      { categoryId: "cat_a", _count: { id: 5 } },
      { categoryId: "cat_b", _count: { id: 3 } },
    ]);

    const result = await listingRepository.groupByCategory();

    expect(result).toEqual([
      { categoryId: "cat_a", count: 5 },
      { categoryId: "cat_b", count: 3 },
    ]);
  });

  it("defaults count to 0 when _count is missing", async () => {
    mockListingGroupBy.mockResolvedValueOnce([{ categoryId: "cat_x" }]);

    const result = await listingRepository.groupByCategory();

    expect(result).toEqual([{ categoryId: "cat_x", count: 0 }]);
  });
});

describe("listingQueryRepository.countBySeller", () => {
  it("only counts ACTIVE non-deleted listings for the seller", async () => {
    vi.mocked(db.listing.count).mockResolvedValueOnce(7 as never);

    const count = await listingRepository.countBySeller("seller_1");

    expect(db.listing.count).toHaveBeenCalledWith({
      where: { sellerId: "seller_1", status: "ACTIVE", deletedAt: null },
    });
    expect(count).toBe(7);
  });
});

describe("listingQueryRepository.countByExactTitle", () => {
  it("matches exact title for the seller", async () => {
    vi.mocked(db.listing.count).mockResolvedValueOnce(1 as never);

    await listingRepository.countByExactTitle("s_1", "Vintage Chair");

    expect(db.listing.count).toHaveBeenCalledWith({
      where: { sellerId: "s_1", title: "Vintage Chair", deletedAt: null },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY — raw SQL
// ═══════════════════════════════════════════════════════════════════════════

describe("listingQueryRepository.searchByVector / countByVector", () => {
  it("searchByVector passes query + pagination via $queryRaw", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValueOnce([
      { id: "l_1" },
      { id: "l_2" },
    ] as never);

    const result = await listingRepository.searchByVector("chairs", 0, 10);

    expect(db.$queryRaw).toHaveBeenCalled();
    expect(result).toEqual([{ id: "l_1" }, { id: "l_2" }]);
  });

  it("countByVector coerces BigInt count to number", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValueOnce([
      { count: BigInt(42) },
    ] as never);

    const count = await listingRepository.countByVector("chairs");

    expect(count).toBe(42);
  });

  it("countByVector returns 0 when result is empty", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValueOnce([] as never);

    const count = await listingRepository.countByVector("zzzzzz");

    expect(count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY — sitemap helpers (module-level exports)
// ═══════════════════════════════════════════════════════════════════════════

describe("getSitemapListings", () => {
  it("returns ACTIVE non-deleted listings, watched-count ordered, capped at 1000", async () => {
    vi.mocked(db.listing.findMany).mockResolvedValueOnce([
      { id: "l_1", updatedAt: new Date() },
    ] as never);

    await getSitemapListings();

    expect(db.listing.findMany).toHaveBeenCalledWith({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, updatedAt: true },
      orderBy: { watcherCount: "desc" },
      take: 1000,
    });
  });
});

describe("getSitemapSellers", () => {
  it("returns enabled, non-banned seller usernames", async () => {
    vi.mocked(db.user.findMany).mockResolvedValueOnce([
      { username: "alice42", updatedAt: new Date() },
    ] as never);

    await getSitemapSellers();

    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { isSellerEnabled: true, isBanned: false },
      select: { username: true, updatedAt: true },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY — browse with cursor
// ═══════════════════════════════════════════════════════════════════════════

describe("listingQueryRepository.findBrowseListings", () => {
  it("returns hasMore=true and slices off the probe item when limit is reached", async () => {
    // limit=2 means findMany returns take=3 rows
    vi.mocked(db.listing.findMany).mockResolvedValueOnce([
      { id: "l_1" },
      { id: "l_2" },
      { id: "l_3" },
    ] as never);

    const result = await listingRepository.findBrowseListings({ limit: 2 });

    expect(result.listings).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("l_2");
  });

  it("returns hasMore=false and no nextCursor when result fits in limit", async () => {
    vi.mocked(db.listing.findMany).mockResolvedValueOnce([
      { id: "l_1" },
    ] as never);

    const result = await listingRepository.findBrowseListings({ limit: 10 });

    expect(result.listings).toHaveLength(1);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("applies cursor + skip when cursor is provided", async () => {
    vi.mocked(db.listing.findMany).mockResolvedValueOnce([] as never);

    await listingRepository.findBrowseListings({
      limit: 10,
      cursor: "l_prev",
    });

    expect(db.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "l_prev" },
        skip: 1,
      }),
    );
  });

  it("applies q text search across title + description (insensitive)", async () => {
    vi.mocked(db.listing.findMany).mockResolvedValueOnce([] as never);

    await listingRepository.findBrowseListings({ q: "chair", limit: 10 });

    const whereArg = vi.mocked(db.listing.findMany).mock.calls[0]?.[0]
      ?.where as { OR?: unknown[] };
    expect(whereArg.OR).toBeTruthy();
    expect(whereArg.OR?.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY — moderation queue
// ═══════════════════════════════════════════════════════════════════════════

describe("listingQueryRepository.findPendingReview", () => {
  it("orders by autoRiskScore desc then createdAt asc", async () => {
    vi.mocked(db.listing.findMany).mockResolvedValueOnce([] as never);

    await listingRepository.findPendingReview();

    expect(db.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "PENDING_REVIEW", deletedAt: null },
        orderBy: [{ autoRiskScore: "desc" }, { createdAt: "asc" }],
      }),
    );
  });
});

describe("listingQueryRepository.countPendingReview", () => {
  it("counts PENDING_REVIEW non-deleted listings", async () => {
    vi.mocked(db.listing.count).mockResolvedValueOnce(5 as never);

    const count = await listingRepository.countPendingReview();

    expect(db.listing.count).toHaveBeenCalledWith({
      where: { status: "PENDING_REVIEW", deletedAt: null },
    });
    expect(count).toBe(5);
  });
});

describe("listingQueryRepository.countApprovedToday", () => {
  it("filters by moderatedAt OR publishedAt within last 24h", async () => {
    vi.mocked(db.listing.count).mockResolvedValueOnce(3 as never);

    await listingRepository.countApprovedToday();

    const call = vi.mocked(db.listing.count).mock.calls[0]?.[0];
    expect(call?.where).toMatchObject({
      status: "ACTIVE",
      deletedAt: null,
    });
    expect((call?.where as { OR: unknown[] }).OR).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY — duplicate detection + seller counts
// ═══════════════════════════════════════════════════════════════════════════

describe("listingQueryRepository.findRecentDuplicateBySeller", () => {
  it("filters by title prefix (case insensitive), excludes self, recent window", async () => {
    vi.mocked(db.listing.findFirst).mockResolvedValueOnce({
      id: "dup_1",
    } as never);
    const since = new Date("2026-01-01");

    const result = await listingRepository.findRecentDuplicateBySeller({
      sellerId: "s_1",
      excludeListingId: "l_1",
      titlePrefix: "vintage",
      since,
    });

    expect(db.listing.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        sellerId: "s_1",
        id: { not: "l_1" },
        title: { startsWith: "vintage", mode: "insensitive" },
        status: { notIn: ["REMOVED"] },
        createdAt: { gte: since },
        deletedAt: null,
      }),
      select: { id: true },
    });
    expect(result).toEqual({ id: "dup_1" });
  });
});

describe("listingQueryRepository.countActiveSlotsForSellerExcluding", () => {
  it("counts ACTIVE + PENDING_REVIEW + NEEDS_CHANGES excluding self", async () => {
    vi.mocked(db.listing.count).mockResolvedValueOnce(2 as never);

    const count = await listingRepository.countActiveSlotsForSellerExcluding(
      "s_1",
      "l_1",
    );

    expect(db.listing.count).toHaveBeenCalledWith({
      where: {
        sellerId: "s_1",
        id: { not: "l_1" },
        status: { in: ["ACTIVE", "PENDING_REVIEW", "NEEDS_CHANGES"] },
        deletedAt: null,
      },
    });
    expect(count).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY — trust metrics + misc
// ═══════════════════════════════════════════════════════════════════════════

describe("listingQueryRepository.findTrustMetrics", () => {
  it("returns user's fraud/dispute flags", async () => {
    mockTrustMetricsFindUnique.mockResolvedValueOnce({
      isFlaggedForFraud: false,
      disputeRate: 0,
    });

    const result = await listingRepository.findTrustMetrics("user_1");

    expect(mockTrustMetricsFindUnique).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      select: { isFlaggedForFraud: true, disputeRate: true },
    });
    expect(result?.isFlaggedForFraud).toBe(false);
  });
});

describe("listingQueryRepository.findCategoryById", () => {
  it("looks up a category by id with only the id field selected", async () => {
    mockCategoryFindUnique.mockResolvedValueOnce({ id: "cat_1" });

    const result = await listingRepository.findCategoryById("cat_1");

    expect(mockCategoryFindUnique).toHaveBeenCalledWith({
      where: { id: "cat_1" },
      select: { id: true },
    });
    expect(result).toEqual({ id: "cat_1" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY — listing images
// ═══════════════════════════════════════════════════════════════════════════

describe("listingQueryRepository.findImagesByListingId", () => {
  it("fetches the image set for a listing with moderation metadata", async () => {
    mockListingImageFindMany.mockResolvedValueOnce([
      { id: "img_1", r2Key: "a.jpg", isSafe: true, isScanned: true, order: 0 },
    ]);

    const result = await listingRepository.findImagesByListingId("l_1");

    expect(mockListingImageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { listingId: "l_1" },
        select: expect.objectContaining({ r2Key: true, isSafe: true }),
      }),
    );
    expect(result).toHaveLength(1);
  });
});

describe("listingQueryRepository.findImagesByKeys", () => {
  it("batch-fetches images by r2Key set", async () => {
    mockListingImageFindMany.mockResolvedValueOnce([]);

    await listingRepository.findImagesByKeys(["a.jpg", "b.jpg"]);

    expect(mockListingImageFindMany).toHaveBeenCalledWith({
      where: { r2Key: { in: ["a.jpg", "b.jpg"] } },
      select: { id: true, r2Key: true, isScanned: true, isSafe: true },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY — social proof + history
// ═══════════════════════════════════════════════════════════════════════════

describe("listingQueryRepository.findSocialProofCounts", () => {
  it("returns viewCount + watcher count", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValueOnce({
      viewCount: 120,
      _count: { watchers: 8 },
    } as never);

    const result = await listingRepository.findSocialProofCounts("l_1");

    expect(result?.viewCount).toBe(120);
    expect(result?._count.watchers).toBe(8);
  });
});

describe("listingQueryRepository.findPriceHistory", () => {
  it("returns up to 50 price-history rows ordered ascending", async () => {
    mockListingPriceHistoryFindMany.mockResolvedValueOnce([
      { priceNzd: 5000, changedAt: new Date() },
    ]);

    await listingRepository.findPriceHistory("l_1");

    expect(mockListingPriceHistoryFindMany).toHaveBeenCalledWith({
      where: { listingId: "l_1" },
      orderBy: { changedAt: "asc" },
      take: 50,
      select: { priceNzd: true, changedAt: true },
    });
  });
});
