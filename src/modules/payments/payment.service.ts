// src/modules/payments/payment.service.ts
// ─── Payment Service ─────────────────────────────────────────────────────────
// All Stripe payment operations. Framework-free — no Next.js imports.
// Rule: Stripe FIRST, then DB.

import { stripe } from "@/infrastructure/stripe/client";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import { getRequestContext } from "@/lib/request-context";
import type {
  CreatePaymentIntentInput,
  CapturePaymentInput,
  RefundPaymentInput,
  PaymentResult,
} from "./payment.types";

export class PaymentService {
  async createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<PaymentResult> {
    logger.info("payment.intent.creating", {
      orderId: input.orderId,
      amountNzd: input.amountNzd,
    });

    if (
      !input.sellerStripeAccountId ||
      !input.sellerStripeAccountId.startsWith("acct_")
    ) {
      throw AppError.paymentGatewayError(
        "Seller payment account is not configured",
      );
    }

    try {
      const intentData = {
        amount: input.amountNzd,
        currency: "nzd",
        capture_method: "manual" as const,
        transfer_data: {
          destination: input.sellerStripeAccountId,
        },
        payment_method_types: ["card"],
        metadata: {
          orderId: input.orderId,
          listingId: input.listingId,
          buyerId: input.buyerId,
          sellerId: input.sellerId,
          // Thread correlationId into Stripe so dashboard events can be
          // linked back to structured application logs by the same ID.
          correlationId: getRequestContext()?.correlationId ?? "unknown",
          ...input.metadata,
        },
        description: `KiwiMart: ${input.listingTitle}`,
        statement_descriptor_suffix: "KIWIMART",
      };

      // Pass idempotency key to Stripe to prevent duplicate PaymentIntents
      // on double-click or retried requests within the same checkout session.
      const intent = input.idempotencyKey
        ? await stripe.paymentIntents.create(intentData, {
            idempotencyKey: `pi-${input.idempotencyKey}`,
          })
        : await stripe.paymentIntents.create(intentData);

      logger.info("payment.intent.created", {
        orderId: input.orderId,
        paymentIntentId: intent.id,
      });

      return {
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret!,
        amount: intent.amount,
      };
    } catch (err) {
      logger.error("payment.intent.create_failed", {
        orderId: input.orderId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw AppError.paymentGatewayError(
        "Payment setup failed. Please try again.",
      );
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<void> {
    logger.info("payment.capture.attempting", {
      orderId: input.orderId,
      paymentIntentId: input.paymentIntentId,
    });

    try {
      await stripe.paymentIntents.capture(input.paymentIntentId);
      logger.info("payment.captured", {
        orderId: input.orderId,
        paymentIntentId: input.paymentIntentId,
      });
    } catch (err: unknown) {
      // Robust Stripe error detection via .code and .type properties
      // (not fragile string matching on error messages)
      const stripeErr = err as {
        code?: string;
        type?: string;
        message?: string;
      };
      const code = stripeErr?.code ?? "";
      const type = stripeErr?.type ?? "";

      // charge_already_captured is unambiguous — the charge was captured.
      if (
        code === "charge_already_captured" ||
        (type === "invalid_request_error" && code.includes("already"))
      ) {
        logger.info("payment.capture.already_done", {
          orderId: input.orderId,
          stripeCode: code,
        });
        return;
      }

      // payment_intent_unexpected_state is ambiguous — could mean "already
      // captured" OR "authorization expired". Retrieve the PI to find out.
      if (code === "payment_intent_unexpected_state") {
        try {
          const pi = await stripe.paymentIntents.retrieve(
            input.paymentIntentId,
          );
          logger.info("payment.capture.unexpected_state.resolved", {
            orderId: input.orderId,
            paymentIntentId: input.paymentIntentId,
            piStatus: pi.status,
          });

          if (pi.status === "succeeded") {
            // Genuinely already captured — safe to treat as success
            return;
          }

          // Authorization expired or PI is in a non-capturable state
          // (canceled, requires_payment_method, etc.) — this is NOT a success
          throw AppError.paymentGatewayError(
            "Payment authorization has expired. A new payment is needed to complete this order.",
          );
        } catch (retrieveErr) {
          // If the retrieve itself fails, re-throw if it's already an AppError
          if (retrieveErr instanceof AppError) throw retrieveErr;
          logger.error("payment.capture.retrieve_failed", {
            orderId: input.orderId,
            paymentIntentId: input.paymentIntentId,
            error:
              retrieveErr instanceof Error
                ? retrieveErr.message
                : String(retrieveErr),
          });
          throw AppError.paymentGatewayError(
            "Payment capture failed. Please try again.",
          );
        }
      }

      const msg = err instanceof Error ? err.message : String(err);
      logger.error("payment.capture.failed", {
        orderId: input.orderId,
        paymentIntentId: input.paymentIntentId,
        error: msg,
      });
      throw AppError.paymentGatewayError(
        "Payment capture failed. Please try again.",
      );
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<void> {
    logger.info("payment.refund.attempting", {
      orderId: input.orderId,
      paymentIntentId: input.paymentIntentId,
    });

    try {
      // Idempotency key includes amount and reason so that a partial refund
      // followed by a full refund (or two partial refunds for different amounts)
      // are treated as distinct Stripe requests rather than silent no-ops.
      const amountStr = input.amountNzd?.toString() ?? "full";
      const reasonStr = input.reason ?? "no-reason";
      const idempotencyKey = `refund-${input.orderId}-${amountStr}-${reasonStr}`;

      await stripe.refunds.create(
        { payment_intent: input.paymentIntentId },
        { idempotencyKey },
      );
      logger.info("payment.refunded", {
        orderId: input.orderId,
        paymentIntentId: input.paymentIntentId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("payment.refund.failed", {
        orderId: input.orderId,
        error: msg,
      });
      throw AppError.paymentGatewayError(
        "Refund failed. Please try again or contact support.",
      );
    }
  }

  /**
   * Retrieve the client_secret for an existing PaymentIntent.
   * Used in the idempotency path: if an order already exists for this
   * checkout session, return its PI client_secret instead of creating a new one.
   */
  async getClientSecret(paymentIntentId: string): Promise<string | null> {
    try {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      return intent.client_secret ?? null;
    } catch (err) {
      logger.warn("payment.intent.retrieve_failed", {
        paymentIntentId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

export const paymentService = new PaymentService();
