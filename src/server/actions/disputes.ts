"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/disputes.ts
// ─── Dispute Server Actions ─────────────────────────────────────────────────

import { headers } from "next/headers";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { requireUser } from "@/server/lib/requireUser";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { validateImageFile } from "@/server/lib/fileValidation";
import { orderService } from "@/modules/orders/order.service";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, R2_BUCKET } from "@/infrastructure/storage/r2";
import { logger } from "@/shared/logger";
import { audit } from "@/server/lib/audit";
import { createNotification } from "@/modules/notifications/notification.service";
import db from "@/lib/db";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { autoResolutionService } from "@/modules/disputes/auto-resolution.service";
import type { ActionResult } from "@/types";
import { z } from "zod";

const openDisputeSchema = z.object({
  orderId: z.string().min(1),
  reason: z.enum([
    "ITEM_NOT_RECEIVED",
    "ITEM_NOT_AS_DESCRIBED",
    "ITEM_DAMAGED",
    "WRONG_ITEM_SENT",
    "COUNTERFEIT_ITEM",
    "SELLER_UNRESPONSIVE",
    "SELLER_CANCELLED",
    "REFUND_NOT_PROCESSED",
    "OTHER",
  ]),
  description: z
    .string()
    .min(20, "Please describe the issue in at least 20 characters.")
    .max(2000)
    .trim(),
  evidenceUrls: z.array(z.string().min(1)).max(3).optional(),
});

export type OpenDisputeInput = z.infer<typeof openDisputeSchema>;

export async function openDispute(raw: unknown): Promise<ActionResult<void>> {
  try {
    const reqHeaders = await headers();
    // Use getClientIp() — x-forwarded-for is client-controllable and spoofable.
    const ip = getClientIp(reqHeaders as unknown as Headers);
    const user = await requireUser();

    // Rate limit — 3 disputes per day per user
    const limit = await rateLimit("disputes", user.id);
    if (!limit.success) {
      return {
        success: false,
        error:
          "You have opened too many disputes today. Please contact support if you need further assistance.",
      };
    }

    // Abuse detection — log warning if user has 5+ disputes in 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentDisputeCount = await db.order.count({
      where: {
        buyerId: user.id,
        disputeOpenedAt: { not: null, gte: thirtyDaysAgo },
      },
    });
    if (recentDisputeCount >= 5) {
      logger.warn("dispute.abuse_detected", {
        userId: user.id,
        recentDisputeCount,
        ip,
      });
    }

    const parsed = openDisputeSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: "Invalid dispute details.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }

    await orderService.openDispute(parsed.data, user.id, ip);

    // Run auto-resolution engine immediately (fire-and-forget)
    autoResolutionService
      .evaluateDispute(parsed.data.orderId)
      .then(async (evaluation) => {
        if (
          evaluation.decision === "AUTO_REFUND" ||
          evaluation.decision === "AUTO_DISMISS"
        ) {
          await autoResolutionService.executeDecision(
            parsed.data.orderId,
            evaluation,
          );
          logger.info("dispute.auto_resolved_on_open", {
            orderId: parsed.data.orderId,
            decision: evaluation.decision,
            score: evaluation.score,
          });
        } else {
          // Record the evaluation for admin visibility even if not auto-resolving
          orderEventService.recordEvent({
            orderId: parsed.data.orderId,
            type: ORDER_EVENT_TYPES.DISPUTE_RESPONDED,
            actorId: null,
            actorRole: ACTOR_ROLES.SYSTEM,
            summary: `Auto-resolution evaluated: ${evaluation.decision}. Score: ${evaluation.score}`,
            metadata: {
              decision: evaluation.decision,
              score: evaluation.score,
              factors: evaluation.factors,
              recommendation: evaluation.recommendation,
            },
          });
          if (evaluation.decision === "FLAG_FRAUD") {
            await autoResolutionService.executeDecision(
              parsed.data.orderId,
              evaluation,
            );
          }
        }
      })
      .catch((err) => {
        logger.error("dispute.auto_resolution.failed", {
          orderId: parsed.data.orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't open your dispute. Please try again or contact support@kiwimart.co.nz.",
      ),
    };
  }
}

// ── Dispute evidence photo upload ──────────────────────────────────────────
// SECURITY: Evidence is stored as R2 keys (NOT public URLs). Signed URLs are
// generated on-demand via getDisputeEvidenceUrls() for display in the UI.
// This prevents dispute evidence from being publicly accessible.

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES = 3;

export async function uploadDisputeEvidence(
  formData: FormData,
): Promise<ActionResult<{ urls: string[] }>> {
  try {
    const user = await requireUser();

    // Rate limit — 10 upload calls per hour per user
    const uploadLimit = await rateLimit("disputes", user.id);
    if (!uploadLimit.success) {
      return {
        success: false,
        error: "Too many uploads. Please try again later.",
      };
    }

    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return { success: false, error: "No files provided." };
    }
    if (files.length > MAX_FILES) {
      return { success: false, error: `Maximum ${MAX_FILES} photos allowed.` };
    }

    const uploadedKeys: string[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());

      // Server-side security validation — magic bytes + extension + size + MIME type
      const validation = validateImageFile({
        buffer,
        mimetype: file.type,
        size: file.size,
        originalname: file.name,
      });
      if (!validation.valid) {
        return { success: false, error: validation.error ?? "Invalid file." };
      }

      if (file.size > MAX_SIZE) {
        return { success: false, error: "Each photo must be under 5MB." };
      }

      const ext =
        file.type === "image/jpeg"
          ? "jpg"
          : file.type === "image/png"
            ? "png"
            : "webp";
      const key = `disputes/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: file.type,
        }),
      );

      // Store the R2 key (NOT a public URL) — signed URLs generated at serve time
      uploadedKeys.push(key);
    }

    logger.info("dispute.evidence.uploaded", {
      userId: user.id,
      count: uploadedKeys.length,
    });

    // Return keys in the `urls` field for backward-compat with the client
    return { success: true, data: { urls: uploadedKeys } };
  } catch (err) {
    logger.error("dispute.evidence.upload.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: "Failed to upload photos. Please try again.",
    };
  }
}

// ── Seller dispute response ──────────────────────────────────────────���───
// Allows the seller to submit a written response to a buyer-opened dispute.
// Sets sellerResponse + sellerRespondedAt and notifies the buyer.

const respondToDisputeSchema = z.object({
  orderId: z.string().min(1),
  response: z
    .string()
    .min(20, "Please describe your response in at least 20 characters.")
    .max(2000)
    .trim(),
});

export async function respondToDispute(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    const parsed = respondToDisputeSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: "Invalid response.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }

    const order = await db.order.findUnique({
      where: { id: parsed.data.orderId },
      select: {
        id: true,
        sellerId: true,
        buyerId: true,
        status: true,
        sellerResponse: true,
        listing: { select: { title: true } },
        seller: { select: { displayName: true } },
      },
    });

    if (!order) {
      return { success: false, error: "Order not found." };
    }
    if (order.sellerId !== user.id) {
      return {
        success: false,
        error: "Only the seller can respond to a dispute.",
      };
    }
    if (order.status !== "DISPUTED") {
      return {
        success: false,
        error: "This order is not in a disputed state.",
      };
    }
    if (order.sellerResponse) {
      return {
        success: false,
        error: "You have already responded to this dispute.",
      };
    }

    await db.order.update({
      where: { id: parsed.data.orderId },
      data: {
        sellerResponse: parsed.data.response,
        sellerRespondedAt: new Date(),
      },
    });

    // Notify buyer that the seller has responded
    createNotification({
      userId: order.buyerId,
      type: "ORDER_DISPUTED",
      title: "Seller responded to your dispute",
      body: `${order.seller.displayName} has responded to your dispute on "${order.listing.title}".`,
      orderId: order.id,
      link: `/orders/${order.id}`,
    }).catch(() => {});

    // Audit trail (fire-and-forget)
    audit({
      userId: user.id,
      action: "DISPUTE_SELLER_RESPONDED",
      entityType: "Order",
      entityId: order.id,
      metadata: { response: parsed.data.response.slice(0, 100) },
    });

    orderEventService.recordEvent({
      orderId: order.id,
      type: ORDER_EVENT_TYPES.DISPUTE_RESPONDED,
      actorId: user.id,
      actorRole: ACTOR_ROLES.SELLER,
      summary: `Seller responded to dispute`,
      metadata: { response: parsed.data.response.slice(0, 200) },
    });

    logger.info("dispute.seller_responded", {
      orderId: order.id,
      sellerId: user.id,
    });

    // Re-run auto-resolution with updated evidence (fire-and-forget)
    autoResolutionService
      .evaluateDispute(parsed.data.orderId)
      .then(async (evaluation) => {
        if (
          evaluation.decision === "AUTO_REFUND" ||
          evaluation.decision === "AUTO_DISMISS"
        ) {
          await autoResolutionService.executeDecision(
            parsed.data.orderId,
            evaluation,
          );
          logger.info("dispute.auto_resolved_after_response", {
            orderId: parsed.data.orderId,
            decision: evaluation.decision,
            score: evaluation.score,
          });
        }
      })
      .catch((err) => {
        logger.error("dispute.auto_resolution_after_response.failed", {
          orderId: parsed.data.orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "Your dispute response couldn't be submitted. Please try again.",
      ),
    };
  }
}

// ── Generate signed URLs for dispute evidence display ─────────────────────
// Called by server components / admin pages to display evidence securely.
// Each signed URL is valid for 1 hour.

export async function getDisputeEvidenceUrls(
  r2Keys: string[],
): Promise<string[]> {
  return Promise.all(
    r2Keys.map(async (key) => {
      // If the stored value is already a full URL (legacy data), pass through
      if (key.startsWith("http")) return key;

      const command = new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      });
      return getSignedUrl(r2, command, { expiresIn: 3600 });
    }),
  );
}
