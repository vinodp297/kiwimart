// src/test/optimistic-locking.test.ts
// ─── Tests: Optimistic locking for Listing and Offer concurrent writes ────────
// Covers:
//   Listing:
//     1. Update with matching updatedAt succeeds
//     2. Update with stale updatedAt (concurrent write) → 409 CONCURRENT_MODIFICATION
//     3. Update on a listing that disappears after initial read → 404 NOT_FOUND
//   Offer:
//     4. Accept PENDING offer succeeds
//     5. Accept already-ACCEPTED offer → 409 CONCURRENT_MODIFICATION
//     6. Accept already-DECLINED offer → 409 CONCURRENT_MODIFICATION
//     7. Race: both requests see PENDING, only the winner's updateMany returns
//        count=1; loser's updateMany returns count=0 → 409 CONCURRENT_MODIFICATION

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import db from "@/lib/db";
import { AppError } from "@/shared/errors";

// ── Additional mocks for ListingService ──────────────────────────────────────

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

vi.mock("@/server/email", () => ({
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendListingApprovedEmail: vi.fn().mockResolvedValue(undefined),
  sendListingRejectedEmail: vi.fn().mockResolvedValue(undefined),
  sendPriceDropEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { listingService } from "@/modules/listings/listing.service";
import { offerService } from "@/modules/offers/offer.service";
import { getKeywordLists } from "@/lib/dynamic-lists";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const SELLER_ID = "seller-1";
const LISTING_ID = "listing-1";
const KNOWN_UPDATED_AT = new Date("2025-06-01T12:00:00.000Z");

const existingListing = {
  sellerId: SELLER_ID,
  priceNzd: 10000,
  deletedAt: null as null,
  title: "Vintage Camera",
  description: "Great condition film camera",
  categoryId: "cat-cameras",
  status: "ACTIVE",
  updatedAt: KNOWN_UPDATED_AT,
};

const pendingOffer = {
  id: "offer-1",
  sellerId: SELLER_ID,
  buyerId: "buyer-1",
  status: "PENDING",
  listingId: LISTING_ID,
  amountNzd: 8000,
  expiresAt: new Date(Date.now() + 86_400_000), // tomorrow
  buyer: { email: "buyer@test.com", displayName: "Buyer" },
  listing: { id: LISTING_ID, title: "Vintage Camera" },
};

// ─── Listing optimistic locking ───────────────────────────────────────────────

describe("Listing — optimistic locking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getKeywordLists).mockResolvedValue({ banned: [], risk: [] });
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  it("succeeds when the listing has not been modified since last fetch", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValue(
      existingListing as never,
    );
    // updateMany WHERE id AND updatedAt matches → count: 1
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 1 } as never);

    const result = await listingService.updateListing(
      SELLER_ID,
      "seller@test.com",
      false,
      { listingId: LISTING_ID, title: "Vintage Camera (updated)" },
    );

    expect(result.ok).toBe(true);
    // WHERE clause must include both id and updatedAt (the optimistic lock)
    expect(db.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: LISTING_ID,
          updatedAt: KNOWN_UPDATED_AT,
        }),
      }),
    );
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  it("returns CONCURRENT_MODIFICATION when another request updated the listing first", async () => {
    // First findUnique: initial ownership check passes
    // Second findUnique: secondary existence check after count=0 (still exists)
    vi.mocked(db.listing.findUnique)
      .mockResolvedValueOnce(existingListing as never)
      .mockResolvedValueOnce({
        ...existingListing,
        updatedAt: new Date("2025-06-01T12:05:00.000Z"), // concurrently bumped
      } as never);

    // Stale updatedAt → WHERE clause matches 0 rows
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 0 } as never);

    const result = await listingService.updateListing(
      SELLER_ID,
      "seller@test.com",
      false,
      { listingId: LISTING_ID, title: "My New Title" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/modified by another request/i);
      expect(result.error).toMatch(/refresh/i);
    }
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  it("returns NOT_FOUND when count=0 and the listing no longer exists", async () => {
    // First findUnique: listing is present (ownership check passes)
    // Second findUnique: listing was deleted between read and write
    vi.mocked(db.listing.findUnique)
      .mockResolvedValueOnce(existingListing as never)
      .mockResolvedValueOnce(null);

    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 0 } as never);

    const result = await listingService.updateListing(
      SELLER_ID,
      "seller@test.com",
      false,
      { listingId: LISTING_ID, title: "Ghost Listing" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not found/i);
    }
  });
});

// ─── Offer optimistic locking ─────────────────────────────────────────────────

describe("Offer — optimistic locking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  it("accepts a PENDING offer and reserves the listing", async () => {
    vi.mocked(db.offer.findUnique).mockResolvedValue(pendingOffer as never);
    vi.mocked(db.$transaction).mockImplementation(async (cb) => {
      if (typeof cb === "function") return await cb(db as never);
      return [] as never;
    });
    // accept() WHERE status='PENDING' → count: 1 (winner)
    // declineCompetitors() → count: 0 (no competing offers)
    vi.mocked(db.offer.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never);
    vi.mocked(db.listing.update).mockResolvedValue({} as never);

    // Should not throw
    await expect(
      offerService.respondOffer(
        { offerId: "offer-1", action: "ACCEPT" },
        SELLER_ID,
        "127.0.0.1",
      ),
    ).resolves.not.toThrow();

    // accept() was called with the PENDING status guard in the WHERE clause
    expect(db.offer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "offer-1", status: "PENDING" }),
        data: expect.objectContaining({ status: "ACCEPTED" }),
      }),
    );
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  it("throws CONCURRENT_MODIFICATION when offer is already ACCEPTED", async () => {
    vi.mocked(db.offer.findUnique).mockResolvedValue({
      ...pendingOffer,
      status: "ACCEPTED",
    } as never);

    await expect(
      offerService.respondOffer(
        { offerId: "offer-1", action: "ACCEPT" },
        SELLER_ID,
        "127.0.0.1",
      ),
    ).rejects.toMatchObject({
      code: "CONCURRENT_MODIFICATION",
      statusCode: 409,
    });
  });

  // ── Test 6 ─────────────────────────────────────────────────────────────────
  it("throws CONCURRENT_MODIFICATION when offer is already DECLINED", async () => {
    vi.mocked(db.offer.findUnique).mockResolvedValue({
      ...pendingOffer,
      status: "DECLINED",
    } as never);

    await expect(
      offerService.respondOffer(
        { offerId: "offer-1", action: "DECLINE" },
        SELLER_ID,
        "127.0.0.1",
      ),
    ).rejects.toMatchObject({
      code: "CONCURRENT_MODIFICATION",
      statusCode: 409,
    });
  });

  // ── Test 7 ─────────────────────────────────────────────────────────────────
  it("throws CONCURRENT_MODIFICATION for the losing request in a true concurrent race", async () => {
    // Both requests see PENDING (pre-check passes for both).
    // The loser's updateMany returns count=0 because the winner already
    // changed the status away from PENDING.
    vi.mocked(db.offer.findUnique).mockResolvedValue(pendingOffer as never);
    vi.mocked(db.$transaction).mockImplementation(async (cb) => {
      if (typeof cb === "function") return await cb(db as never);
      return [] as never;
    });
    // Simulate losing the race: accept() returns count=0
    vi.mocked(db.offer.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(
      offerService.respondOffer(
        { offerId: "offer-1", action: "ACCEPT" },
        SELLER_ID,
        "127.0.0.1",
      ),
    ).rejects.toMatchObject({
      code: "CONCURRENT_MODIFICATION",
      statusCode: 409,
    });

    // Business logic (listing reservation, competing declines) must NOT run
    expect(db.listing.update).not.toHaveBeenCalled();
  });

  // ── Bonus: decline concurrent race ────────────────────────────────────────
  it("throws CONCURRENT_MODIFICATION when decline loses the concurrent race", async () => {
    vi.mocked(db.offer.findUnique).mockResolvedValue(pendingOffer as never);
    // Decline updateMany returns count=0 → another process responded first
    vi.mocked(db.offer.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(
      offerService.respondOffer(
        { offerId: "offer-1", action: "DECLINE" },
        SELLER_ID,
        "127.0.0.1",
      ),
    ).rejects.toMatchObject({
      code: "CONCURRENT_MODIFICATION",
      statusCode: 409,
    });
  });

  // ── AppError shape ─────────────────────────────────────────────────────────
  it("CONCURRENT_MODIFICATION error has HTTP 409 status code", async () => {
    vi.mocked(db.offer.findUnique).mockResolvedValue({
      ...pendingOffer,
      status: "ACCEPTED",
    } as never);

    let caughtError: unknown;
    try {
      await offerService.respondOffer(
        { offerId: "offer-1", action: "ACCEPT" },
        SELLER_ID,
        "127.0.0.1",
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(AppError);
    expect((caughtError as AppError).statusCode).toBe(409);
    expect((caughtError as AppError).code).toBe("CONCURRENT_MODIFICATION");
  });
});
