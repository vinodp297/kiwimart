// src/test/webhook.service.test.ts
// ─── Tests for WebhookService ────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import './setup'
import { webhookService } from '@/modules/payments/webhook.service'
import db from '@/lib/db'

describe('WebhookService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('markEventProcessed', () => {
    it('returns true for new event', async () => {
      vi.mocked(db.stripeEvent.create).mockResolvedValue({ id: 'evt_1', type: 'test' } as never)

      const result = await webhookService.markEventProcessed('evt_1', 'test')
      expect(result).toBe(true)
    })

    it('returns false for duplicate event (P2002)', async () => {
      const p2002 = new Error('Unique constraint') as Error & { code: string }
      p2002.code = 'P2002'
      vi.mocked(db.stripeEvent.create).mockRejectedValue(p2002)

      const result = await webhookService.markEventProcessed('evt_dup', 'test')
      expect(result).toBe(false)
    })

    it('re-throws non-duplicate errors', async () => {
      vi.mocked(db.stripeEvent.create).mockRejectedValue(new Error('DB down'))

      await expect(
        webhookService.markEventProcessed('evt_err', 'test')
      ).rejects.toThrow('DB down')
    })
  })

  describe('processEvent', () => {
    it('processes payment_intent.succeeded', async () => {
      vi.mocked(db.stripeEvent.create).mockResolvedValue({} as never)
      // State validation: order must be AWAITING_PAYMENT
      vi.mocked(db.order.findUnique).mockResolvedValue({ status: 'AWAITING_PAYMENT' } as never)
      vi.mocked(db.$transaction).mockResolvedValue([] as never)

      await webhookService.processEvent({
        id: 'evt_pi_success',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test',
            metadata: { orderId: 'order-1', sellerId: 'seller-1' },
            amount: 5000,
            application_fee_amount: 0,
          },
        },
      } as never)

      expect(db.order.findUnique).toHaveBeenCalled()
      expect(db.$transaction).toHaveBeenCalled()
    })

    it('skips duplicate events', async () => {
      const p2002 = new Error('Unique constraint') as Error & { code: string }
      p2002.code = 'P2002'
      vi.mocked(db.stripeEvent.create).mockRejectedValue(p2002)

      await webhookService.processEvent({
        id: 'evt_dup',
        type: 'payment_intent.succeeded',
        data: { object: {} },
      } as never)

      expect(db.$transaction).not.toHaveBeenCalled()
    })

    it('processes account.updated', async () => {
      vi.mocked(db.stripeEvent.create).mockResolvedValue({} as never)
      vi.mocked(db.user.updateMany).mockResolvedValue({ count: 1 } as never)

      await webhookService.processEvent({
        id: 'evt_acct',
        type: 'account.updated',
        data: {
          object: {
            id: 'acct_test',
            details_submitted: true,
            charges_enabled: true,
            payouts_enabled: true,
          },
        },
      } as never)

      expect(db.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stripeAccountId: 'acct_test' },
          data: expect.objectContaining({ stripeOnboarded: true }),
        })
      )
    })

    it('processes payment_intent.payment_failed', async () => {
      vi.mocked(db.stripeEvent.create).mockResolvedValue({} as never)
      vi.mocked(db.order.update).mockResolvedValue({} as never)

      await webhookService.processEvent({
        id: 'evt_pi_fail',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_failed',
            metadata: { orderId: 'order-fail', sellerId: 'seller-1' },
            amount: 5000,
            last_payment_error: { code: 'card_declined' },
          },
        },
      } as never)

      expect(db.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-fail', stripePaymentIntentId: 'pi_failed' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        })
      )
    })

    it('skips payment_intent.payment_failed when no orderId', async () => {
      vi.mocked(db.stripeEvent.create).mockResolvedValue({} as never)

      await webhookService.processEvent({
        id: 'evt_pi_fail_no_order',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_no_order',
            metadata: {},
            amount: 0,
          },
        },
      } as never)

      expect(db.order.update).not.toHaveBeenCalled()
    })

    it('processes transfer.created', async () => {
      vi.mocked(db.stripeEvent.create).mockResolvedValue({} as never)
      vi.mocked(db.payout.updateMany).mockResolvedValue({ count: 1 } as never)

      await webhookService.processEvent({
        id: 'evt_transfer',
        type: 'transfer.created',
        data: {
          object: {
            id: 'tr_test123',
          },
        },
      } as never)

      expect(db.payout.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stripeTransferId: 'tr_test123' },
          data: { status: 'PROCESSING' },
        })
      )
    })

    it('ignores unhandled event types', async () => {
      vi.mocked(db.stripeEvent.create).mockResolvedValue({} as never)

      await webhookService.processEvent({
        id: 'evt_unknown',
        type: 'charge.captured',
        data: { object: {} },
      } as never)

      expect(db.$transaction).not.toHaveBeenCalled()
      expect(db.order.update).not.toHaveBeenCalled()
    })

    it('skips payment_intent.succeeded when no orderId in metadata', async () => {
      vi.mocked(db.stripeEvent.create).mockResolvedValue({} as never)

      await webhookService.processEvent({
        id: 'evt_pi_no_order',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_orphan',
            metadata: {},
            amount: 5000,
            application_fee_amount: 0,
          },
        },
      } as never)

      expect(db.$transaction).not.toHaveBeenCalled()
    })

    it('sets onboarded=false when not fully onboarded', async () => {
      vi.mocked(db.stripeEvent.create).mockResolvedValue({} as never)
      vi.mocked(db.user.updateMany).mockResolvedValue({ count: 1 } as never)

      await webhookService.processEvent({
        id: 'evt_acct_partial',
        type: 'account.updated',
        data: {
          object: {
            id: 'acct_partial',
            details_submitted: true,
            charges_enabled: false,
            payouts_enabled: true,
          },
        },
      } as never)

      expect(db.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stripeOnboarded: false }),
        })
      )
    })
  })
})
