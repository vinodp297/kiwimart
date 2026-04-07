// src/test/listing.service.test.ts
// ─── Tests for ListingService & expireListings job ────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import db from "@/lib/db";
import { AppError } from "@/shared/errors";

// ── Additional mocks (beyond setup.ts) ───────────────────────────────────────

vi.mock("server-only", () => ({}));

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findForListingAuth: vi.fn(),
    findForAutoReview: vi.fn(),
    findDisplayName: vi.fn().mockResolvedValue("Test Seller"),
    findEmailInfo: vi.fn().mockResolvedValue({ displayName: "Test Seller" }),
  },
}));

vi.mock("@/server/services/listing-review/auto-review.service", () => ({
  runAutoReview: vi
    .fn()
    .mockResolvedValue({ verdict: "publish", score: 10, flags: [] }),
}));

vi.mock("@/lib/dynamic-lists", () => ({
  getKeywordLists: vi.fn().mockResolvedValue({ banned: [], risk: [] }),
  getListValues: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/notifications/notification.repository", () => ({
  notificationRepository: {
    notifyAdmins: vi.fn().mockResolvedValue(undefined),
  },
}));

// Override setup.ts email mock to include listing-specific email functions
vi.mock("@/server/email", () => ({
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendListingApprovedEmail: vi.fn().mockResolvedValue(undefined),
  sendListingRejectedEmail: vi.fn().mockResolvedValue(undefined),
  sendPriceDropEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Import mocked modules for vi.mocked() calls ───────────────────────────────

import { userRepository } from "@/modules/users/user.repository";
import { runAutoReview } from "@/server/services/listing-review/auto-review.service";
import { getKeywordLists } from "@/lib/dynamic-lists";
import { createNotification } from "@/modules/notifications/notification.service";
import { listingService } from "@/modules/listings/listing.service";
import { expireListings } from "@/server/jobs/expireListings";

// ── Patch missing db models not in setup.ts ───────────────────────────────────

const mockCategoryFindUnique = vi.fn();
const mockListingImageFindMany = vi.fn();
const mockListingImageUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockTrustMetricsFindUnique = vi.fn().mockResolvedValue(null);
const mockListingPriceHistoryCreate = vi.fn().mockResolvedValue({ id: "ph-1" });

const _db = db as Record<string, unknown>;
if (!_db.category) _db.category = { findUnique: mockCategoryFindUnique };
if (!_db.listingImage) {
  _db.listingImage = {
    findMany: mockListingImageFindMany,
    updateMany: mockListingImageUpdateMany,
  };
}
if (!_db.trustMetrics)
  _db.trustMetrics = { findUnique: mockTrustMetricsFindUnique };
if (!_db.listingPriceHistory) {
  _db.listingPriceHistory = { create: mockListingPriceHistoryCreate };
}

// ── Shared test data ──────────────────────────────────────────────────────────

const LISTING_ID = "listing-1";
const SELLER_ID = "seller-1";
const SELLER_EMAIL = "seller@test.com";

const validCreateInput = {
  title: "Test Listing",
  description: "A great item for sale",
  price: 29.99,
  isGstIncluded: false,
  condition: "GOOD",
  categoryId: "cat-1",
  subcategoryName: null as null,
  region: "Auckland",
  suburb: "Ponsonby",
  shippingOption: "PICKUP",
  shippingPrice: null as null,
  pickupAddress: "123 Test St",
  isOffersEnabled: true,
  isUrgent: false,
  isNegotiable: true,
  shipsNationwide: false,
  imageKeys: ["key-1", "key-2"],
  attributes: [{ label: "Colour", value: "Blue" }],
};

const verifiedUser = {
  emailVerified: new Date("2024-01-01"),
  sellerTermsAcceptedAt: new Date("2024-01-01"),
  isSellerEnabled: true,
  displayName: "Test Seller",
};

const validImages = [
  { id: "img-1", r2Key: "key-1", isScanned: true, isSafe: true },
  { id: "img-2", r2Key: "key-2", isScanned: true, isSafe: true },
];

// ── Helper: configure all mocks needed for a successful createListing call ────

function setupCreateMocks() {
  vi.mocked(userRepository.findForListingAuth).mockResolvedValue(
    verifiedUser as never,
  );
  vi.mocked(userRepository.findForAutoReview).mockResolvedValue(null);
  mockCategoryFindUnique.mockResolvedValue({ id: "cat-1" });
  mockListingImageFindMany.mockResolvedValue(validImages);
  mockTrustMetricsFindUnique.mockResolvedValue(null);
  vi.mocked(db.listing.count).mockResolvedValue(5);
  vi.mocked(db.listing.create).mockResolvedValue({ id: LISTING_ID } as never);
  vi.mocked(db.listing.update).mockResolvedValue({} as never);
  vi.mocked(runAutoReview).mockResolvedValue({
    verdict: "publish",
    score: 10,
    flags: [],
  });

  // Support both callback-form ($transaction(fn)) and array-form ($transaction([...]))
  vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) => {
    if (typeof fn === "function") {
      return (fn as (tx: typeof db) => Promise<unknown>)(db);
    }
    return [];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTING CREATION
// ─────────────────────────────────────────────────────────────────────────────

describe("ListingService - createListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore defaults cleared by clearAllMocks
    mockTrustMetricsFindUnique.mockResolvedValue(null);
    mockListingPriceHistoryCreate.mockResolvedValue({ id: "ph-1" });
    mockListingImageUpdateMany.mockResolvedValue({ count: 0 });
  });

  it("creates listing successfully when all conditions are met", async () => {
    setupCreateMocks();

    const result = await listingService.createListing(
      SELLER_ID,
      SELLER_EMAIL,
      true,
      validCreateInput,
      "127.0.0.1",
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.listingId).toBe(LISTING_ID);
    expect(db.listing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING_REVIEW",
          sellerId: SELLER_ID,
        }),
      }),
    );
  });

  it("fails when email is not verified", async () => {
    vi.mocked(userRepository.findForListingAuth).mockResolvedValue({
      ...verifiedUser,
      emailVerified: null,
    } as never);

    const result = await listingService.createListing(
      SELLER_ID,
      SELLER_EMAIL,
      true,
      validCreateInput,
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/verify your email/i);
    expect(db.listing.create).not.toHaveBeenCalled();
  });

  it("fails when seller terms are not accepted", async () => {
    vi.mocked(userRepository.findForListingAuth).mockResolvedValue({
      ...verifiedUser,
      sellerTermsAcceptedAt: null,
    } as never);

    const result = await listingService.createListing(
      SELLER_ID,
      SELLER_EMAIL,
      true,
      validCreateInput,
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/seller terms/i);
    expect(db.listing.create).not.toHaveBeenCalled();
  });

  it("fails when Stripe is not onboarded", async () => {
    vi.mocked(userRepository.findForListingAuth).mockResolvedValue(
      verifiedUser as never,
    );

    const result = await listingService.createListing(
      SELLER_ID,
      SELLER_EMAIL,
      false, // isStripeOnboarded = false
      validCreateInput,
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/payment account/i);
    expect(db.listing.create).not.toHaveBeenCalled();
  });

  it("fails when category does not exist", async () => {
    vi.mocked(userRepository.findForListingAuth).mockResolvedValue(
      verifiedUser as never,
    );
    mockCategoryFindUnique.mockResolvedValue(null);
    mockListingImageFindMany.mockResolvedValue(validImages);

    const result = await listingService.createListing(
      SELLER_ID,
      SELLER_EMAIL,
      true,
      validCreateInput,
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/invalid category/i);
    }
    expect(db.listing.create).not.toHaveBeenCalled();
  });

  it("fails when image keys are not found in the database", async () => {
    vi.mocked(userRepository.findForListingAuth).mockResolvedValue(
      verifiedUser as never,
    );
    mockCategoryFindUnique.mockResolvedValue({ id: "cat-1" });
    // Only return one image when two keys were provided
    mockListingImageFindMany.mockResolvedValue([
      { id: "img-1", r2Key: "key-1", isScanned: true, isSafe: true },
    ]);

    const result = await listingService.createListing(
      SELLER_ID,
      SELLER_EMAIL,
      true,
      validCreateInput,
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/photos/i);
    expect(db.listing.create).not.toHaveBeenCalled();
  });

  it("fails when images did not pass safety verification", async () => {
    vi.mocked(userRepository.findForListingAuth).mockResolvedValue(
      verifiedUser as never,
    );
    mockCategoryFindUnique.mockResolvedValue({ id: "cat-1" });
    mockListingImageFindMany.mockResolvedValue([
      { id: "img-1", r2Key: "key-1", isScanned: true, isSafe: false }, // unsafe
      { id: "img-2", r2Key: "key-2", isScanned: true, isSafe: true },
    ]);

    const result = await listingService.createListing(
      SELLER_ID,
      SELLER_EMAIL,
      true,
      validCreateInput,
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/photos/i);
    expect(db.listing.create).not.toHaveBeenCalled();
  });

  it("sets listing status to PENDING_REVIEW on creation before auto-review runs", async () => {
    setupCreateMocks();
    // Make auto-review queue it (not publish, not reject) to confirm the
    // initial creation status is PENDING_REVIEW regardless of review outcome
    vi.mocked(runAutoReview).mockResolvedValue({
      verdict: "queue",
      score: 55,
      flags: ["NEW_SELLER"],
    });

    await listingService.createListing(
      SELLER_ID,
      SELLER_EMAIL,
      true,
      validCreateInput,
      "127.0.0.1",
    );

    expect(db.listing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING_REVIEW" }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-REVIEW FLOW
// ─────────────────────────────────────────────────────────────────────────────

describe("ListingService - auto-review flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrustMetricsFindUnique.mockResolvedValue(null);
    mockListingPriceHistoryCreate.mockResolvedValue({ id: "ph-1" });
  });

  it("sets status to ACTIVE when auto-review verdict is publish", async () => {
    setupCreateMocks();
    vi.mocked(runAutoReview).mockResolvedValue({
      verdict: "publish",
      score: 5,
      flags: [],
    });

    const result = await listingService.createListing(
      SELLER_ID,
      SELLER_EMAIL,
      true,
      validCreateInput,
      "127.0.0.1",
    );

    expect(result.ok).toBe(true);
    expect(db.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LISTING_ID },
        data: expect.objectContaining({ status: "ACTIVE" }),
      }),
    );
  });

  it("sets status to REMOVED and returns ok:false when auto-review verdict is reject", async () => {
    setupCreateMocks();
    vi.mocked(runAutoReview).mockResolvedValue({
      verdict: "reject",
      score: 90,
      flags: ["PROHIBITED_KEYWORD"],
      rejectReason: "Prohibited content detected",
    });

    const result = await listingService.createListing(
      SELLER_ID,
      SELLER_EMAIL,
      true,
      validCreateInput,
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    expect(db.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LISTING_ID },
        data: expect.objectContaining({ status: "REMOVED" }),
      }),
    );
  });

  it("does not change status to ACTIVE when auto-review verdict is queue", async () => {
    setupCreateMocks();
    vi.mocked(runAutoReview).mockResolvedValue({
      verdict: "queue",
      score: 55,
      flags: ["NEW_SELLER"],
    });

    const result = await listingService.createListing(
      SELLER_ID,
      SELLER_EMAIL,
      true,
      validCreateInput,
      "127.0.0.1",
    );

    // Queued listings: service still returns ok:true (awaits manual review)
    expect(result.ok).toBe(true);
    // The update records the risk score but must NOT set status to ACTIVE
    const updateCalls = vi.mocked(db.listing.update).mock.calls;
    const setToActive = updateCalls.some(
      (call) =>
        (call[0] as { data?: Record<string, unknown> })?.data?.["status"] ===
        "ACTIVE",
    );
    expect(setToActive).toBe(false);
  });

  it("calls createNotification with LISTING_REJECTED type when review rejects", async () => {
    setupCreateMocks();
    vi.mocked(runAutoReview).mockResolvedValue({
      verdict: "reject",
      score: 90,
      flags: ["PROHIBITED_KEYWORD"],
      rejectReason: "Prohibited content detected",
    });

    await listingService.createListing(
      SELLER_ID,
      SELLER_EMAIL,
      true,
      validCreateInput,
      "127.0.0.1",
    );

    // createNotification is called synchronously inside Promise.all([ createNotification(...), ... ])
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: SELLER_ID,
        type: "LISTING_REJECTED",
        listingId: LISTING_ID,
      }),
    );
  });

  it("calls createNotification with LISTING_APPROVED type when review publishes", async () => {
    setupCreateMocks();
    vi.mocked(runAutoReview).mockResolvedValue({
      verdict: "publish",
      score: 5,
      flags: [],
    });

    await listingService.createListing(
      SELLER_ID,
      SELLER_EMAIL,
      true,
      validCreateInput,
      "127.0.0.1",
    );

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: SELLER_ID,
        type: "LISTING_APPROVED",
        listingId: LISTING_ID,
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LISTING UPDATES
// ─────────────────────────────────────────────────────────────────────────────

describe("ListingService - updateListing", () => {
  const existingActiveListing = {
    sellerId: SELLER_ID,
    priceNzd: 5000,
    deletedAt: null as null,
    title: "Old Title",
    description: "Old description about this item",
    categoryId: "cat-1",
    status: "ACTIVE",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTrustMetricsFindUnique.mockResolvedValue(null);
    mockListingPriceHistoryCreate.mockResolvedValue({ id: "ph-1" });
  });

  it("allows the listing owner to update their own listing", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValue(
      existingActiveListing as never,
    );
    vi.mocked(db.listing.update).mockResolvedValue({} as never);
    vi.mocked(getKeywordLists).mockResolvedValue({ banned: [], risk: [] });

    const result = await listingService.updateListing(
      SELLER_ID,
      SELLER_EMAIL,
      false,
      {
        listingId: LISTING_ID,
        title: "New Title",
      },
    );

    expect(result.ok).toBe(true);
    expect(db.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: LISTING_ID } }),
    );
  });

  it("returns not-authorised error when non-owner attempts update", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValue(
      existingActiveListing as never,
    );

    const result = await listingService.updateListing(
      "intruder-id",
      SELLER_EMAIL,
      false,
      {
        listingId: LISTING_ID,
        title: "Hijacked Title",
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not authorised/i);
    expect(db.listing.update).not.toHaveBeenCalled();
  });

  it("returns not-found error when listing does not exist", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValue(null);

    const result = await listingService.updateListing(
      SELLER_ID,
      SELLER_EMAIL,
      false,
      {
        listingId: "nonexistent-id",
        title: "New Title",
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/i);
  });

  it("records price history when price is reduced", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValue(
      existingActiveListing as never,
    );
    vi.mocked(db.listing.update).mockResolvedValue({} as never);
    vi.mocked(getKeywordLists).mockResolvedValue({ banned: [], risk: [] });

    await listingService.updateListing(SELLER_ID, SELLER_EMAIL, false, {
      listingId: LISTING_ID,
      price: 30.0, // 3000 cents — lower than existing 5000
    });

    // createPriceHistory is fire-and-forget; the mock call happens synchronously
    expect(mockListingPriceHistoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          listingId: LISTING_ID,
          priceNzd: 3000,
        }),
      }),
    );
  });

  it("removes listing and returns error when banned keyword found in updated content", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValue(
      existingActiveListing as never,
    );
    vi.mocked(db.listing.update).mockResolvedValue({} as never);
    vi.mocked(getKeywordLists).mockResolvedValue({
      banned: ["prohibited"],
      risk: [],
    });
    vi.mocked(userRepository.findEmailInfo).mockResolvedValue({
      displayName: "Test Seller",
    } as never);

    const result = await listingService.updateListing(
      SELLER_ID,
      SELLER_EMAIL,
      false,
      {
        listingId: LISTING_ID,
        title: "This item is prohibited and illegal",
      },
    );

    expect(result.ok).toBe(false);
    expect(db.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LISTING_ID },
        data: expect.objectContaining({ status: "REMOVED" }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LISTING EXPIRY JOB
// ─────────────────────────────────────────────────────────────────────────────

describe("expireListings job", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls updateMany to expire ACTIVE listings whose expiresAt has passed", async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 3 } as never);

    await expireListings();

    expect(db.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "ACTIVE",
          expiresAt: expect.objectContaining({ lt: expect.any(Date) }),
          deletedAt: null,
        }),
        data: { status: "EXPIRED" },
      }),
    );
  });

  it("returns the correct count of expired listings", async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 7 } as never);

    const result = await expireListings();

    expect(result.expired).toBe(7);
    expect(result.errors).toBe(0);
  });

  it("returns zero when no listings have passed their expiresAt", async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 0 } as never);

    const result = await expireListings();

    expect(result.expired).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("returns error count when the database throws", async () => {
    vi.mocked(db.listing.updateMany).mockRejectedValue(
      new Error("DB connection lost"),
    );

    const result = await expireListings();

    expect(result.errors).toBe(1);
    expect(result.expired).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE LISTING
// ─────────────────────────────────────────────────────────────────────────────

describe("ListingService - deleteListing", () => {
  const mockListing = {
    id: "listing-1",
    sellerId: "seller-1",
    status: "ACTIVE",
    title: "Test Item",
  };

  beforeEach(() => vi.clearAllMocks());

  it("soft-deletes a listing owned by the requesting user", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never);
    vi.mocked(db.listing.update).mockResolvedValue({} as never);

    await listingService.deleteListing("listing-1", "seller-1", false);

    expect(db.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "listing-1" },
        data: expect.objectContaining({ status: "REMOVED" }),
      }),
    );
  });

  it("allows an admin to delete any listing regardless of ownership", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never);
    vi.mocked(db.listing.update).mockResolvedValue({} as never);

    await listingService.deleteListing("listing-1", "admin-user-id", true);

    expect(db.listing.update).toHaveBeenCalled();
  });

  it("throws when a non-owner non-admin attempts to delete", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never);

    await expect(
      listingService.deleteListing("listing-1", "wrong-user", false),
    ).rejects.toThrow("permission");
  });

  it("throws when attempting to delete a SOLD listing", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValue({
      ...mockListing,
      status: "SOLD",
    } as never);

    await expect(
      listingService.deleteListing("listing-1", "seller-1", false),
    ).rejects.toThrow("Sold listings");
  });

  it("throws NOT_FOUND when listing does not exist", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValue(null);

    await expect(
      listingService.deleteListing("nonexistent", "seller-1", false),
    ).rejects.toThrow(AppError);
  });

  it("throws validation error when listing ID is empty", async () => {
    await expect(
      listingService.deleteListing("", "seller-1", false),
    ).rejects.toThrow("Invalid listing ID");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE WATCH
// ─────────────────────────────────────────────────────────────────────────────

describe("ListingService - toggleWatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds listing to watchlist and returns watching:true when not already watching", async () => {
    vi.mocked(db.watchlistItem.findUnique).mockResolvedValue(null);
    vi.mocked(db.listing.findUnique).mockResolvedValue({
      id: "listing-1",
      sellerId: "other-seller",
    } as never);
    vi.mocked(db.$transaction).mockResolvedValue([] as never);

    const result = await listingService.toggleWatch("listing-1", "user-1");

    expect(result.watching).toBe(true);
  });

  it("removes listing from watchlist and returns watching:false when already watching", async () => {
    vi.mocked(db.watchlistItem.findUnique).mockResolvedValue({
      userId: "user-1",
      listingId: "listing-1",
    } as never);
    vi.mocked(db.$transaction).mockResolvedValue([] as never);

    const result = await listingService.toggleWatch("listing-1", "user-1");

    expect(result.watching).toBe(false);
  });

  it("throws NOT_FOUND when the listing does not exist", async () => {
    vi.mocked(db.watchlistItem.findUnique).mockResolvedValue(null);
    vi.mocked(db.listing.findUnique).mockResolvedValue(null);

    await expect(
      listingService.toggleWatch("nonexistent", "user-1"),
    ).rejects.toThrow(AppError);
  });

  it("throws INVALID_OPERATION when a seller tries to watch their own listing", async () => {
    vi.mocked(db.watchlistItem.findUnique).mockResolvedValue(null);
    vi.mocked(db.listing.findUnique).mockResolvedValue({
      id: "listing-1",
      sellerId: "user-1", // same as userId passed below
    } as never);

    await expect(
      listingService.toggleWatch("listing-1", "user-1"),
    ).rejects.toThrow("own listing");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET LISTING BY ID
// ─────────────────────────────────────────────────────────────────────────────

describe("ListingService - getListingById", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns listing with seller info when found", async () => {
    const mockListing = {
      id: "listing-1",
      title: "Test Item",
      seller: { id: "seller-1", displayName: "Great Seller" },
      images: [],
      attrs: [],
    };
    vi.mocked(db.listing.findUnique).mockResolvedValue(mockListing as never);
    vi.mocked(db.listing.update).mockResolvedValue({} as never);

    const result = await listingService.getListingById("listing-1");

    expect(result).toBeTruthy();
    expect(result!.id).toBe("listing-1");
    expect(result!.title).toBe("Test Item");
  });

  it("returns null for an expired or missing listing (status filter excludes EXPIRED)", async () => {
    // findByIdWithSellerAndImages only returns ACTIVE/RESERVED/SOLD — expired returns null
    vi.mocked(db.listing.findUnique).mockResolvedValue(null);

    const result = await listingService.getListingById("expired-listing");

    expect(result).toBeNull();
  });
});
