// src/modules/payments/payment.service.ts
// ─── Payment Service ─────────────────────────────────────────────────────────
// All Stripe payment operations. Framework-free — no Next.js imports.
// Rule: Stripe FIRST, then DB.

import { stripe } from '@/infrastructure/stripe/client'
import { logger } from '@/shared/logger'
import { AppError } from '@/shared/errors'
import type {
  CreatePaymentIntentInput,
  CapturePaymentInput,
  RefundPaymentInput,
  PaymentResult,
} from './payment.types'

export class PaymentService {
  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentResult> {
    logger.info('payment.intent.creating', {
      orderId: input.orderId,
      amountNzd: input.amountNzd,
    })

    if (
      !input.sellerStripeAccountId ||
      !input.sellerStripeAccountId.startsWith('acct_')
    ) {
      throw AppError.stripeError('Seller payment account is not configured')
    }

    try {
      const intent = await stripe.paymentIntents.create({
        amount: input.amountNzd,
        currency: 'nzd',
        capture_method: 'manual',
        transfer_data: {
          destination: input.sellerStripeAccountId,
        },
        payment_method_types: ['card', 'afterpay_clearpay'],
        metadata: {
          orderId: input.orderId,
          listingId: input.listingId,
          buyerId: input.buyerId,
          sellerId: input.sellerId,
          ...input.metadata,
        },
        description: `KiwiMart: ${input.listingTitle}`,
        statement_descriptor_suffix: 'KIWIMART',
      })

      logger.info('payment.intent.created', {
        orderId: input.orderId,
        paymentIntentId: intent.id,
      })

      return {
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret!,
        amount: intent.amount,
      }
    } catch (err) {
      logger.error('payment.intent.create_failed', {
        orderId: input.orderId,
        error: err instanceof Error ? err.message : String(err),
      })
      throw AppError.stripeError('Payment setup failed. Please try again.')
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<void> {
    logger.info('payment.capture.attempting', {
      orderId: input.orderId,
      paymentIntentId: input.paymentIntentId,
    })

    try {
      await stripe.paymentIntents.capture(input.paymentIntentId)
      logger.info('payment.captured', {
        orderId: input.orderId,
        paymentIntentId: input.paymentIntentId,
      })
    } catch (err: unknown) {
      // Robust Stripe error detection via .code and .type properties
      // (not fragile string matching on error messages)
      const stripeErr = err as { code?: string; type?: string; message?: string }
      const code = stripeErr?.code ?? ''
      const type = stripeErr?.type ?? ''

      if (
        code === 'charge_already_captured' ||
        code === 'payment_intent_unexpected_state' ||
        (type === 'invalid_request_error' && code.includes('already'))
      ) {
        logger.info('payment.capture.already_done', {
          orderId: input.orderId,
          stripeCode: code,
        })
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('payment.capture.failed', {
        orderId: input.orderId,
        paymentIntentId: input.paymentIntentId,
        error: msg,
      })
      throw AppError.stripeError('Payment capture failed. Please try again.')
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<void> {
    logger.info('payment.refund.attempting', {
      orderId: input.orderId,
      paymentIntentId: input.paymentIntentId,
    })

    try {
      await stripe.refunds.create({
        payment_intent: input.paymentIntentId,
      })
      logger.info('payment.refunded', {
        orderId: input.orderId,
        paymentIntentId: input.paymentIntentId,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('payment.refund.failed', {
        orderId: input.orderId,
        error: msg,
      })
      throw AppError.stripeError('Refund failed. Please try again or contact support.')
    }
  }
}

export const paymentService = new PaymentService()
