// src/test/upload-pipeline.test.ts
// ─── Upload Pipeline — imageProcessor + fileValidation ──────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import { processImage, scanForMalware } from "@/server/actions/imageProcessor";
import {
  validateImageFile,
  validateMagicBytes,
} from "@/server/lib/fileValidation";

// ── Mock sharp ──────────────────────────────────────────────────────────────
const mockMetadata = vi.fn();
const mockToBuffer = vi.fn();
const mockRotate = vi.fn();
const mockResize = vi.fn();
const mockWebp = vi.fn();

vi.mock("sharp", () => {
  const chain = {
    metadata: (...args: unknown[]) => mockMetadata(...args),
    rotate: (...args: unknown[]) => {
      mockRotate(...args);
      return chain;
    },
    resize: (...args: unknown[]) => {
      mockResize(...args);
      return chain;
    },
    webp: (...args: unknown[]) => {
      mockWebp(...args);
      return chain;
    },
    toBuffer: (...args: unknown[]) => mockToBuffer(...args),
  };
  return { default: () => chain };
});

// ── Mock listing-image repository ───────────────────────────────────────────
const mockFindWithListing = vi.fn();
const mockMarkUnsafe = vi.fn();
const mockMarkProcessed = vi.fn();

vi.mock("@/modules/listings/listing-image.repository", () => ({
  listingImageRepository: {
    findWithListing: (...args: unknown[]) => mockFindWithListing(...args),
    markUnsafe: (...args: unknown[]) => mockMarkUnsafe(...args),
    markProcessed: (...args: unknown[]) => mockMarkProcessed(...args),
  },
}));

// ── Mock R2 ─────────────────────────────────────────────────────────────────
const mockR2Send = vi.fn();
vi.mock("@/infrastructure/storage/r2", () => ({
  r2: { send: (...args: unknown[]) => mockR2Send(...args) },
  R2_BUCKET: "test-bucket",
}));

// ── Mock AWS S3 commands ────────────────────────────────────────────────────
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
  DeleteObjectCommand: class DeleteObjectCommand {
    constructor(p: unknown) {
      Object.assign(this, p);
    }
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const WEBP_HEADER = Buffer.from([0x52, 0x49, 0x46, 0x46]);

function mockR2Download(buf: Buffer) {
  mockR2Send.mockResolvedValueOnce({
    Body: {
      [Symbol.asyncIterator]: async function* () {
        yield buf;
      },
    },
  });
}

function setupSuccessfulPipeline() {
  const buf = Buffer.alloc(1024);
  JPEG_HEADER.copy(buf);

  mockFindWithListing.mockResolvedValue({
    r2Key: "listings/user-1/img.jpg",
    listing: null,
  });
  mockR2Download(buf);
  mockMetadata.mockResolvedValue({ width: 800, height: 600 });
  mockToBuffer.mockResolvedValue({
    data: Buffer.alloc(512),
    info: { width: 800, height: 600, size: 512 },
  });
  mockR2Send.mockResolvedValue({}); // uploads
  mockMarkProcessed.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// Magic byte validation (fileValidation.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("validateMagicBytes", () => {
  it("accepts valid JPEG buffer", () => {
    expect(validateMagicBytes(JPEG_HEADER, "image/jpeg")).toBe(true);
  });

  it("accepts valid PNG buffer", () => {
    expect(validateMagicBytes(PNG_HEADER, "image/png")).toBe(true);
  });

  it("accepts valid WebP buffer", () => {
    expect(validateMagicBytes(WEBP_HEADER, "image/webp")).toBe(true);
  });

  it("rejects buffer with wrong magic bytes", () => {
    expect(
      validateMagicBytes(Buffer.from([0x00, 0x01, 0x02]), "image/jpeg"),
    ).toBe(false);
  });

  it("rejects unknown MIME type", () => {
    expect(validateMagicBytes(JPEG_HEADER, "application/pdf")).toBe(false);
  });

  it("rejects buffer shorter than expected signature", () => {
    expect(validateMagicBytes(Buffer.from([0xff]), "image/jpeg")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Full file validation (fileValidation.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("validateImageFile", () => {
  it("accepts valid JPEG upload", () => {
    const buf = Buffer.alloc(256);
    JPEG_HEADER.copy(buf);
    const result = validateImageFile({
      buffer: buf,
      mimetype: "image/jpeg",
      size: 256,
      originalname: "photo.jpg",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects SVG uploads (XSS risk)", () => {
    const result = validateImageFile({
      buffer: Buffer.from("<svg>"),
      mimetype: "image/svg+xml",
      size: 5,
      originalname: "vector.svg",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("SVG");
  });

  it("rejects dangerous extensions regardless of MIME type", () => {
    const buf = Buffer.alloc(256);
    JPEG_HEADER.copy(buf);
    const result = validateImageFile({
      buffer: buf,
      mimetype: "image/jpeg",
      size: 256,
      originalname: "shell.php",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not allowed");
  });

  it("rejects unsupported MIME type", () => {
    const result = validateImageFile({
      buffer: Buffer.from([0x25, 0x50, 0x44, 0x46]),
      mimetype: "application/pdf",
      size: 100,
      originalname: "doc.pdf",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("JPEG, PNG, and WebP");
  });

  it("rejects files exceeding 8 MB size limit", () => {
    const buf = Buffer.alloc(256);
    JPEG_HEADER.copy(buf);
    const result = validateImageFile({
      buffer: buf,
      mimetype: "image/jpeg",
      size: 9 * 1024 * 1024,
      originalname: "huge.jpg",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("8 MB");
  });

  it("rejects MIME-spoofed file (PNG header declared as JPEG)", () => {
    const result = validateImageFile({
      buffer: PNG_HEADER,
      mimetype: "image/jpeg",
      size: 4,
      originalname: "spoofed.jpg",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("do not match");
  });

  it("rejects .exe disguised with JPEG extension", () => {
    const result = validateImageFile({
      buffer: Buffer.from([0x4d, 0x5a]),
      mimetype: "image/jpeg",
      size: 2,
      originalname: "malware.exe",
    });
    expect(result.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// scanForMalware (imageProcessor.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("scanForMalware", () => {
  it("returns isSafe true for a clean buffer with no threats", async () => {
    const result = await scanForMalware(Buffer.alloc(100), "test.jpg");
    expect(result.isSafe).toBe(true);
    expect(result.threats).toHaveLength(0);
    expect(result.confidence).toBe("heuristic");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// processImage pipeline (imageProcessor.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("processImage", () => {
  it("processes a valid image end-to-end", async () => {
    setupSuccessfulPipeline();

    const result = await processImage({
      imageId: "img-1",
      r2Key: "listings/user-1/img.jpg",
      userId: "user-1",
    });

    expect(result.success).toBe(true);
    expect(result.fullKey).toContain("-full.webp");
    expect(result.thumbKey).toContain("-thumb.webp");
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(mockMarkProcessed).toHaveBeenCalledOnce();
  });

  it("throws when image not found in DB", async () => {
    mockFindWithListing.mockResolvedValue(null);

    await expect(
      processImage({
        imageId: "nope",
        r2Key: "listings/user-1/x.jpg",
        userId: "user-1",
      }),
    ).rejects.toThrow("not found");
  });

  it("throws when image does not belong to user", async () => {
    mockFindWithListing.mockResolvedValue({
      r2Key: "listings/other-user/img.jpg",
      listing: { sellerId: "other-user" },
    });

    await expect(
      processImage({
        imageId: "img-1",
        r2Key: "listings/other-user/img.jpg",
        userId: "user-1",
      }),
    ).rejects.toThrow("does not belong");
  });

  it("throws when R2 download returns no body", async () => {
    mockFindWithListing.mockResolvedValue({
      r2Key: "listings/user-1/img.jpg",
      listing: null,
    });
    mockR2Send.mockResolvedValueOnce({ Body: null });

    await expect(
      processImage({
        imageId: "img-1",
        r2Key: "listings/user-1/img.jpg",
        userId: "user-1",
      }),
    ).rejects.toThrow("Failed to download");
  });

  it("marks image unsafe and throws on corrupt file (decode failure)", async () => {
    mockFindWithListing.mockResolvedValue({
      r2Key: "listings/user-1/img.jpg",
      listing: null,
    });
    mockR2Download(Buffer.from("not-an-image"));
    mockMetadata.mockRejectedValue(new Error("Invalid image"));

    await expect(
      processImage({
        imageId: "img-1",
        r2Key: "listings/user-1/img.jpg",
        userId: "user-1",
      }),
    ).rejects.toThrow("corrupt");
    expect(mockMarkUnsafe).toHaveBeenCalledWith("img-1");
  });

  it("marks image unsafe and throws when dimensions are below 200×200", async () => {
    mockFindWithListing.mockResolvedValue({
      r2Key: "listings/user-1/img.jpg",
      listing: null,
    });
    mockR2Download(Buffer.alloc(256));
    mockMetadata.mockResolvedValue({ width: 100, height: 50 });

    await expect(
      processImage({
        imageId: "img-1",
        r2Key: "listings/user-1/img.jpg",
        userId: "user-1",
      }),
    ).rejects.toThrow("too small");
    expect(mockMarkUnsafe).toHaveBeenCalledWith("img-1");
  });

  it("strips EXIF by converting to WebP via sharp", async () => {
    setupSuccessfulPipeline();

    await processImage({
      imageId: "img-1",
      r2Key: "listings/user-1/img.jpg",
      userId: "user-1",
    });

    // sharp().rotate() auto-rotates from EXIF, then webp() strips all metadata
    expect(mockRotate).toHaveBeenCalled();
    expect(mockWebp).toHaveBeenCalled();
  });

  it("still succeeds when original file deletion fails (non-critical)", async () => {
    const buf = Buffer.alloc(1024);
    JPEG_HEADER.copy(buf);

    mockFindWithListing.mockResolvedValue({
      r2Key: "listings/user-1/img.jpg",
      listing: null,
    });
    mockMetadata.mockResolvedValue({ width: 800, height: 600 });
    mockToBuffer.mockResolvedValue({
      data: Buffer.alloc(512),
      info: { width: 800, height: 600, size: 512 },
    });
    mockMarkProcessed.mockResolvedValue(undefined);

    // Queue: download → upload × 2 → delete (fail)
    mockR2Send
      .mockResolvedValueOnce({
        Body: {
          [Symbol.asyncIterator]: async function* () {
            yield buf;
          },
        },
      })
      .mockResolvedValueOnce({}) // upload full
      .mockResolvedValueOnce({}) // upload thumb
      .mockRejectedValueOnce(new Error("delete failed")); // delete original

    const result = await processImage({
      imageId: "img-1",
      r2Key: "listings/user-1/img.jpg",
      userId: "user-1",
    });
    expect(result.success).toBe(true);
  });
});
