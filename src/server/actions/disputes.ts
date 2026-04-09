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
import { orderRepository } from "@/modules/orders/order.repository";
import { disputeRepository } from "@/modules/disputes/dispute.repository";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { autoResolutionService } from "@/modules/disputes/auto-resolution.service";
import {
  getDisputeByOrderId,
  addSellerResponse,
} from "@/server/services/dispute/dispute.service";
import type { ActionResult } from "@/types";
import { openDisputeSchema, respondToDisputeSchema } from "@/server/validators";

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
    const recentDisputeCount = await disputeRepository.countRecentByBuyer(
      user.id,
      thirtyDaysAgo,
    );
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

    // Queue auto-resolution with 24h cooling period (fire-and-forget)
    autoResolutionService
      .queueAutoResolution(parsed.data.orderId)
      .then((evaluation) => {
        logger.info("dispute.auto_resolution.queued", {
          orderId: parsed.data.orderId,
          decision: evaluation.decision,
          score: evaluation.score,
          canAutoResolve: evaluation.canAutoResolve,
        });
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
        `We couldn't open your dispute. Please try again or contact ${process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@buyzi.co.nz"}.`,
      ),
    };
  }
}

// ── Dispute evidence photo upload ──────────────────────────────────────────
// SECURITY: Evidence is stored as R2 keys (NOT public URLs). Signed URLs are
// generated on-demand via getDisputeEvidenceUrls() for display in the UI.
// This prevents dispute evidence from being publicly accessible.

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES = parseInt(process.env.DISPUTE_EVIDENCE_MAX_FILES ?? "4", 10);

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

    // Read all file buffers in parallel
    const buffers = await Promise.all(
      files.map((f) => f.arrayBuffer().then((ab) => Buffer.from(ab))),
    );

    // Validate all files before uploading
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const buffer = buffers[i]!;
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
    }

    // Build upload descriptors
    const uploads = files.map((file, i) => {
      const buffer = buffers[i]!;
      const ext =
        file.type === "image/jpeg"
          ? "jpg"
          : file.type === "image/png"
            ? "png"
            : "webp";
      const key = `disputes/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      return { key, buffer, contentType: file.type };
    });

    // Upload all files in parallel
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

    // Store the R2 keys (NOT public URLs) — signed URLs generated at serve time
    const uploadedKeys = uploads.map((u) => u.key);

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

    const order = await orderRepository.findWithDisputeContext(
      parsed.data.orderId,
    );

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

    // Check for existing response via Dispute model
    const dispute = await getDisputeByOrderId(parsed.data.orderId);
    if (!dispute) {
      return { success: false, error: "No dispute found for this order." };
    }
    if (dispute.sellerStatement) {
      return {
        success: false,
        error: "You have already responded to this dispute.",
      };
    }

    // Use the dispute service to record the seller response
    await addSellerResponse({
      disputeId: dispute.id,
      sellerId: user.id,
      statement: parsed.data.response,
      evidenceKeys: [],
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

    // Re-evaluate with updated evidence (fire-and-forget)
    autoResolutionService
      .queueAutoResolution(parsed.data.orderId)
      .then((evaluation) => {
        logger.info("dispute.auto_resolution_after_response", {
          orderId: parsed.data.orderId,
          decision: evaluation.decision,
          score: evaluation.score,
        });
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

// ── Generate signed evidence URLs from DisputeEvidence records ──────────────

export interface SignedEvidenceItem {
  id: string;
  url: string;
  uploadedBy: string;
  label: string | null;
  createdAt: string;
}

export async function getSignedEvidenceFromRecords(
  evidence: Array<{
    id: string;
    r2Key: string;
    uploadedBy: string;
    label: string | null;
    createdAt: Date;
  }>,
): Promise<SignedEvidenceItem[]> {
  return Promise.all(
    evidence.map(async (e) => {
      let url: string;
      if (e.r2Key.startsWith("http")) {
        url = e.r2Key;
      } else {
        const command = new GetObjectCommand({
          Bucket: R2_BUCKET,
          Key: e.r2Key,
        });
        url = await getSignedUrl(r2, command, { expiresIn: 3600 });
      }
      return {
        id: e.id,
        url,
        uploadedBy: e.uploadedBy,
        label: e.label,
        createdAt: e.createdAt.toISOString(),
      };
    }),
  );
}
