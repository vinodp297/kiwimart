"use server";
// src/server/actions/order-create.actions.ts
// ─── Order creation + evidence upload server actions ──────────────────────────

import { randomUUID } from "crypto";
import { safeActionError } from "@/shared/errors";
import { headers } from "next/headers";
import { requireUser } from "@/server/lib/requireUser";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import type { ActionResult } from "@/types";
import { logger } from "@/shared/logger";
import { orderService } from "@/modules/orders/order.service";
import { createOrderSchema as CreateOrderSchema } from "@/server/validators";

import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2, R2_BUCKET } from "@/infrastructure/storage/r2";
import { validateImageFile } from "@/server/lib/fileValidation";

// ── createOrder ───────────────────────────────────────────────────────────────

export async function createOrder(params: {
  listingId: string;
  idempotencyKey?: string;
  fulfillmentType?: "SHIPPED" | "CASH_ON_PICKUP" | "ONLINE_PAYMENT_PICKUP";
  shippingAddress?: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postcode: string;
  };
}): Promise<ActionResult<{ orderId: string; clientSecret: string | null }>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders as unknown as Headers);

  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Authentication required."),
      reason: "auth_required",
    };
  }

  const limit = await rateLimit("order", user.id);
  if (!limit.success) {
    return {
      success: false,
      error: "Too many orders placed. Please wait before trying again.",
      reason: "rate_limited",
    };
  }

  const parsed = CreateOrderSchema.safeParse(params);
  if (!parsed.success) {
    return {
      success: false,
      error:
        parsed.error.issues[0]?.message ??
        "Please check your input and try again.",
      reason: "validation_error",
    };
  }

  const result = await orderService.createOrder(
    user.id,
    user.email,
    parsed.data,
    ip,
  );

  if (!result.ok) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: { orderId: result.orderId, clientSecret: result.clientSecret },
  };
}

// ── uploadOrderEvidence ───────────────────────────────────────────────────────

const EVIDENCE_MAX_SIZE = 5 * 1024 * 1024; // 5MB

// parseInt with NaN guard — a typo in DISPUTE_EVIDENCE_MAX_FILES (e.g. "four")
// would yield NaN, and `files.length > NaN` is always false, silently lifting
// the cap. Fall back to 4 unless the env var parses as a positive integer.
const _parsed = parseInt(process.env.DISPUTE_EVIDENCE_MAX_FILES ?? "4", 10);
const EVIDENCE_MAX_FILES =
  Number.isFinite(_parsed) && _parsed > 0 ? _parsed : 4;

export async function uploadOrderEvidence(
  formData: FormData,
  context: "dispatch" | "delivery",
): Promise<ActionResult<{ keys: string[] }>> {
  try {
    const user = await requireUser();

    // Use the dedicated "evidence" bucket — separate from "order" so a buyer
    // uploading dispute photos does not burn their order-creation budget.
    const limit = await rateLimit("evidence", user.id);
    if (!limit.success) {
      return {
        success: false,
        error: "Too many uploads. Please try again later.",
      };
    }

    const files = formData.getAll("files") as File[];
    if (files.length === 0) {
      return { success: false, error: "No files provided." };
    }
    if (files.length > EVIDENCE_MAX_FILES) {
      return {
        success: false,
        error: `Maximum ${EVIDENCE_MAX_FILES} photos allowed.`,
      };
    }

    const buffers = await Promise.all(
      files.map((f) => f.arrayBuffer().then((ab) => Buffer.from(ab))),
    );

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const buffer = buffers[i]!;
      const validation = validateImageFile({
        buffer,
        mimetype: file.type,
        size: file.size,
        originalname: file.name,
      });
      if (!validation.valid) {
        return { success: false, error: validation.error ?? "Invalid file." };
      }
      if (file.size > EVIDENCE_MAX_SIZE) {
        return { success: false, error: "Each photo must be under 5MB." };
      }
    }

    const uploads = files.map((file, i) => {
      const buffer = buffers[i]!;
      const ext =
        file.type === "image/jpeg"
          ? "jpg"
          : file.type === "image/png"
            ? "png"
            : "webp";
      // crypto.randomUUID() — replaces Date.now()+Math.random() which had a
      // collision risk under concurrent uploads at millisecond boundaries.
      const key = `${context}/${user.id}/${randomUUID()}.${ext}`;
      return { key, buffer, contentType: file.type };
    });

    // Track successful uploads so we can clean them up on partial failure.
    // Without this, files 1..N already in R2 become orphans with no owning
    // record if file N+1 fails — accumulating cost and dangling PII.
    const successfulKeys: string[] = [];
    try {
      await Promise.all(
        uploads.map(async ({ key, buffer, contentType }) => {
          await r2.send(
            new PutObjectCommand({
              Bucket: R2_BUCKET,
              Key: key,
              Body: buffer,
              ContentType: contentType,
            }),
          );
          successfulKeys.push(key);
        }),
      );
    } catch (uploadErr) {
      if (successfulKeys.length > 0) {
        await Promise.allSettled(
          successfulKeys.map((key) =>
            r2.send(
              new DeleteObjectCommand({
                Bucket: R2_BUCKET,
                Key: key,
              }),
            ),
          ),
        );
        logger.error("evidence.partial_upload_cleaned", {
          userId: user.id,
          context,
          cleanedKeys: successfulKeys.length,
          totalKeys: uploads.length,
          error:
            uploadErr instanceof Error ? uploadErr.message : String(uploadErr),
        });
      }
      throw uploadErr;
    }

    const uploadedKeys = uploads.map((u) => u.key);

    logger.info(`order.${context}_evidence.uploaded`, {
      userId: user.id,
      count: uploadedKeys.length,
    });

    return { success: true, data: { keys: uploadedKeys } };
  } catch (err) {
    logger.error(`order.${context}_evidence.upload.failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: "Failed to upload photos. Please try again.",
    };
  }
}
