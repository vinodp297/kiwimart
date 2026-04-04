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
import db from "@/lib/db";
import { userRepository } from "@/modules/users/user.repository";
import { notificationRepository } from "@/modules/notifications/notification.repository";
import crypto from "crypto";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, R2_BUCKET } from "@/infrastructure/storage/r2";
import type { ActionResult } from "@/types";
import {
  requestVerificationUploadSchema,
  submitIdVerificationSchema,
} from "@/server/validators";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

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

    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      return {
        success: false,
        error: "File type not allowed. Accepted types: JPG, PNG, WebP.",
      };
    }

    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      return { success: false, error: "File too large. Maximum size is 8MB." };
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
    if (!dbUser.sellerEnabled)
      return { success: false, error: "Seller account is not enabled." };

    // Check for existing pending application
    const existing = await db.verificationApplication.findUnique({
      where: { sellerId: user.id },
      select: { status: true },
    });
    if (existing?.status === "PENDING") {
      return {
        success: false,
        error: "You already have a verification application under review.",
      };
    }

    // Upsert application with document keys
    await db.verificationApplication.upsert({
      where: { sellerId: user.id },
      create: {
        sellerId: user.id,
        status: "PENDING",
        documentType,
        documentFrontKey,
        documentBackKey: documentBackKey ?? null,
        selfieKey: selfieKey ?? null,
      },
      update: {
        status: "PENDING",
        appliedAt: new Date(),
        reviewedAt: null,
        reviewedBy: null,
        adminNotes: null,
        documentType,
        documentFrontKey,
        documentBackKey: documentBackKey ?? null,
        selfieKey: selfieKey ?? null,
      },
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
