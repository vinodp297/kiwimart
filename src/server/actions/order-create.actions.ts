"use server";
// src/server/actions/order-create.actions.ts
// ─── Order creation + evidence upload server actions ──────────────────────────

import { safeActionError } from "@/shared/errors";
import { headers } from "next/headers";
import { requireUser } from "@/server/lib/requireUser";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import type { ActionResult } from "@/types";
import { logger } from "@/shared/logger";
import { orderService } from "@/modules/orders/order.service";
import { createOrderSchema as CreateOrderSchema } from "@/server/validators";

import { PutObjectCommand } from "@aws-sdk/client-s3";
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
const EVIDENCE_MAX_FILES = parseInt(
  process.env.DISPUTE_EVIDENCE_MAX_FILES ?? "4",
  10,
);

export async function uploadOrderEvidence(
  formData: FormData,
  context: "dispatch" | "delivery",
): Promise<ActionResult<{ keys: string[] }>> {
  try {
    const user = await requireUser();

    const limit = await rateLimit("order", user.id);
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
      const key = `${context}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      return { key, buffer, contentType: file.type };
    });

    await Promise.all(
      uploads.map(({ key, buffer, contentType }) =>
        r2.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: contentType,
          }),
        ),
      ),
    );

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
