// src/test/document-validation.test.ts
// ─── KYC Document Validation Pipeline Tests ──────────────────────────────────
//
// Tests for:
//   Part A — validateUploadedDocument (src/server/lib/documentValidation.ts)
//     1.  Valid JPEG passes all checks
//     2.  Valid PNG passes all checks
//     3.  Valid PDF passes size and magic byte check (no decodability/resolution)
//     4.  File with wrong magic bytes rejected (INVALID_FILE_TYPE)
//     5.  File exceeding 10MB rejected (FILE_TOO_LARGE)
//     6.  Image below minimum resolution rejected (BELOW_MIN_RESOLUTION)
//     7.  Corrupt/undecodable image rejected (UNDECODABLE_IMAGE)
//     8.  scanForMalware called on every valid document
//
//   Part B — submitIdVerification metadata storage
//     9.  Validation metadata stored on VerificationApplication after success

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock sharp ──────────────────────────────────────────────────────────────
const mockSharpMetadata = vi.fn();

vi.mock("sharp", () => {
  function makeChain() {
    return { metadata: mockSharpMetadata };
  }
  return { default: vi.fn().mockImplementation(makeChain) };
});

// ─── Mock scanForMalware (imageProcessor.ts — AV integration point) ──────────
const mockScanForMalware = vi.fn();
vi.mock("@/server/actions/imageProcessor", () => ({
  scanForMalware: (...a: unknown[]) => mockScanForMalware(...a),
  processImage: vi.fn(),
}));

// ─── Mock R2 + AWS SDK (needed for submitIdVerification Part B) ──────────────
const mockR2Send = vi.fn();
vi.mock("@/infrastructure/storage/r2", () => ({
  r2: { send: (...a: unknown[]) => mockR2Send(...a) },
  R2_BUCKET: "test-bucket",
}));

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
  GetObjectCommandOutput: class {},
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://r2.example.com/upload"),
}));

// ─── Mock requireUser ────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
}));

// ─── Mock requireAdmin ───────────────────────────────────────────────────────
vi.mock("@/server/lib/requireAdmin", () => ({
  requireAdmin: vi.fn(),
}));

// ─── Mock rateLimit ──────────────────────────────────────────────────────────
vi.mock("@/server/lib/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

// ─── Mock verificationRepository ────────────────────────────────────────────
const mockUpsertWithDocuments = vi.fn().mockResolvedValue(undefined);
const mockFindStatusBySeller = vi.fn().mockResolvedValue(null);

vi.mock("@/modules/sellers/verification.repository", () => ({
  verificationRepository: {
    upsertWithDocuments: (...a: unknown[]) => mockUpsertWithDocuments(...a),
    findStatusBySeller: (...a: unknown[]) => mockFindStatusBySeller(...a),
  },
}));

// ─── Mock userRepository ────────────────────────────────────────────────────
const mockFindVerificationDocStatus = vi.fn().mockResolvedValue({
  idVerified: false,
  isSellerEnabled: true,
});
const mockUserUpdate = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findVerificationDocStatus: (...a: unknown[]) =>
      mockFindVerificationDocStatus(...a),
    update: (...a: unknown[]) => mockUserUpdate(...a),
    findEmailVerified: vi.fn().mockResolvedValue({ emailVerified: new Date() }),
  },
}));

// ─── Mock notificationRepository ─────────────────────────────────────────────
vi.mock("@/modules/notifications/notification.repository", () => ({
  notificationRepository: {
    notifyAdmins: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── Lazy imports after all mocks ────────────────────────────────────────────
import { validateUploadedDocument } from "@/server/lib/documentValidation";
import { submitIdVerification } from "@/server/actions/verification.documents";

// ─── Magic byte fixtures ──────────────────────────────────────────────────────
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

const JPEG_BUFFER = Buffer.concat([JPEG_MAGIC, Buffer.alloc(200, 0x00)]);
const PNG_BUFFER = Buffer.concat([PNG_MAGIC, Buffer.alloc(200, 0x00)]);
const PDF_BUFFER = Buffer.concat([PDF_MAGIC, Buffer.alloc(200, 0x00)]);
// Wrong magic bytes: JPEG bytes but declaring PNG
const WRONG_MAGIC_BUFFER = Buffer.concat([JPEG_MAGIC, Buffer.alloc(200, 0x00)]);

const DEFAULT_OPTIONS = {
  maxSizeBytes: 10 * 1024 * 1024, // 10MB
  acceptedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
  requireMinResolution: { width: 600, height: 400 },
};

// ─────────────────────────────────────────────────────────────────────────────
// PART A — validateUploadedDocument
// ─────────────────────────────────────────────────────────────────────────────

describe("validateUploadedDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: sharp reports a 1200×800 image, malware scan returns safe
    mockSharpMetadata.mockResolvedValue({
      format: "jpeg",
      width: 1200,
      height: 800,
    });
    mockScanForMalware.mockResolvedValue({ isSafe: true });
  });

  // ── Test 1: Valid JPEG ──────────────────────────────────────────────────────
  it("passes all checks for a valid JPEG document", async () => {
    mockSharpMetadata.mockResolvedValue({
      format: "jpeg",
      width: 1200,
      height: 800,
    });

    const result = await validateUploadedDocument(
      JPEG_BUFFER,
      "image/jpeg",
      DEFAULT_OPTIONS,
    );

    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.metadata).toMatchObject({
      format: "jpeg",
      width: 1200,
      height: 800,
      sizeBytes: JPEG_BUFFER.length,
    });
  });

  // ── Test 2: Valid PNG ──────────────────────────────────────────────────────
  it("passes all checks for a valid PNG document", async () => {
    mockSharpMetadata.mockResolvedValue({
      format: "png",
      width: 800,
      height: 600,
    });

    const result = await validateUploadedDocument(
      PNG_BUFFER,
      "image/png",
      DEFAULT_OPTIONS,
    );

    expect(result.isValid).toBe(true);
    expect(result.metadata?.format).toBe("png");
    expect(result.metadata?.sizeBytes).toBe(PNG_BUFFER.length);
  });

  // ── Test 3: Valid PDF ──────────────────────────────────────────────────────
  // PDF skips decodability and resolution checks — only size + magic bytes + AV.
  it("passes size and magic byte check for a valid PDF (skips image checks)", async () => {
    const result = await validateUploadedDocument(
      PDF_BUFFER,
      "application/pdf",
      DEFAULT_OPTIONS,
    );

    expect(result.isValid).toBe(true);
    expect(result.metadata?.format).toBe("pdf");
    // sharp should NOT be called for PDF
    expect(mockSharpMetadata).not.toHaveBeenCalled();
    // Dimensions are undefined for PDF
    expect(result.metadata?.width).toBeUndefined();
    expect(result.metadata?.height).toBeUndefined();
    expect(result.metadata?.sizeBytes).toBe(PDF_BUFFER.length);
  });

  // ── Test 4: Wrong magic bytes ──────────────────────────────────────────────
  it("rejects a file whose magic bytes do not match its declared MIME type", async () => {
    // JPEG magic bytes but declared as PNG
    const result = await validateUploadedDocument(
      WRONG_MAGIC_BUFFER,
      "image/png",
      DEFAULT_OPTIONS,
    );

    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe("INVALID_FILE_TYPE");
    expect(result.error).toBe("Document file type is not valid");
    // Decodability check should not run after magic byte failure
    expect(mockSharpMetadata).not.toHaveBeenCalled();
  });

  // ── Test 5: File too large ─────────────────────────────────────────────────
  it("rejects a file exceeding the 10MB limit", async () => {
    const oversizedBuffer = Buffer.concat([
      JPEG_MAGIC,
      Buffer.alloc(10 * 1024 * 1024 + 1, 0x00), // 10MB + 1 byte
    ]);

    const result = await validateUploadedDocument(
      oversizedBuffer,
      "image/jpeg",
      DEFAULT_OPTIONS,
    );

    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe("FILE_TOO_LARGE");
    expect(result.error).toContain("10MB");
    // No further checks should run
    expect(mockSharpMetadata).not.toHaveBeenCalled();
    expect(mockScanForMalware).not.toHaveBeenCalled();
  });

  // ── Test 6: Below minimum resolution ──────────────────────────────────────
  it("rejects an image below the minimum 600×400 resolution", async () => {
    // Return small dimensions from sharp
    mockSharpMetadata.mockResolvedValue({
      format: "jpeg",
      width: 400,
      height: 300,
    });

    const result = await validateUploadedDocument(
      JPEG_BUFFER,
      "image/jpeg",
      DEFAULT_OPTIONS,
    );

    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe("BELOW_MIN_RESOLUTION");
    expect(result.error).toBe("Document image is too small to be readable");
    // scanForMalware should not run if resolution check fails
    expect(mockScanForMalware).not.toHaveBeenCalled();
  });

  // ── Test 7: Corrupt / undecodable image ───────────────────────────────────
  it("rejects a corrupt image that sharp cannot decode", async () => {
    mockSharpMetadata.mockRejectedValue(
      new Error("Input buffer contains unsupported image format"),
    );

    const result = await validateUploadedDocument(
      JPEG_BUFFER,
      "image/jpeg",
      DEFAULT_OPTIONS,
    );

    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe("UNDECODABLE_IMAGE");
    expect(result.error).toContain("could not be decoded");
    // scanForMalware should not run after decode failure
    expect(mockScanForMalware).not.toHaveBeenCalled();
  });

  // ── Test 8: scanForMalware called on valid document ────────────────────────
  it("calls scanForMalware on every valid document (JPEG, PNG, and PDF)", async () => {
    // JPEG
    mockSharpMetadata.mockResolvedValue({
      format: "jpeg",
      width: 1200,
      height: 800,
    });
    await validateUploadedDocument(JPEG_BUFFER, "image/jpeg", DEFAULT_OPTIONS);
    expect(mockScanForMalware).toHaveBeenCalledTimes(1);
    expect(mockScanForMalware).toHaveBeenCalledWith(
      JPEG_BUFFER,
      expect.stringContaining("document."),
    );

    vi.clearAllMocks();
    mockScanForMalware.mockResolvedValue({ isSafe: true });

    // PNG
    mockSharpMetadata.mockResolvedValue({
      format: "png",
      width: 800,
      height: 600,
    });
    await validateUploadedDocument(PNG_BUFFER, "image/png", DEFAULT_OPTIONS);
    expect(mockScanForMalware).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockScanForMalware.mockResolvedValue({ isSafe: true });

    // PDF
    await validateUploadedDocument(
      PDF_BUFFER,
      "application/pdf",
      DEFAULT_OPTIONS,
    );
    expect(mockScanForMalware).toHaveBeenCalledTimes(1);
    expect(mockScanForMalware).toHaveBeenCalledWith(PDF_BUFFER, "document.pdf");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART B — submitIdVerification: metadata storage
// ─────────────────────────────────────────────────────────────────────────────

describe("submitIdVerification — validation metadata stored on VerificationApplication", () => {
  const USER = { id: "user-abc", email: "kiwi@test.nz", isAdmin: false };
  const FRONT_KEY = `verification/${USER.id}/front.jpg`;

  // Minimal async iterator for mock R2 response body
  function makeAsyncBody(buf: Buffer) {
    return {
      [Symbol.asyncIterator]: async function* () {
        yield buf;
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(USER);
    mockFindVerificationDocStatus.mockResolvedValue({
      idVerified: false,
      isSellerEnabled: true,
    });
    mockFindStatusBySeller.mockResolvedValue(null);
    mockScanForMalware.mockResolvedValue({ isSafe: true });
    mockSharpMetadata.mockResolvedValue({
      format: "jpeg",
      width: 1200,
      height: 900,
    });
    // R2 returns the JPEG buffer when the document is downloaded
    mockR2Send.mockResolvedValue({ Body: makeAsyncBody(JPEG_BUFFER) });
  });

  it("stores validation metadata (format, sizeBytes, width, height) on the application", async () => {
    const result = await submitIdVerification({
      documentType: "PASSPORT",
      documentFrontKey: FRONT_KEY,
    });

    expect(result.success).toBe(true);

    // upsertWithDocuments should have been called with the metadata
    expect(mockUpsertWithDocuments).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({
        documentFrontKey: FRONT_KEY,
        documentFormat: "jpeg",
        documentSizeBytes: JPEG_BUFFER.length,
        documentWidth: 1200,
        documentHeight: 900,
      }),
    );
  });
});
