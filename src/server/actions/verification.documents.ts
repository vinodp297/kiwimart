"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/verification.documents.ts
// ─── ID Verification Document Upload + Submission ─────────────────────────────
// Two-phase upload: presigned URL → direct R2 upload → submit for review.
// Documents stored in separate R2 prefix: verification/{userId}/

import { requireUser } from "@/server/lib/requireUser";
import { requireAdmin } from "@/server/lib/requireAdmin";
import { rateLimit } from "@/server/lib/rateLimit";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { verificationRepository } from "@/modules/sellers/verification.repository";
import { userRepository } from "@/modules/users/user.repository";
import { notificationRepository } from "@/modules/notifications/notification.repository";
import { validateUploadedDocument } from "@/server/lib/documentValidation";
import crypto from "crypto";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, R2_BUCKET } from "@/infrastructure/storage/r2";
import type { ActionResult } from "@/types";
import {
  requestVerificationUploadSchema,
  submitIdVerificationSchema,
} from "@/server/validators";

// ── KYC upload constants ──────────────────────────────────────────────────────
// Documents can be larger than listing images (passport scans, business docs).
const KYC_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const;
const KYC_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
// Minimum resolution for image documents — must be readable by an admin reviewer.
const KYC_MIN_RESOLUTION = { width: 600, height: 400 };

/** Derive MIME type from the R2 key extension set during requestVerificationUpload. */
function getMimeTypeFromKey(r2Key: string): string | null {
  const ext = r2Key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    default:
      return null;
  }
}

// Legacy constant kept for requestVerificationUpload which still accepts WebP
// (selfie photos from mobile cameras). The strict KYC list excludes WebP.
const UPLOAD_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB — aligned with KYC_MAX_FILE_SIZE_BYTES

// ── requestVerificationUpload — returns presigned URL ─────────────────────────

export async function requestVerificationUpload(
  raw: unknown,
): Promise<ActionResult<{ uploadUrl: string; r2Key: string }>> {
  try {
    const user = await requireUser();

    const parsed = requestVerificationUploadSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const { fileName: _fileName, contentType, sizeBytes } = parsed.data;

    if (!UPLOAD_ALLOWED_MIME_TYPES.includes(contentType)) {
      return {
        success: false,
        error: "File type not allowed. Accepted types: JPG, PNG, WebP, PDF.",
      };
    }

    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      return { success: false, error: "File too large. Maximum size is 10MB." };
    }

    // Rate limit — 10 uploads per hour per user
    const limit = await rateLimit("listing", user.id);
    if (!limit.success) {
      return {
        success: false,
        error: "Too many uploads. Please wait a moment.",
      };
    }

    // Generate scoped R2 key: verification/{userId}/{uuid}.{ext}
    const ext = (contentType.split("/")[1] ?? "bin").replace("jpeg", "jpg");
    const uuid = crypto.randomUUID();
    const r2Key = `verification/${user.id}/${uuid}.${ext}`;

    // Presigned PUT URL (5 min expiry)
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 300 });

    return { success: true, data: { uploadUrl, r2Key } };
  } catch (err) {
    logger.error("verification:upload-request-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't prepare the upload. Please try again.",
      ),
    };
  }
}

// ── submitIdVerification — submit documents for admin review ──────────────────

export async function submitIdVerification(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    const parsed = submitIdVerificationSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const { documentType, documentFrontKey, documentBackKey, selfieKey } =
      parsed.data;

    // Validate R2 keys are scoped to this user
    const prefix = `verification/${user.id}/`;
    if (!documentFrontKey.startsWith(prefix)) {
      return { success: false, error: "Invalid document upload." };
    }
    if (documentBackKey && !documentBackKey.startsWith(prefix)) {
      return { success: false, error: "Invalid document upload." };
    }
    if (selfieKey && !selfieKey.startsWith(prefix)) {
      return { success: false, error: "Invalid document upload." };
    }

    // Check not already verified
    const dbUser = await userRepository.findVerificationDocStatus(user.id);
    if (!dbUser) return { success: false, error: "User not found." };
    if (dbUser.idVerified)
      return { success: false, error: "Your identity is already verified." };
    if (!dbUser.isSellerEnabled)
      return { success: false, error: "Seller account is not enabled." };

    // Check for existing pending application
    const existing = await verificationRepository.findStatusBySeller(user.id);
    if (existing?.status === "PENDING") {
      return {
        success: false,
        error: "You already have a verification application under review.",
      };
    }

    // ── Document validation pipeline ────────────────────────────────────────
    // Download each uploaded document from R2 and run magic byte, decodability,
    // resolution, and malware checks before accepting the submission.
    // Only the front document's metadata is stored; back and selfie are validated
    // but their dimensions are not persisted separately.

    const keysToValidate: string[] = [
      documentFrontKey,
      ...(documentBackKey ? [documentBackKey] : []),
      ...(selfieKey ? [selfieKey] : []),
    ];

    let frontValidationMetadata:
      | { format?: string; sizeBytes: number; width?: number; height?: number }
      | undefined;

    for (const r2Key of keysToValidate) {
      const mimeType = getMimeTypeFromKey(r2Key);
      if (!mimeType) {
        return {
          success: false,
          error: "Document must be JPEG, PNG, or PDF",
        };
      }

      // Download file from R2 to inspect actual bytes
      const getCmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: r2Key });
      const response = await r2.send(getCmd);
      if (!response.Body) {
        return {
          success: false,
          error:
            "We couldn't retrieve the uploaded document. Please try again.",
        };
      }
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk as Uint8Array);
      }
      const buffer = Buffer.concat(chunks);

      const validation = await validateUploadedDocument(buffer, mimeType, {
        maxSizeBytes: KYC_MAX_FILE_SIZE_BYTES,
        acceptedMimeTypes: [...KYC_ALLOWED_MIME_TYPES],
        requireMinResolution:
          mimeType !== "application/pdf" ? KYC_MIN_RESOLUTION : undefined,
      });

      if (!validation.isValid) {
        logger.warn("verification:document-validation-failed", {
          userId: user.id,
          errorCode: validation.errorCode,
          // Do not log r2Key or any identifying detail — privacy requirement
        });
        return {
          success: false,
          error:
            validation.error ?? "Document validation failed. Please try again.",
        };
      }

      // Store metadata from the primary (front) document only
      if (r2Key === documentFrontKey) {
        frontValidationMetadata = validation.metadata;
      }
    }

    // Upsert application with document keys and front-document metadata
    await verificationRepository.upsertWithDocuments(user.id, {
      documentType,
      documentFrontKey,
      documentBackKey: documentBackKey ?? null,
      selfieKey: selfieKey ?? null,
      documentFormat: frontValidationMetadata?.format ?? null,
      documentSizeBytes: frontValidationMetadata?.sizeBytes ?? null,
      documentWidth: frontValidationMetadata?.width ?? null,
      documentHeight: frontValidationMetadata?.height ?? null,
    });

    // Set user.idSubmittedAt
    await userRepository.update(user.id, { idSubmittedAt: new Date() });

    // Notify admins
    notificationRepository
      .notifyAdmins({
        type: "SYSTEM",
        title: "New ID verification to review",
        body: `${user.email} submitted ${documentType.replace(/_/g, " ").toLowerCase()} for identity verification.`,
        link: `/admin/sellers/${user.id}/verify`,
      })
      .catch(() => {});

    audit({
      userId: user.id,
      action: "ID_VERIFICATION_SUBMITTED",
      entityType: "User",
      entityId: user.id,
      metadata: { documentType },
    });

    logger.info("verification:id-submitted", {
      userId: user.id,
      documentType,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't submit your verification. Please try again.",
      ),
    };
  }
}

// ── getVerificationDocumentUrl — admin-only signed URL for viewing ────────────

export async function getVerificationDocumentUrl(
  r2Key: string,
): Promise<ActionResult<{ url: string }>> {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    if (!r2Key.startsWith("verification/")) {
      return { success: false, error: "Invalid document key." };
    }

    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
    });
    const url = await getSignedUrl(r2, command, { expiresIn: 300 }); // 5 min

    // Audit every document view
    audit({
      userId: guard.userId,
      action: "VERIFICATION_DOCUMENT_VIEWED",
      entityType: "VerificationApplication",
      metadata: { r2Key },
    });

    return { success: true, data: { url } };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Could not load document."),
    };
  }
}
