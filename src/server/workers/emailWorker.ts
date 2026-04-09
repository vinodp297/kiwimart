// src/server/workers/emailWorker.ts
//
// Processes email jobs from the BullMQ email queue.
// Runs as a persistent background service on Render.com — started via
// src/server/workers/index.ts. See docs/RUNBOOK.md → "Worker Deployment".
//
// Each job switches on `template` and calls the corresponding email function.
// Failures are logged at error level; BullMQ handles retries automatically
// (3 attempts, exponential backoff). Persistent failures go to the dead-letter
// set (removeOnFail: false).

import { Worker } from "bullmq";
import { getQueueConnection } from "@/lib/queue";
import type { EmailJobData } from "@/lib/queue";
import {
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
} from "@/server/email";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { runWithRequestContext } from "@/lib/request-context";

export function startEmailWorker() {
  if (process.env.VERCEL) {
    logger.error(
      "worker.email: workers must run on Render.com, not Vercel. See docs/RUNBOOK.md.",
    );
    return;
  }

  const worker = new Worker<EmailJobData>(
    "email",
    async (job) => {
      const data = job.data;
      const { template, correlationId: jobCorrelationId } = data;
      const correlationId = jobCorrelationId ?? `job:${job.id ?? "unknown"}`;
      return runWithRequestContext({ correlationId }, async () => {
        switch (template) {
          case "verification":
            await sendVerificationEmail({
              to: data.to,
              displayName: data.displayName,
              verifyUrl: data.verifyUrl,
            });
            break;

          case "welcome":
            await sendWelcomeEmail({
              to: data.to,
              displayName: data.displayName,
            });
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
            const _exhaustive: never = data;
            logger.warn("email.worker.unknown_template", {
              template: (_exhaustive as EmailJobData).template,
              jobId: job.id,
            });
          }
        }

        logger.info("email.sent", {
          template,
          to: data.to,
          correlationId,
          jobId: job.id,
        });

        audit({
          action: "ADMIN_ACTION",
          metadata: {
            worker: "email",
            template,
            jobId: job.id,
            correlationId,
            status: "sent",
          },
        });
      }); // end runWithRequestContext
    },
    {
      connection:
        getQueueConnection() as unknown as import("bullmq").ConnectionOptions,
      concurrency: 5,
      limiter: { max: 10, duration: 1000 }, // 10 emails/sec (Resend limit)
    },
  );

  worker.on("failed", (job, err) => {
    logger.error("email.worker.job_failed", {
      jobId: job?.id,
      template: job?.data?.template,
      error: err.message,
    });
    audit({
      action: "ADMIN_ACTION",
      metadata: {
        worker: "email",
        jobId: job?.id,
        template: job?.data?.template,
        error: err.message,
        status: "failed",
      },
    });
  });

  worker.on("completed", (job) => {
    logger.info("email.worker.job_completed", {
      jobId: job.id,
      template: job.data.template,
    });
  });

  return worker;
}
