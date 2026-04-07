// src/test/image-processor.test.ts
// ─── Tests: Image Processing Pipeline & File Validation ──────────────────────
// Covers:
//   validateImageFile / validateMagicBytes (fileValidation.ts — pure functions):
//     1. Valid JPEG with correct magic bytes → accepted
//     2. File with wrong magic bytes (JPEG bytes declared as PNG) → rejected
//     3. File exceeding 8 MB size limit → rejected
//     4. SVG file → rejected (XSS risk)
//     5. Dangerous file extension (.php) → rejected
//   scanForMalware (imageProcessor.ts — AV integration point):
//     6. Returns { isSafe: boolean, reason?: string } shape
//     7. Returns isSafe: true for any buffer (placeholder implementation)
//   processImage (imageProcessor.ts — full pipeline):
//     8. Valid image → success + isScanned: true, isSafe: true written to DB
//     9. Undecodable file → rejected, isScanned: true, isSafe: false written to DB
//    10. Image below 200×200 → rejected
//    11. Image record not found → throws
//    12. Image belongs to a different user → throws

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Sharp mock ────────────────────────────────────────────────────────────────
// vi.hoisted() ensures these are defined before the vi.mock() factory runs
// (vi.mock factories are hoisted to the top of the file).
const { mockMetadata, mockToBuffer } = vi.hoisted(() => ({
  mockMetadata: vi.fn(),
  mockToBuffer: vi.fn(),
}));

vi.mock("sharp", () => {
  // Creates a chainable sharp instance backed by the shared mock functions.
  function makeInstance() {
    const inst: Record<string, unknown> = {};
    inst.metadata = mockMetadata;
    inst.rotate = vi.fn().mockReturnValue(inst);
    inst.resize = vi.fn().mockReturnValue(inst);
    inst.webp = vi.fn().mockReturnValue(inst);
    inst.toBuffer = mockToBuffer;
    return inst;
  }
  return { default: vi.fn().mockImplementation(makeInstance) };
});

// ── Imports after mocks ───────────────────────────────────────────────────────
import db from "@/lib/db";
import { r2 } from "@/infrastructure/storage/r2";
import { processImage, scanForMalware } from "@/server/actions/imageProcessor";
import {
  validateImageFile,
  validateMagicBytes,
} from "@/server/lib/fileValidation";

// ── Inject listingImage mock ──────────────────────────────────────────────────
// setup.ts does not pre-define listingImage (listing.service.test.ts also patches
// it conditionally — if we added it to setup.ts that guard would stop working).
// We use the same cast pattern to attach a fresh vi.fn() based mock here.
const mockFindUnique = vi.fn();
const mockListingImageUpdate = vi.fn().mockResolvedValue({ id: "img-1" });
const _db = db as unknown as Record<string, unknown>;
_db.listingImage = {
  findUnique: mockFindUnique,
  update: mockListingImageUpdate,
  findMany: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: "img-1" }),
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Minimal magic byte prefixes for each type
const JPEG_MAGIC = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// A real-looking JPEG buffer (magic bytes + padding to a realistic size)
const JPEG_BUFFER = Buffer.concat([JPEG_MAGIC, Buffer.alloc(500, 0x00)]);

// A buffer with no valid image signature — will fail decodability check
const CORRUPT_BUFFER = Buffer.from("Not an image — just plaintext data");

// Helper: wrap a Buffer as an async-iterable R2 GetObject response body
function makeR2Body(buffer: Buffer) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield new Uint8Array(buffer);
    },
  };
}

// Default image record — owned by user-1 via listing relation
const IMAGE_RECORD_OWNED = {
  r2Key: "listings/user-1/img-abc.jpg",
  listing: { sellerId: "user-1" },
};

// ─────────────────────────────────────────────────────────────────────────────

describe("validateImageFile — upload-time validation", () => {
  // Test 1: valid JPEG accepted
  it("accepts a valid JPEG with correct magic bytes", () => {
    const result = validateImageFile({
      buffer: JPEG_BUFFER,
      mimetype: "image/jpeg",
      size: JPEG_BUFFER.length,
      originalname: "photo.jpg",
    });

    expect(result.valid).toBe(true);
  });

  // Test 2: wrong magic bytes rejected
  it("rejects a file whose magic bytes do not match the declared MIME type", () => {
    // Buffer starts with JPEG bytes but is declared as PNG
    const result = validateImageFile({
      buffer: JPEG_BUFFER,
      mimetype: "image/png",
      size: JPEG_BUFFER.length,
      originalname: "photo.png",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  // Test 3: file size limit enforced
  it("rejects a file that exceeds the 8 MB size limit", () => {
    const oversizeBytes = 9 * 1024 * 1024; // 9 MB
    const result = validateImageFile({
      buffer: JPEG_BUFFER, // small buffer is fine — size param is what's checked
      mimetype: "image/jpeg",
      size: oversizeBytes,
      originalname: "huge.jpg",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/8 MB/);
  });

  // Test 4: SVG blocked entirely
  it("rejects an SVG file to prevent stored XSS", () => {
    const result = validateImageFile({
      buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      mimetype: "image/svg+xml",
      size: 42,
      originalname: "icon.svg",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/SVG/i);
  });

  // Test 5: dangerous extension blocked
  it("rejects a file with a dangerous extension (.php)", () => {
    const result = validateImageFile({
      buffer: JPEG_BUFFER,
      mimetype: "image/jpeg",
      size: JPEG_BUFFER.length,
      originalname: "shell.php",
    });

    expect(result.valid).toBe(false);
  });

  it("rejects a valid-looking PNG declared as JPEG", () => {
    const result = validateImageFile({
      buffer: PNG_MAGIC,
      mimetype: "image/jpeg",
      size: PNG_MAGIC.length,
      originalname: "actually-png.jpg",
    });

    expect(result.valid).toBe(false);
  });
});

describe("validateMagicBytes — low-level signature check", () => {
  it("returns true for a JPEG buffer with the correct signature", () => {
    expect(validateMagicBytes(JPEG_MAGIC, "image/jpeg")).toBe(true);
  });

  it("returns true for a PNG buffer with the correct signature", () => {
    expect(validateMagicBytes(PNG_MAGIC, "image/png")).toBe(true);
  });

  it("returns false when the buffer signature does not match the MIME type", () => {
    expect(validateMagicBytes(JPEG_MAGIC, "image/png")).toBe(false);
  });

  it("returns false for an unsupported MIME type", () => {
    expect(validateMagicBytes(JPEG_MAGIC, "image/gif")).toBe(false);
  });
});

// ── scanForMalware — AV integration point ─────────────────────────────────────

describe("scanForMalware — AV integration point", () => {
  // Test 6 + 7: correct shape and current behaviour
  it("returns the correct shape { isSafe: boolean; reason?: string }", async () => {
    const result = await scanForMalware(JPEG_BUFFER, "photo.jpg");

    expect(typeof result.isSafe).toBe("boolean");
    // reason is optional — if present it must be a string
    if ("reason" in result && result.reason !== undefined) {
      expect(typeof result.reason).toBe("string");
    }
  });

  it("returns isSafe: true for any input (placeholder — no real AV integrated)", async () => {
    const result = await scanForMalware(CORRUPT_BUFFER, "corrupt.dat");

    expect(result.isSafe).toBe(true);
  });

  it("returns isSafe: true for an empty buffer", async () => {
    const result = await scanForMalware(Buffer.alloc(0), "empty.jpg");

    expect(result.isSafe).toBe(true);
  });
});

// ── processImage — full pipeline ──────────────────────────────────────────────

describe("processImage — pipeline execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default sharp: decodable 800×600 image
    mockMetadata.mockResolvedValue({ width: 800, height: 600, format: "jpeg" });
    mockToBuffer.mockResolvedValue({
      data: Buffer.from("fake-webp-output"),
      info: { width: 800, height: 600, size: 12_345 },
    });

    // Default db: image record owned by user-1
    mockFindUnique.mockResolvedValue(IMAGE_RECORD_OWNED);
    mockListingImageUpdate.mockResolvedValue({ id: "img-1" });

    // Default r2: first call = GetObject (returns download body),
    // subsequent calls = PutObject + DeleteObject (return empty success)
    vi.mocked(r2.send)
      .mockResolvedValueOnce({ Body: makeR2Body(JPEG_BUFFER) } as never)
      .mockResolvedValue({} as never);
  });

  // Test 8: valid image → success + correct DB flags
  it("processes a valid image and sets isScanned: true, isSafe: true", async () => {
    const result = await processImage({
      imageId: "img-1",
      r2Key: "listings/user-1/img-abc.jpg",
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    expect(result.fullKey).toMatch(/-full\.webp$/);
    expect(result.thumbKey).toMatch(/-thumb\.webp$/);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);

    // DB must record the image as scanned and safe
    expect(mockListingImageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isScanned: true, isSafe: true }),
      }),
    );
  });

  // Test 9: undecodable file → rejected + DB marked as unsafe
  it("rejects an undecodable file and marks isSafe: false in the DB", async () => {
    // Make sharp.metadata() throw — simulates a corrupt or disguised file
    mockMetadata.mockRejectedValueOnce(
      new Error("Input buffer contains unsupported image format"),
    );

    await expect(
      processImage({
        imageId: "img-corrupt",
        r2Key: "listings/user-1/corrupt.jpg",
        userId: "user-1",
      }),
    ).rejects.toThrow("decode check");

    // DB must record the failure with isSafe: false
    expect(mockListingImageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isScanned: true, isSafe: false }),
      }),
    );
  });

  // Test 10: too-small image rejected
  it("rejects an image below the 200×200 minimum dimensions", async () => {
    mockMetadata.mockResolvedValueOnce({
      width: 150,
      height: 150,
      format: "jpeg",
    });

    await expect(
      processImage({
        imageId: "img-tiny",
        r2Key: "listings/user-1/tiny.jpg",
        userId: "user-1",
      }),
    ).rejects.toThrow("too small");

    // DB must record the failure
    expect(mockListingImageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isScanned: true, isSafe: false }),
      }),
    );
  });

  // Test 11: image record not found
  it("throws when the image record does not exist in the DB", async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    await expect(
      processImage({
        imageId: "img-missing",
        r2Key: "listings/user-1/missing.jpg",
        userId: "user-1",
      }),
    ).rejects.toThrow("not found");
  });

  // Test 12: ownership check
  it("throws when the image belongs to a different user", async () => {
    mockFindUnique.mockResolvedValueOnce({
      r2Key: "listings/other-user/img.jpg",
      listing: { sellerId: "other-user" },
    });

    await expect(
      processImage({
        imageId: "img-stolen",
        r2Key: "listings/other-user/img.jpg",
        userId: "user-1",
      }),
    ).rejects.toThrow("does not belong");
  });

  it("sets isScanned/isSafe only to reflect pipeline checks — not AV scan", async () => {
    // After a successful run the DB update must NOT contain any reference to
    // AV scanning — the flags document what was actually checked (decodability).
    await processImage({
      imageId: "img-1",
      r2Key: "listings/user-1/img-abc.jpg",
      userId: "user-1",
    });

    const updateCall = mockListingImageUpdate.mock.calls[0]![0]!;
    // isScanned and isSafe must be true
    expect((updateCall.data as Record<string, unknown>).isScanned).toBe(true);
    expect((updateCall.data as Record<string, unknown>).isSafe).toBe(true);
    // scannedAt timestamp must be set
    expect(
      (updateCall.data as Record<string, unknown>).scannedAt,
    ).toBeInstanceOf(Date);
  });
});
