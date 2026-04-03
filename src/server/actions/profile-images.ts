"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/profile-images.ts
// ─── Profile Image Upload Server Actions ─────────────────────────────────────
// Handles avatar and cover image uploads for user profiles.
//
// Flow:
//   1. Client calls requestProfileImageUpload() → gets presigned PUT URL + r2Key
//   2. Client PUTs cropped blob directly to R2 (bypasses our server)
//   3. Client calls confirmProfileImageUpload() → updates user record, deletes old key
//
// R2 key format:
//   profiles/{userId}/avatar/{uuid}.jpg
//   profiles/{userId}/cover/{uuid}.jpg

import { requireUser } from "@/server/lib/requireUser";
import { userRepository } from "@/modules/users/user.repository";
import { rateLimit } from "@/server/lib/rateLimit";
import type { ActionResult } from "@/types";
import crypto from "crypto";
import {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { validateMagicBytes } from "@/server/lib/fileValidation";
import { logger } from "@/shared/logger";

export type ProfileImageType = "avatar" | "cover";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// ── requestProfileImageUpload ─────────────────────────────────────────────────

export async function requestProfileImageUpload(params: {
  contentType: string;
  sizeBytes: number;
  imageType: ProfileImageType;
}): Promise<ActionResult<{ uploadUrl: string; r2Key: string }>> {
  try {
    const user = await requireUser();

    if (!ALLOWED_TYPES.includes(params.contentType)) {
      return {
        success: false,
        error: "File type not allowed. Use JPG, PNG or WebP.",
      };
    }
    if (params.sizeBytes > MAX_BYTES) {
      return { success: false, error: "File too large. Maximum size is 5 MB." };
    }

    const limit = await rateLimit("auth", user.id);
    if (!limit.success) {
      return {
        success: false,
        error: `Too many uploads. Try again in ${limit.retryAfter} seconds.`,
      };
    }

    const ext =
      params.contentType === "image/png"
        ? "png"
        : params.contentType === "image/webp"
          ? "webp"
          : "jpg";
    const uuid = crypto.randomUUID();
    const r2Key = `profiles/${user.id}/${params.imageType}/${uuid}.${ext}`;

    // Lazy import so dev without R2 credentials doesn't crash on module load
    const { r2, R2_BUCKET } = await import("@/infrastructure/storage/r2");
    // Note: Do NOT include ContentLength — it gets signed into the presigned URL
    // and causes SignatureDoesNotMatch on R2 if the browser's Content-Length
    // differs (e.g. after client-side cropping resizes the blob).
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      ContentType: params.contentType,
    });
    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 300 }); // 5 min

    return { success: true, data: { uploadUrl, r2Key } };
  } catch (err) {
    const msg = safeActionError(err, "Storage unavailable.");
    // Graceful degradation when R2 is not configured (dev)
    if (
      msg.includes("credentials") ||
      msg.includes("not set") ||
      msg.includes("PLACEHOLDER")
    ) {
      return {
        success: false,
        error: "Image storage is not configured in this environment.",
      };
    }
    return { success: false, error: msg };
  }
}

// ── confirmProfileImageUpload ─────────────────────────────────────────────────

export async function confirmProfileImageUpload(params: {
  r2Key: string;
  imageType: ProfileImageType;
}): Promise<ActionResult<{ newKey: string }>> {
  try {
    const user = await requireUser();

    // Verify key is scoped to this user
    const expectedPrefix = `profiles/${user.id}/${params.imageType}/`;
    if (!params.r2Key.startsWith(expectedPrefix)) {
      return { success: false, error: "Unauthorised image key." };
    }

    // Post-upload validation: read the first bytes from R2 and verify magic bytes.
    // Presigned uploads bypass the server, so this is our only chance to validate
    // that the uploaded file is actually an image (not a malformed/malicious file).
    try {
      const { r2: r2Client, R2_BUCKET: bucket } =
        await import("@/infrastructure/storage/r2");
      const getCmd = new GetObjectCommand({
        Bucket: bucket,
        Key: params.r2Key,
      });
      const s3Obj = await r2Client.send(getCmd);

      // Read just enough bytes for magic byte detection (first 16 bytes)
      const reader = s3Obj.Body as AsyncIterable<Uint8Array>;
      const chunks: Buffer[] = [];
      let totalRead = 0;
      for await (const chunk of reader) {
        chunks.push(Buffer.from(chunk));
        totalRead += chunk.length;
        if (totalRead >= 16) break;
      }
      const headerBytes = Buffer.concat(chunks).subarray(0, 16);

      // Determine expected MIME type from file extension
      const claimedType = params.r2Key.endsWith(".png")
        ? "image/png"
        : params.r2Key.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";

      if (!validateMagicBytes(headerBytes, claimedType)) {
        // Invalid file — delete from R2 and reject
        await r2Client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: params.r2Key }),
        );
        logger.warn("profile.image.invalid_magic_bytes", {
          userId: user.id,
          r2Key: params.r2Key,
          claimedType,
        });
        return {
          success: false,
          error: "Invalid image file. Please upload a valid JPEG, PNG or WebP.",
        };
      }
    } catch (validationErr) {
      // If R2 is unreachable (dev without credentials), log and proceed.
      // In production, R2 is always available, so this is only a dev concern.
      const msg =
        validationErr instanceof Error
          ? validationErr.message
          : String(validationErr);
      if (
        msg.includes("getaddrinfo") ||
        msg.includes("ENOTFOUND") ||
        msg.includes("credentials") ||
        msg.includes("not set")
      ) {
        logger.warn("profile.image.validation_skipped_no_r2", {
          userId: user.id,
        });
      } else {
        throw validationErr;
      }
    }

    // Fetch old key for cleanup
    const current = await userRepository.findImageKeys(user.id);
    const oldKey =
      params.imageType === "avatar"
        ? current?.avatarKey
        : current?.coverImageKey;

    // Update user record — only after validation passes
    await userRepository.update(
      user.id,
      params.imageType === "avatar"
        ? { avatarKey: params.r2Key }
        : { coverImageKey: params.r2Key },
    );

    // Delete old image from R2 (fire-and-forget, skip seed/external URLs)
    if (oldKey && oldKey.startsWith("profiles/")) {
      import("@/infrastructure/storage/r2")
        .then(({ r2, R2_BUCKET }) =>
          r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: oldKey })),
        )
        .catch(() => {});
    }

    return { success: true, data: { newKey: params.r2Key } };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "Your profile photo couldn't be processed. Please try a different image.",
      ),
    };
  }
}
