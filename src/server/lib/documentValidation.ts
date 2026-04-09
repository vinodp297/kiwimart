// src/server/lib/documentValidation.ts
// ─── KYC Document Validation Pipeline ────────────────────────────────────────
// Validates uploaded document files (JPEG, PNG, PDF) before they are accepted
// for identity verification review.
//
// Checks applied (in order):
//   1. File size ≤ maxSizeBytes
//   2. MIME type whitelist
//   3. Magic byte validation — confirms file bytes match declared type
//   4. Image decodability check via sharp (images only — PDF skipped)
//   5. Minimum dimensions check (images only — ensures document is readable)
//   6. scanForMalware() — AV integration point (currently a placeholder)
//
// PDF magic bytes: %PDF = 0x25 0x50 0x44 0x46
// JPEG magic bytes: 0xFF 0xD8 0xFF  (reused from fileValidation.ts)
// PNG  magic bytes: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A (reused)

import sharp from "sharp";
import { validateMagicBytes } from "@/server/lib/fileValidation";
import { scanForMalware } from "@/server/actions/imageProcessor";

// PDF magic bytes now live in fileValidation.ts alongside JPEG/PNG/WebP.
// validateMagicBytes() handles all supported types in one place.

// ── Public types ──────────────────────────────────────────────────────────────

export interface DocumentValidationResult {
  isValid: boolean;
  error?: string;
  errorCode?: string;
  metadata?: {
    width?: number;
    height?: number;
    format?: string;
    sizeBytes: number;
  };
}

// ── validateUploadedDocument ──────────────────────────────────────────────────

/**
 * Validate an uploaded document buffer.
 *
 * Applies the same level of validation as the listing image pipeline, plus
 * PDF support and a higher minimum resolution requirement for document
 * readability.
 *
 * @param buffer        Raw bytes of the uploaded file.
 * @param mimeType      Client-declared MIME type (confirmed by magic bytes).
 * @param options       Validation configuration:
 *   maxSizeBytes         Maximum allowed file size in bytes.
 *   acceptedMimeTypes    Whitelist of allowed MIME types.
 *   requireMinResolution Minimum width × height for image files (optional).
 *                        Skipped for PDF — not applicable.
 *
 * @returns DocumentValidationResult with isValid, human-readable NZ English
 *          error messages, machine-readable errorCodes, and file metadata.
 */
export async function validateUploadedDocument(
  buffer: Buffer,
  mimeType: string,
  options: {
    maxSizeBytes: number;
    acceptedMimeTypes: string[];
    requireMinResolution?: { width: number; height: number };
  },
): Promise<DocumentValidationResult> {
  const isPdf = mimeType === "application/pdf";

  // 1. File size limit
  if (buffer.length > options.maxSizeBytes) {
    const maxMb = Math.round(options.maxSizeBytes / (1024 * 1024));
    return {
      isValid: false,
      error: `Document file is too large (maximum ${maxMb}MB)`,
      errorCode: "FILE_TOO_LARGE",
    };
  }

  // 2. MIME type whitelist
  if (!options.acceptedMimeTypes.includes(mimeType)) {
    return {
      isValid: false,
      error: "Document must be JPEG, PNG, or PDF",
      errorCode: "INVALID_MIME_TYPE",
    };
  }

  // 3. Magic byte validation — prevents MIME-type spoofing
  if (!validateMagicBytes(buffer, mimeType)) {
    return {
      isValid: false,
      error: "Document file type is not valid",
      errorCode: "INVALID_FILE_TYPE",
    };
  }

  let width: number | undefined;
  let height: number | undefined;
  let format: string | undefined;

  if (!isPdf) {
    // 4. Decodability check — sharp validates the image structure.
    // A corrupt file or a binary disguised with correct magic bytes will fail here.
    try {
      const meta = await sharp(buffer).metadata();
      width = meta.width;
      height = meta.height;
      format = meta.format;
    } catch {
      return {
        isValid: false,
        error: "Document image could not be decoded — the file may be corrupt",
        errorCode: "UNDECODABLE_IMAGE",
      };
    }

    // 5. Minimum resolution — a blurry or tiny licence scan is unreadable.
    if (options.requireMinResolution) {
      const { width: minW, height: minH } = options.requireMinResolution;
      if ((width ?? 0) < minW || (height ?? 0) < minH) {
        return {
          isValid: false,
          error: "Document image is too small to be readable",
          errorCode: "BELOW_MIN_RESOLUTION",
        };
      }
    }
  } else {
    // PDF — format is known, dimensions not applicable
    format = "pdf";
  }

  // 6. Malware scan integration point
  // scanForMalware() currently returns { isSafe: true } (placeholder).
  // Replace its body with a real AV service to activate this gate.
  // See docs/RUNBOOK.md → "How to add real AV scanning in future".
  const scanResult = await scanForMalware(
    buffer,
    `document.${format ?? "bin"}`,
  );
  if (!scanResult.isSafe) {
    return {
      isValid: false,
      error: `Document failed security check: ${scanResult.reason ?? "unknown reason"}`,
      errorCode: "MALWARE_DETECTED",
    };
  }

  return {
    isValid: true,
    metadata: {
      width,
      height,
      format,
      sizeBytes: buffer.length,
    },
  };
}
