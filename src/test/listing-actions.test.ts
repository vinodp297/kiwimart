// src/test/listing-actions.test.ts
// ─── Tests: Listing Server Actions ──────────────────────────────────────────
// Covers:
//   createListing — validation, rate limit, auth, delegation to service
//   updateListing — validation, service delegation
//   deleteListing — auth, service delegation
//   toggleWatch — validation, service delegation
//   saveDraft — validation, rate limit

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: mockRequireUser,
}));

// ── Mock listing service ────────────────────────────────────────────────────
const mockCreateListing = vi.fn();
const mockUpdateListing = vi.fn();
const mockDeleteListing = vi.fn();
const mockToggleWatch = vi.fn();
const mockSaveDraft = vi.fn();
const mockGetListingForEdit = vi.fn();

vi.mock("@/modules/listings/listing.service", () => ({
  listingService: {
    createListing: (...args: unknown[]) => mockCreateListing(...args),
    updateListing: (...args: unknown[]) => mockUpdateListing(...args),
    deleteListing: (...args: unknown[]) => mockDeleteListing(...args),
    toggleWatch: (...args: unknown[]) => mockToggleWatch(...args),
    saveDraft: (...args: unknown[]) => mockSaveDraft(...args),
    getListingForEdit: (...args: unknown[]) => mockGetListingForEdit(...args),
    getListingById: vi.fn(),
  },
}));

// ── Mock validators pass-through (use real Zod schemas) ───────────────────────
// We want real validation — no need to mock validators

// ── Lazy imports ──────────────────────────────────────────────────────────────
const {
  createListing,
  updateListing,
  deleteListing,
  toggleWatch,
  saveDraft,
  getListingForEdit,
} = await import("@/server/actions/listings");
const { rateLimit } = await import("@/server/lib/rateLimit");

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_SELLER = {
  id: "seller-1",
  email: "seller@buyzi.test",
  isAdmin: false,
  isSellerEnabled: true,
  isStripeOnboarded: true,
};

const validListingInput = {
  title: "iPhone 15 Pro Max — Excellent Condition",
  description:
    "Barely used iPhone 15 Pro Max 256GB in Natural Titanium. Includes original box and accessories.",
  price: 1599, // $1,599.00 in NZD dollars (schema converts)
  condition: "LIKE_NEW",
  categoryId: "cat-electronics",
  region: "Auckland",
  suburb: "Ponsonby",
  shippingOption: "BOTH",
  shippingPrice: 15,
  imageKeys: ["img-key-1.jpg"],
  isOffersEnabled: true,
  isNegotiable: false,
  isUrgent: false,
  shipsNationwide: true,
  isGstIncluded: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_SELLER);
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
    mockCreateListing.mockResolvedValue({
      ok: true,
      listingId: "listing-1",
    });
  });

  it("creates listing successfully with valid input", async () => {
    const result = await createListing(validListingInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.listingId).toBe("listing-1");
    }
    expect(mockCreateListing).toHaveBeenCalledWith(
      "seller-1",
      "seller@buyzi.test",
      true, // isStripeOnboarded
      expect.any(Object),
      "127.0.0.1",
    );
  });

  it("rejects when not authenticated", async () => {
    mockRequireUser.mockRejectedValue(new Error("Unauthorised"));

    const result = await createListing(validListingInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/authentication/i);
    }
    expect(mockCreateListing).not.toHaveBeenCalled();
  });

  it("rejects missing required fields (Zod validation)", async () => {
    const result = await createListing({
      title: "", // empty
      description: "",
      priceNzd: 0,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fieldErrors).toBeDefined();
    }
    expect(mockCreateListing).not.toHaveBeenCalled();
  });

  it("rate limits listing creation", async () => {
    vi.mocked(rateLimit).mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 300,
    });

    const result = await createListing(validListingInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many|try again/i);
    }
  });

  it("returns service error when listing service rejects", async () => {
    mockCreateListing.mockResolvedValue({
      ok: false,
      error: "Seller is not verified to create listings.",
    });

    const result = await createListing(validListingInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not verified/i);
    }
  });

  it("returns error from service layer (e.g. invalid category)", async () => {
    mockCreateListing.mockResolvedValue({
      ok: false,
      error: "Invalid category selected.",
    });

    const result = await createListing(validListingInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/invalid category/i);
    }
  });
});

describe("updateListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_SELLER);
    mockUpdateListing.mockResolvedValue({
      ok: true,
      listingId: "listing-1",
    });
  });

  it("updates listing successfully", async () => {
    const result = await updateListing({
      listingId: "listing-1",
      title: "Updated iPhone Title",
    });

    expect(result.success).toBe(true);
    expect(mockUpdateListing).toHaveBeenCalledWith(
      "seller-1",
      "seller@buyzi.test",
      false, // isAdmin
      expect.objectContaining({ listingId: "listing-1" }),
    );
  });

  it("rejects invalid update data", async () => {
    const result = await updateListing({
      // missing listingId
      title: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fieldErrors).toBeDefined();
    }
  });

  it("returns error from service (e.g. non-owner)", async () => {
    mockUpdateListing.mockResolvedValue({
      ok: false,
      error: "You do not have permission to edit this listing.",
    });

    const result = await updateListing({
      listingId: "listing-other",
      title: "Stolen Edit",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/permission/i);
    }
  });
});

describe("deleteListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_SELLER);
    mockDeleteListing.mockResolvedValue(undefined);
  });

  it("deletes listing successfully", async () => {
    const result = await deleteListing("listing-1");

    expect(result.success).toBe(true);
    expect(mockDeleteListing).toHaveBeenCalledWith(
      "listing-1",
      "seller-1",
      false, // isAdmin
    );
  });

  it("returns error when service throws (e.g. active orders)", async () => {
    mockDeleteListing.mockRejectedValue(
      new Error("Cannot delete listing with active orders."),
    );

    const result = await deleteListing("listing-active");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });
});

describe("toggleWatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_SELLER);
    mockToggleWatch.mockResolvedValue({ watching: true });
  });

  it("toggles watch on a listing", async () => {
    const result = await toggleWatch({ listingId: "listing-1" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.watching).toBe(true);
    }
  });

  it("rejects invalid input", async () => {
    const result = await toggleWatch({});

    expect(result.success).toBe(false);
  });
});

describe("saveDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_SELLER);
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
    mockSaveDraft.mockResolvedValue({ ok: true, draftId: "draft-1" });
  });

  it("saves draft successfully", async () => {
    const result = await saveDraft({
      title: "Draft Listing",
      description: "A draft that is not yet published",
      price: 50,
      condition: "GOOD",
      categoryId: "cat-electronics",
      region: "Auckland",
      suburb: "CBD",
      shippingOption: "pickup",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.draftId).toBe("draft-1");
    }
  });

  it("rate limits draft saves", async () => {
    vi.mocked(rateLimit).mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 30,
    });

    const result = await saveDraft({
      title: "Draft",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many|try again/i);
    }
  });
});

describe("getListingForEdit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_SELLER);
  });

  it("returns listing data for owner", async () => {
    mockGetListingForEdit.mockResolvedValue({
      ok: true,
      data: {
        id: "listing-1",
        title: "Test Listing",
        priceNzd: 100_00,
      },
    });

    const result = await getListingForEdit("listing-1");

    expect(result.success).toBe(true);
    expect(mockGetListingForEdit).toHaveBeenCalledWith(
      "listing-1",
      "seller-1",
      false,
    );
  });

  it("returns error for non-owner", async () => {
    mockGetListingForEdit.mockResolvedValue({
      ok: false,
      error: "You do not have permission to edit this listing.",
    });

    const result = await getListingForEdit("listing-other");

    expect(result.success).toBe(false);
  });
});
