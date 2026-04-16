// src/test/images.actions.test.ts
// ─── Tests: Image Upload Server Actions ─────────────────────────────────────
// Covers all exported actions in src/server/actions/images.ts:
//   requestImageUpload   — presigned URL generation + validation
//   confirmImageUpload   — triggers processing pipeline
//   cleanupOrphanedImages — deletes stale pending images
//   getSignedImageUrl    — produces read URL (or fallback)
//   deleteListingImage   — removes image with ownership guard
//   reorderListingImages — updates sort order with ownership guard

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock listing-image repository ─────────────────────────────────────────────
const mockCountByListing = vi.fn();
const mockDeleteOrphansByUser = vi.fn();
const mockCountPendingByUser = vi.fn();
const mockCreate = vi.fn();
const mockMarkSafe = vi.fn();
const mockDeleteUnprocessedOrphansByUser = vi.fn();
const mockFindListingOwnerAndCount = vi.fn();
const mockFindByIdAndListing = vi.fn();
const mockDeleteById = vi.fn();
const mockFindOrderedByListing = vi.fn();
const mockUpdateOrder = vi.fn();

vi.mock("@/modules/listings/listing-image.repository", () => ({
  listingImageRepository: {
    countByListing: (...args: unknown[]) => mockCountByListing(...args),
    deleteOrphansByUser: (...args: unknown[]) =>
      mockDeleteOrphansByUser(...args),
    countPendingByUser: (...args: unknown[]) => mockCountPendingByUser(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    markSafe: (...args: unknown[]) => mockMarkSafe(...args),
    deleteUnprocessedOrphansByUser: (...args: unknown[]) =>
      mockDeleteUnprocessedOrphansByUser(...args),
    findListingOwnerAndCount: (...args: unknown[]) =>
      mockFindListingOwnerAndCount(...args),
    findByIdAndListing: (...args: unknown[]) => mockFindByIdAndListing(...args),
    deleteById: (...args: unknown[]) => mockDeleteById(...args),
    findOrderedByListing: (...args: unknown[]) =>
      mockFindOrderedByListing(...args),
    updateOrder: (...args: unknown[]) => mockUpdateOrder(...args),
  },
}));

// ── Mock AWS S3 command constructors (avoid real sig generation) ──────────────
vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class GetObjectCommand {
    constructor(p: unknown) {
      Object.assign(this, p);
    }
  },
  PutObjectCommand: class PutObjectCommand {
    constructor(p: unknown) {
      Object.assign(this, p);
    }
  },
}));

// ── Mock imageProcessor (lazy-imported inside confirmImageUpload) ─────────────
const mockProcessImage = vi.fn();
vi.mock("@/server/actions/imageProcessor", () => ({
  processImage: (...args: unknown[]) => mockProcessImage(...args),
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const {
  requestImageUpload,
  confirmImageUpload,
  cleanupOrphanedImages,
  getSignedImageUrl,
  deleteListingImage,
  reorderListingImages,
} = await import("@/server/actions/images");
const { rateLimit } = await import("@/server/lib/rateLimit");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_USER = {
  id: "user_seller",
  email: "seller@test.com",
  isAdmin: false,
};
const ADMIN_USER = {
  id: "user_admin",
  email: "admin@test.com",
  isAdmin: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// requestImageUpload
// ─────────────────────────────────────────────────────────────────────────────

describe("requestImageUpload", () => {
  const validParams = {
    fileName: "photo.jpg",
    contentType: "image/jpeg",
    sizeBytes: 1024 * 500, // 500KB
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockCountByListing.mockResolvedValue(0);
    mockCountPendingByUser.mockResolvedValue(0);
    mockDeleteOrphansByUser.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({ id: "img_new_1" });
  });

  it("unauthenticated → returns auth error and does not create image", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await requestImageUpload(validParams);

    expect(result.success).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects disallowed MIME type (GIF)", async () => {
    const result = await requestImageUpload({
      ...validParams,
      contentType: "image/gif",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/file type not allowed/i);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects file exceeding 8MB size limit", async () => {
    const result = await requestImageUpload({
      ...validParams,
      sizeBytes: 9 * 1024 * 1024,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/file too large|8MB/i);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects when listing already has max 10 images", async () => {
    mockCountByListing.mockResolvedValueOnce(10);

    const result = await requestImageUpload({
      ...validParams,
      listingId: "listing_1",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/maximum 10 images/i);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects when pending image count hits max for new listing", async () => {
    mockCountPendingByUser.mockResolvedValueOnce(10);

    const result = await requestImageUpload(validParams);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/maximum 10 images/i);
    }
    // orphan cleanup still runs before the count check
    expect(mockDeleteOrphansByUser).toHaveBeenCalledWith(TEST_USER.id);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rate limit exceeded → returns rate limit error", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 60,
    });

    const result = await requestImageUpload(validParams);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many uploads|wait/i);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("happy path (new listing) → returns uploadUrl, r2Key, imageId", async () => {
    const result = await requestImageUpload(validParams);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imageId).toBe("img_new_1");
      expect(result.data.r2Key).toMatch(
        /^listings\/user_seller\/[0-9a-f-]+\.jpg$/,
      );
      expect(result.data.uploadUrl).toMatch(/^https?:\/\//);
    }
    // DB record created with no listingId for a pending upload
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: null,
        sizeBytes: validParams.sizeBytes,
        isScanned: false,
        isSafe: false,
      }),
    );
  });

  it("happy path (existing listing) → links record to listingId", async () => {
    const result = await requestImageUpload({
      ...validParams,
      listingId: "listing_xyz",
    });

    expect(result.success).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: "listing_xyz" }),
    );
    // Orphan cleanup only runs for the pending-upload branch
    expect(mockDeleteOrphansByUser).not.toHaveBeenCalled();
  });

  it("maps jpeg MIME type to .jpg extension in r2Key", async () => {
    const result = await requestImageUpload({
      ...validParams,
      contentType: "image/jpeg",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.r2Key).toMatch(/\.jpg$/);
    }
  });

  it("uses png extension for image/png uploads", async () => {
    const result = await requestImageUpload({
      ...validParams,
      contentType: "image/png",
      fileName: "photo.png",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.r2Key).toMatch(/\.png$/);
    }
  });

  it("repository throws → returns safe fallback error", async () => {
    mockCreate.mockRejectedValueOnce(new Error("DB down"));

    const result = await requestImageUpload(validParams);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// confirmImageUpload
// ─────────────────────────────────────────────────────────────────────────────

describe("confirmImageUpload", () => {
  const validInput = {
    imageId: "img_1",
    r2Key: "listings/user_seller/uuid-xyz.jpg",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockProcessImage.mockResolvedValue({
      success: true,
      fullKey: "listings/user_seller/uuid-xyz-full.webp",
      thumbKey: "listings/user_seller/uuid-xyz-thumb.webp",
      width: 800,
      height: 600,
      compressedSize: 50_000,
      originalSize: 500_000,
    });
  });

  it("unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await confirmImageUpload(validInput);

    expect(result.success).toBe(false);
    expect(mockProcessImage).not.toHaveBeenCalled();
  });

  it("rejects r2Key not scoped to current user (prevents key theft)", async () => {
    const result = await confirmImageUpload({
      imageId: "img_1",
      r2Key: "listings/someone_else/img.jpg",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/unauthorised/i);
    }
    expect(mockProcessImage).not.toHaveBeenCalled();
  });

  it("happy path → returns processed image metadata with isSafe=true", async () => {
    const result = await confirmImageUpload(validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isSafe).toBe(true);
      expect(result.data.r2Key).toBe("listings/user_seller/uuid-xyz-full.webp");
      expect(result.data.thumbnailKey).toBe(
        "listings/user_seller/uuid-xyz-thumb.webp",
      );
      expect(result.data.width).toBe(800);
      expect(result.data.height).toBe(600);
    }
    expect(mockProcessImage).toHaveBeenCalledWith({
      imageId: "img_1",
      r2Key: validInput.r2Key,
      userId: TEST_USER.id,
    });
  });

  it("processImage throws with actionable message → propagates error", async () => {
    mockProcessImage.mockRejectedValueOnce(
      new Error("Image is too small (min 200x200)"),
    );

    const result = await confirmImageUpload(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too small/i);
    }
  });

  it("storage error in dev bypasses scan and marks safe", async () => {
    const originalEnv = process.env.NODE_ENV;
    // vitest sets NODE_ENV="test" — not production → bypass branch runs
    mockProcessImage.mockRejectedValueOnce(
      new Error("Failed to download from R2"),
    );

    const result = await confirmImageUpload(validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isSafe).toBe(true);
    }
    expect(mockMarkSafe).toHaveBeenCalledWith(
      validInput.imageId,
      validInput.r2Key,
    );
    process.env.NODE_ENV = originalEnv;
  });

  it("storage error in production returns user-facing failure (never marks safe)", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    mockProcessImage.mockRejectedValueOnce(new Error("ENOTFOUND r2.example"));

    const result = await confirmImageUpload(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/image processing failed/i);
    }
    expect(mockMarkSafe).not.toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });

  it("generic processing error is propagated with original message", async () => {
    mockProcessImage.mockRejectedValueOnce(
      new Error("virus signature detected"),
    );

    const result = await confirmImageUpload(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/virus signature detected/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cleanupOrphanedImages
// ─────────────────────────────────────────────────────────────────────────────

describe("cleanupOrphanedImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockDeleteUnprocessedOrphansByUser.mockResolvedValue({ count: 0 });
  });

  it("unauthenticated → returns success with 0 deleted (non-critical)", async () => {
    // Action is fault-tolerant — swallows any error including auth failure
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await cleanupOrphanedImages();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(0);
    }
    expect(mockDeleteUnprocessedOrphansByUser).not.toHaveBeenCalled();
  });

  it("happy path with no orphans → returns 0 deleted", async () => {
    const result = await cleanupOrphanedImages();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(0);
    }
    expect(mockDeleteUnprocessedOrphansByUser).toHaveBeenCalledWith(
      TEST_USER.id,
    );
  });

  it("happy path with orphans → returns deleted count", async () => {
    mockDeleteUnprocessedOrphansByUser.mockResolvedValueOnce({ count: 3 });

    const result = await cleanupOrphanedImages();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(3);
    }
  });

  it("repository throws → returns success with 0 deleted (non-critical)", async () => {
    mockDeleteUnprocessedOrphansByUser.mockRejectedValueOnce(
      new Error("DB connection lost"),
    );

    const result = await cleanupOrphanedImages();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(0);
    }
  });

  it("scopes cleanup to the authenticated user's id", async () => {
    mockRequireUser.mockResolvedValueOnce({
      ...TEST_USER,
      id: "user_other",
    });
    mockDeleteUnprocessedOrphansByUser.mockResolvedValueOnce({ count: 5 });

    const result = await cleanupOrphanedImages();

    expect(result.success).toBe(true);
    expect(mockDeleteUnprocessedOrphansByUser).toHaveBeenCalledWith(
      "user_other",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSignedImageUrl
// ─────────────────────────────────────────────────────────────────────────────

describe("getSignedImageUrl", () => {
  const originalAccessKey = process.env.R2_ACCESS_KEY_ID;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns placeholder when R2 credentials are not configured", async () => {
    process.env.R2_ACCESS_KEY_ID = undefined as unknown as string;
    delete process.env.R2_ACCESS_KEY_ID;

    const url = await getSignedImageUrl("listings/user_seller/img.webp");

    expect(url).toMatch(/images\.unsplash\.com/);

    process.env.R2_ACCESS_KEY_ID = originalAccessKey;
  });

  it("returns placeholder when R2_ACCESS_KEY_ID is the sentinel PLACEHOLDER_R2_ACCESS_KEY", async () => {
    process.env.R2_ACCESS_KEY_ID = "PLACEHOLDER_R2_ACCESS_KEY";

    const url = await getSignedImageUrl("listings/user_seller/img.webp");

    expect(url).toMatch(/images\.unsplash\.com/);

    process.env.R2_ACCESS_KEY_ID = originalAccessKey;
  });

  it("returns a presigned read URL when R2 credentials are configured", async () => {
    process.env.R2_ACCESS_KEY_ID = "real-access-key";

    const url = await getSignedImageUrl("listings/user_seller/img.webp");

    // The setup.ts mock returns a fixed presigned URL
    expect(url).toMatch(/^https?:\/\//);
    expect(url).not.toMatch(/unsplash/);

    process.env.R2_ACCESS_KEY_ID = originalAccessKey;
  });

  it("handles arbitrary r2Key values (does not throw)", async () => {
    process.env.R2_ACCESS_KEY_ID = "real-access-key";

    await expect(
      getSignedImageUrl("some/nested/path/key.webp"),
    ).resolves.toBeTypeOf("string");

    process.env.R2_ACCESS_KEY_ID = originalAccessKey;
  });

  it("returns placeholder URL of expected format", async () => {
    delete process.env.R2_ACCESS_KEY_ID;

    const url = await getSignedImageUrl("listings/user_seller/img.webp");

    expect(url).toContain("w=800");
    expect(url).toContain("h=800");

    process.env.R2_ACCESS_KEY_ID = originalAccessKey;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteListingImage
// ─────────────────────────────────────────────────────────────────────────────

describe("deleteListingImage", () => {
  const validInput = { imageId: "img_1", listingId: "listing_1" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockFindListingOwnerAndCount.mockResolvedValue({
      sellerId: TEST_USER.id,
      _count: { images: 3 },
    });
    mockFindByIdAndListing.mockResolvedValue({
      id: "img_1",
      listingId: "listing_1",
      order: 1,
    });
    mockDeleteById.mockResolvedValue(undefined);
    mockFindOrderedByListing.mockResolvedValue([
      { id: "img_a" },
      { id: "img_b" },
    ]);
    mockUpdateOrder.mockResolvedValue(undefined);
  });

  it("unauthenticated → returns safe error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await deleteListingImage(validInput);

    expect(result.success).toBe(false);
    expect(mockDeleteById).not.toHaveBeenCalled();
  });

  it("returns Not authorised when listing not found", async () => {
    mockFindListingOwnerAndCount.mockResolvedValueOnce(null);

    const result = await deleteListingImage(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not authorised/i);
    }
    expect(mockDeleteById).not.toHaveBeenCalled();
  });

  it("returns Not authorised when user is not seller and not admin", async () => {
    mockFindListingOwnerAndCount.mockResolvedValueOnce({
      sellerId: "other_user",
      _count: { images: 3 },
    });

    const result = await deleteListingImage(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not authorised/i);
    }
    expect(mockDeleteById).not.toHaveBeenCalled();
  });

  it("admin can delete images on any listing", async () => {
    mockRequireUser.mockResolvedValueOnce(ADMIN_USER);
    mockFindListingOwnerAndCount.mockResolvedValueOnce({
      sellerId: "some_other_seller",
      _count: { images: 3 },
    });

    const result = await deleteListingImage(validInput);

    expect(result.success).toBe(true);
    expect(mockDeleteById).toHaveBeenCalledWith("img_1");
  });

  it("refuses to delete the last remaining image on a listing", async () => {
    mockFindListingOwnerAndCount.mockResolvedValueOnce({
      sellerId: TEST_USER.id,
      _count: { images: 1 },
    });

    const result = await deleteListingImage(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/at least one photo/i);
    }
    expect(mockDeleteById).not.toHaveBeenCalled();
  });

  it("returns Image not found when image id is not on listing", async () => {
    mockFindByIdAndListing.mockResolvedValueOnce(null);

    const result = await deleteListingImage(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/image not found/i);
    }
    expect(mockDeleteById).not.toHaveBeenCalled();
  });

  it("happy path → deletes image and reorders remaining images", async () => {
    const result = await deleteListingImage(validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(true);
    }
    expect(mockDeleteById).toHaveBeenCalledWith("img_1");
    // Remaining images get re-ordered from 0
    expect(mockUpdateOrder).toHaveBeenCalledWith("img_a", 0);
    expect(mockUpdateOrder).toHaveBeenCalledWith("img_b", 1);
  });

  it("repository throws → returns safe fallback error", async () => {
    mockDeleteById.mockRejectedValueOnce(new Error("DB error"));

    const result = await deleteListingImage(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reorderListingImages
// ─────────────────────────────────────────────────────────────────────────────

describe("reorderListingImages", () => {
  const validInput = {
    listingId: "listing_1",
    imageIds: ["img_b", "img_a", "img_c"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockFindListingOwnerAndCount.mockResolvedValue({
      sellerId: TEST_USER.id,
      _count: { images: 3 },
    });
    mockUpdateOrder.mockResolvedValue(undefined);
  });

  it("unauthenticated → returns safe error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await reorderListingImages(validInput);

    expect(result.success).toBe(false);
    expect(mockUpdateOrder).not.toHaveBeenCalled();
  });

  it("returns Not authorised when listing not found", async () => {
    mockFindListingOwnerAndCount.mockResolvedValueOnce(null);

    const result = await reorderListingImages(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not authorised/i);
    }
    expect(mockUpdateOrder).not.toHaveBeenCalled();
  });

  it("returns Not authorised when user does not own listing and is not admin", async () => {
    mockFindListingOwnerAndCount.mockResolvedValueOnce({
      sellerId: "other_user",
      _count: { images: 3 },
    });

    const result = await reorderListingImages(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not authorised/i);
    }
    expect(mockUpdateOrder).not.toHaveBeenCalled();
  });

  it("admin can reorder any listing's images", async () => {
    mockRequireUser.mockResolvedValueOnce(ADMIN_USER);
    mockFindListingOwnerAndCount.mockResolvedValueOnce({
      sellerId: "some_other_seller",
      _count: { images: 3 },
    });

    const result = await reorderListingImages(validInput);

    expect(result.success).toBe(true);
    expect(mockUpdateOrder).toHaveBeenCalledTimes(3);
  });

  it("happy path → updates each image's order in sequence", async () => {
    const result = await reorderListingImages(validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reordered).toBe(true);
    }
    expect(mockUpdateOrder).toHaveBeenCalledWith("img_b", 0);
    expect(mockUpdateOrder).toHaveBeenCalledWith("img_a", 1);
    expect(mockUpdateOrder).toHaveBeenCalledWith("img_c", 2);
  });

  it("repository throws → returns safe fallback error", async () => {
    mockUpdateOrder.mockRejectedValueOnce(new Error("DB error"));

    const result = await reorderListingImages(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });

  it("empty imageIds list → succeeds with no repository calls", async () => {
    const result = await reorderListingImages({
      listingId: "listing_1",
      imageIds: [],
    });

    expect(result.success).toBe(true);
    expect(mockUpdateOrder).not.toHaveBeenCalled();
  });
});
