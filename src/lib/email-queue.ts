// src/lib/email-queue.ts
// ─── Email Queue Helper ───────────────────────────────────────────────────────
// Enqueues transactional email jobs onto the BullMQ email queue so that email
// delivery is handled asynchronously with automatic retries.
//
// Key guarantees:
//   • The caller's request completes immediately — no Resend latency in-band
//   • Failed email jobs retry automatically (3×, exponential backoff)
//   • If Redis is unavailable, falls back to a synchronous direct Resend call
//   • correlationId from the current request context is included in every job
//
// Usage:
//   await enqueueEmail({ template: 'passwordReset', to, displayName, resetUrl, expiresInMinutes: 60 })

import { emailQueue } from "@/lib/queue";
import type { EmailJobData } from "@/lib/queue";
import { getRequestContext } from "@/lib/request-context";
import { logger } from "@/shared/logger";
import { redactEmail } from "@/server/email/transport";

// ── Fallback: direct synchronous send ────────────────────────────────────────
// Used only when Redis is unavailable. Imports email functions lazily to avoid
// circular dependencies and to keep this module lightweight in the hot path.

async function sendEmailDirectly(data: EmailJobData): Promise<void> {
  const {
    sendVerificationEmail,
    sendWelcomeEmail,
    sendPasswordResetEmail,
    sendDataExportEmail,
    sendErasureConfirmationEmail,
    sendAdminIdVerificationEmail,
    sendOfferReceivedEmail,
    sendOfferResponseEmail,
    sendOrderDispatchedEmail,
    sendOrderCompleteBuyerEmail,
    sendOrderCompleteSellerEmail,
    sendDisputeOpenedEmail,
  } = await import("@/server/email");

  switch (data.template) {
    case "verification":
      await sendVerificationEmail({
        to: data.to,
        displayName: data.displayName,
        verifyUrl: data.verifyUrl,
      });
      break;

    case "welcome":
      await sendWelcomeEmail({ to: data.to, displayName: data.displayName });
      break;

    case "passwordReset":
      await sendPasswordResetEmail({
        to: data.to,
        displayName: data.displayName,
        resetUrl: data.resetUrl,
        expiresInMinutes: data.expiresInMinutes,
      });
      break;

    case "dataExport":
      await sendDataExportEmail({
        to: data.to,
        displayName: data.displayName,
        downloadUrl: data.downloadUrl,
        expiresAt: data.expiresAt,
      });
      break;

    case "erasureConfirmation":
      await sendErasureConfirmationEmail({
        to: data.to,
        displayName: data.displayName,
      });
      break;

    case "adminIdVerification":
      await sendAdminIdVerificationEmail({
        to: data.to,
        userId: data.userId,
        userEmail: data.userEmail,
        submittedAt: data.submittedAt,
        adminUrl: data.adminUrl,
      });
      break;

    case "offerReceived":
      await sendOfferReceivedEmail({
        to: data.to,
        sellerName: data.sellerName,
        buyerName: data.buyerName,
        listingTitle: data.listingTitle,
        offerAmount: data.offerAmount,
        listingUrl: data.listingUrl,
      });
      break;

    case "offerResponse":
      await sendOfferResponseEmail({
        to: data.to,
        buyerName: data.buyerName,
        listingTitle: data.listingTitle,
        accepted: data.accepted,
        listingUrl: data.listingUrl,
      });
      break;

    case "orderDispatched":
      await sendOrderDispatchedEmail({
        to: data.to,
        buyerName: data.buyerName,
        listingTitle: data.listingTitle,
        trackingNumber: data.trackingNumber,
        trackingUrl: data.trackingUrl,
        orderUrl: data.orderUrl,
      });
      break;

    case "orderCompleteBuyer":
      await sendOrderCompleteBuyerEmail({
        to: data.to,
        buyerName: data.buyerName,
        sellerName: data.sellerName,
        listingTitle: data.listingTitle,
        orderId: data.orderId,
        totalNzd: data.totalNzd,
        orderUrl: data.orderUrl,
      });
      break;

    case "orderCompleteSeller":
      await sendOrderCompleteSellerEmail({
        to: data.to,
        sellerName: data.sellerName,
        buyerFirstName: data.buyerFirstName,
        listingTitle: data.listingTitle,
        orderId: data.orderId,
        totalNzd: data.totalNzd,
        payoutTimelineDays: data.payoutTimelineDays,
        dashboardUrl: data.dashboardUrl,
      });
      break;

    case "disputeOpened":
      await sendDisputeOpenedEmail({
        to: data.to,
        sellerName: data.sellerName,
        buyerName: data.buyerName,
        listingTitle: data.listingTitle,
        orderId: data.orderId,
        reason: data.reason,
        description: data.description,
      });
      break;

    default: {
      // Exhaustiveness check — TypeScript will error if a new template is added
      // to EmailJobData without a corresponding case here.
      const _exhaustive: never = data;
      logger.warn("email.fallback.unknown_template", {
        template: (_exhaustive as EmailJobData).template,
      });
    }
  }
}

// ── enqueueEmail ─────────────────────────────────────────────────────────────

/**
 * Enqueues a transactional email job for asynchronous delivery.
 *
 * - On success: job is added to the BullMQ email queue; returns immediately.
 * - On Redis failure: logs the error, falls back to a direct synchronous send.
 *
 * Rules:
 *   • Call AFTER the core operation succeeds — never before
 *   • Never include passwords, tokens, or secret keys in job data
 *   • correlationId is automatically injected from the request context
 */
export async function enqueueEmail(
  data: EmailJobData,
  options?: { delay?: number; priority?: number },
): Promise<void> {
  const correlationId = getRequestContext()?.correlationId;
  const jobData: EmailJobData = {
    ...data,
    correlationId,
    enqueuedAt: new Date().toISOString(),
  };

  try {
    await emailQueue.add("send-email", jobData, {
      delay: options?.delay,
      priority: options?.priority,
    });
    logger.info("email.queued", {
      template: data.template,
      to: redactEmail((data as { to?: string }).to ?? ""),
      correlationId,
    });
  } catch (queueErr) {
    // Redis is unavailable — log and fall back to synchronous send so the
    // email still reaches the recipient. This is the last-resort path.
    logger.error("email.queue_unavailable", {
      template: data.template,
      to: redactEmail((data as { to?: string }).to ?? ""),
      correlationId,
      error: queueErr instanceof Error ? queueErr.message : String(queueErr),
    });

    try {
      logger.warn("email.fallback_to_sync", {
        template: data.template,
        to: redactEmail((data as { to?: string }).to ?? ""),
        correlationId,
      });
      await sendEmailDirectly(data);
    } catch (sendErr) {
      // Direct send also failed — log at error level so ops are alerted.
      // Do NOT rethrow: the caller's core operation already succeeded.
      logger.error("email.fallback_failed", {
        template: data.template,
        to: redactEmail((data as { to?: string }).to ?? ""),
        correlationId,
        error: sendErr instanceof Error ? sendErr.message : String(sendErr),
      });
    }
  }
}
