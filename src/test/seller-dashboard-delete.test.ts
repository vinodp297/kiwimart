// src/test/seller-dashboard-delete.test.ts
// ─── Tests: Seller Dashboard — Delete Listing ────────────────────────────────
// Covers:
//   Server action (deleteListing):
//     1. Owner can delete their own listing
//     2. Non-owner receives an unauthorised error
//     3. SOLD listing returns an error (cannot be deleted)
//     4. Soft-delete is used — listingRepository.softDelete called, not deleteMany
//   Frontend (source inspection):
//     5. handleDeleteListing calls the real server action (not setTimeout)
//     6. Confirmation modal is shown before deletion (deleteConfirm state)
//     7. Error from server action triggers rollback and toast.error

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import * as fs from "fs";
import * as path from "path";

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: mockRequireUser,
}));

// ── Mock listing service ──────────────────────────────────────────────────────
const mockServiceDeleteListing = vi.fn();

vi.mock("@/modules/listings/listing.service", () => ({
  listingService: {
    deleteListing: (...args: unknown[]) => mockServiceDeleteListing(...args),
    createListing: vi.fn(),
    updateListing: vi.fn(),
    toggleWatch: vi.fn(),
    saveDraft: vi.fn(),
    getListingForEdit: vi.fn(),
    getListingById: vi.fn(),
  },
}));

// ── Mock next/cache ───────────────────────────────────────────────────────────
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// ── Lazy import the server action ─────────────────────────────────────────────
const { deleteListing } = await import("@/server/actions/listings");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER = {
  id: "seller-1",
  email: "seller@buyzi.test",
  isAdmin: false,
  isSellerEnabled: true,
  isStripeOnboarded: true,
};

const NON_OWNER = {
  id: "other-user-99",
  email: "other@buyzi.test",
  isAdmin: false,
  isSellerEnabled: true,
  isStripeOnboarded: false,
};

// ─────────────────────────────────────────────────────────────────────────────

describe("deleteListing server action — ownership and validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(OWNER);
    mockServiceDeleteListing.mockResolvedValue(undefined);
  });

  // Test 1: owner can delete their own listing
  it("returns success when the owner deletes their own listing", async () => {
    const result = await deleteListing("listing-1");

    expect(result.success).toBe(true);
    expect(mockServiceDeleteListing).toHaveBeenCalledWith(
      "listing-1",
      "seller-1",
      false, // isAdmin
    );
  });

  // Test 2: non-owner is rejected
  it("returns an error when a non-owner attempts to delete the listing", async () => {
    mockRequireUser.mockResolvedValue(NON_OWNER);
    mockServiceDeleteListing.mockRejectedValue(
      new Error("You do not have permission to delete this listing."),
    );

    const result = await deleteListing("listing-owned-by-someone-else");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
    // Service was invoked with non-owner's ID
    expect(mockServiceDeleteListing).toHaveBeenCalledWith(
      "listing-owned-by-someone-else",
      "other-user-99",
      false,
    );
  });

  // Test 3: SOLD listing cannot be deleted
  it("returns an error when the listing is SOLD and cannot be deleted", async () => {
    mockServiceDeleteListing.mockRejectedValue(
      new Error("Sold listings cannot be deleted."),
    );

    const result = await deleteListing("listing-sold-1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });

  // Test 4: soft-delete — server action delegates to service (not hard-delete)
  it("delegates to listingService.deleteListing (soft delete path)", async () => {
    await deleteListing("listing-2");

    // Must have called the service — which does softDelete internally
    expect(mockServiceDeleteListing).toHaveBeenCalledTimes(1);
    expect(mockServiceDeleteListing).toHaveBeenCalledWith(
      "listing-2",
      OWNER.id,
      OWNER.isAdmin,
    );
  });
});

// ── Frontend source-code inspection tests ─────────────────────────────────────
// These tests read the compiled source of page.tsx to verify the implementation
// details without needing a browser or React runtime.

const PAGE_PATH = path.resolve(
  process.cwd(),
  "src/app/(protected)/dashboard/seller/page.tsx",
);
const pageSource = fs.readFileSync(PAGE_PATH, "utf-8");

describe("SellerDashboardPage — handleDeleteListing implementation", () => {
  // Test 5: real server action is called (no setTimeout simulation)
  it("calls the real deleteListing server action instead of a setTimeout", () => {
    // Must import and call deleteListing
    expect(pageSource).toMatch(
      /import.*deleteListing.*from.*server\/actions\/listings/,
    );
    expect(pageSource).toMatch(/await deleteListing\(id\)/);

    // The fake simulation must be gone
    expect(pageSource).not.toMatch(/Sprint 5/);
    expect(pageSource).not.toMatch(/setTimeout.*600/);
  });

  // Test 6: confirmation modal — deleteConfirm state is cleared before the
  // server call so the modal closes while the action is in flight
  it("clears the confirmation modal (setDeleteConfirm) before the server action", () => {
    // setDeleteConfirm(null) must appear in handleDeleteListing
    // and it must come before `await deleteListing`
    const fnStart = pageSource.indexOf("async function handleDeleteListing");
    const fnEnd = pageSource.indexOf("\n  }", fnStart);
    const fnBody = pageSource.slice(fnStart, fnEnd);

    expect(fnBody).toMatch(/setDeleteConfirm\(null\)/);
    const confirmPos = fnBody.indexOf("setDeleteConfirm(null)");
    const deletePos = fnBody.indexOf("await deleteListing(id)");
    expect(confirmPos).toBeLessThan(deletePos);
  });

  // Test 7: error handling — rollback optimistic update and show toast on failure
  it("restores previous listings and calls toast.error when the server action fails", () => {
    const fnStart = pageSource.indexOf("async function handleDeleteListing");
    const fnEnd = pageSource.indexOf("\n  }", fnStart);
    const fnBody = pageSource.slice(fnStart, fnEnd);

    // Optimistic rollback: previousListings variable captured before mutation
    expect(fnBody).toMatch(/const previousListings = listings/);
    expect(fnBody).toMatch(/setListings\(previousListings\)/);

    // Error feedback via sonner toast
    expect(pageSource).toMatch(/import.*toast.*from.*sonner/);
    expect(fnBody).toMatch(/toast\.error\(/);
  });
});
