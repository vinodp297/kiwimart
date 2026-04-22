// src/modules/payments/payout.repository.ts
// ─── Payout Repository — data access for the Payout table ────────────────────
// Owns all reads and writes against the Payout table for the payout worker,
// auto-release escrow job, delivery-reminder auto-complete, and Stripe
// reconciliation. Centralising the queries here keeps the worker/job files
// architecturally compliant (services → repositories → db).

import { type DbClient, getClient } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export const payoutRepository = {
  /**
   * Look up a payout by orderId — used by the payout worker for the
   * idempotency check before issuing a Stripe transfer.
   *
   * Returns `effectiveFeeRateBps` so the worker can decide whether to
   * snapshot a fresh rate (value === 0) or reproduce fees from the
   * previously-stored snapshot (value > 0).
   */
  async findByOrderId(
    orderId: string,
    tx?: DbClient,
  ): Promise<{
    id: string;
    status: string;
    amountNzd: number;
    effectiveFeeRateBps: number;
  } | null> {
    const client = getClient(tx);
    return client.payout.findUnique({
      where: { orderId },
      select: {
        id: true,
        status: true,
        amountNzd: true,
        effectiveFeeRateBps: true,
      },
    });
  },

  /**
   * Persist the platform fee rate that was in effect when the worker first
   * calculated fees for this payout. Called from the payout worker on first
   * pickup, before the Stripe transfer is initiated. Subsequent retries of
   * the same payout read this value back via findByOrderId and reproduce
   * the identical fee breakdown — the seller is therefore reimbursed at
   * the rate agreed when the order was processed, not the current config.
   */
  async snapshotFeeRate(
    orderId: string,
    effectiveFeeRateBps: number,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.payout.update({
      where: { orderId },
      data: { effectiveFeeRateBps },
    });
  },

  /**
   * Mark a payout as MANUAL_REVIEW (e.g. when the seller's net would be
   * sub-minimum after fees).
   */
  async markManualReview(
    orderId: string,
    tx?: DbClient,
  ): Promise<Prisma.PayoutGetPayload<Record<string, never>>> {
    const client = getClient(tx);
    return client.payout.update({
      where: { orderId },
      data: { status: "MANUAL_REVIEW" },
    });
  },

  /**
   * Persist the result of a successful Stripe transfer — sets PROCESSING +
   * fee breakdown + initiatedAt.
   */
  async markProcessingWithTransfer(
    orderId: string,
    data: {
      stripeTransferId: string;
      platformFeeNzd: number;
      stripeFeeNzd: number;
    },
    tx?: DbClient,
  ): Promise<Prisma.PayoutGetPayload<Record<string, never>>> {
    const client = getClient(tx);
    return client.payout.update({
      where: { orderId },
      data: {
        status: "PROCESSING",
        stripeTransferId: data.stripeTransferId,
        platformFeeNzd: data.platformFeeNzd,
        stripeFeeNzd: data.stripeFeeNzd,
        initiatedAt: new Date(),
      },
    });
  },

  /**
   * Mark a PENDING payout (for the given order) as PAID + paidAt — used by
   * the cash-escrow release loop in autoReleaseEscrow. The status guard
   * ensures we never overwrite a payout that has already been moved to
   * PROCESSING/COMPLETED in a race.
   */
  async markPaidByOrderIdIfPending(
    orderId: string,
    paidAt: Date,
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.payout.updateMany({
      where: { orderId, status: "PENDING" },
      data: { status: "PAID", paidAt },
    });
  },

  /**
   * Bulk-mark all payouts for the given order as PROCESSING + initiatedAt.
   * Used when the order auto-completes (e.g. delivery reminder expiry,
   * autoReleaseEscrow). The order has at most one payout, so this updates
   * 0 or 1 rows depending on whether a payout was created at checkout.
   */
  async markProcessingByOrderId(
    orderId: string,
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.payout.updateMany({
      where: { orderId },
      data: { status: "PROCESSING", initiatedAt: new Date() },
    });
  },

  /**
   * Find PENDING payouts that have been waiting longer than the auto-release
   * threshold — used by autoReleaseEscrow. Returns the order id + amount so
   * the cron can transition the order and enqueue the payout job.
   */
  async findPendingPayoutsBefore(
    cutoff: Date,
    take: number,
    tx?: DbClient,
  ): Promise<
    Array<{
      id: string;
      orderId: string;
      amountNzd: number;
      userId: string;
    }>
  > {
    const client = getClient(tx);
    return client.payout.findMany({
      where: {
        status: "PENDING",
        createdAt: { lt: cutoff },
      },
      take,
      select: {
        id: true,
        orderId: true,
        amountNzd: true,
        userId: true,
      },
    });
  },

  /**
   * Find PROCESSING payouts older than the given cutoff that have a Stripe
   * transfer ID — used by the Stripe reconciliation cron to confirm whether
   * the transfer actually completed.
   */
  async findProcessingTransfersOlderThan(
    cutoff: Date,
    take: number,
    tx?: DbClient,
  ): Promise<
    Array<{
      id: string;
      orderId: string;
      stripeTransferId: string | null;
      userId: string;
    }>
  > {
    const client = getClient(tx);
    return client.payout.findMany({
      where: {
        status: "PROCESSING",
        initiatedAt: { lt: cutoff },
        stripeTransferId: { not: null },
      },
      take,
      select: {
        id: true,
        orderId: true,
        stripeTransferId: true,
        userId: true,
      },
    });
  },

  /**
   * Mark a payout as PAID — used by Stripe reconciliation when the
   * transfer is verified as paid.
   */
  async markPaid(
    payoutId: string,
    paidAt: Date,
    tx?: DbClient,
  ): Promise<Prisma.PayoutGetPayload<Record<string, never>>> {
    const client = getClient(tx);
    return client.payout.update({
      where: { id: payoutId },
      data: { status: "PAID", paidAt },
    });
  },

  /**
   * Find the most recent PROCESSING payout for a seller identified by their
   * Stripe Connect account ID — used by the payout.failed webhook handler.
   * Returns null if no PROCESSING payout exists for this account.
   */
  async findLatestProcessingByStripeAccount(
    stripeAccountId: string,
    tx?: DbClient,
  ): Promise<{
    id: string;
    orderId: string;
    userId: string;
    status: string;
  } | null> {
    const client = getClient(tx);
    return client.payout.findFirst({
      where: {
        status: "PROCESSING",
        user: { stripeAccountId },
      },
      orderBy: { initiatedAt: "desc" },
      select: { id: true, orderId: true, userId: true, status: true },
    });
  },

  /**
   * Look up a payout by its Stripe transfer ID — used by transfer.failed and
   * transfer.reversed webhook handlers.
   */
  async findByStripeTransferId(
    stripeTransferId: string,
    tx?: DbClient,
  ): Promise<{
    id: string;
    orderId: string;
    userId: string;
    status: string;
  } | null> {
    const client = getClient(tx);
    return client.payout.findUnique({
      where: { stripeTransferId },
      select: { id: true, orderId: true, userId: true, status: true },
    });
  },

  /**
   * Mark a payout as REVERSED — used by transfer.reversed webhook handler.
   * REVERSED means the transfer succeeded but was subsequently reversed by Stripe.
   */
  async markReversed(
    payoutId: string,
    tx?: DbClient,
  ): Promise<Prisma.PayoutGetPayload<Record<string, never>>> {
    const client = getClient(tx);
    return client.payout.update({
      where: { id: payoutId },
      data: {
        status: "REVERSED",
        failedAt: new Date(),
        failReason: "Transfer reversed by Stripe",
      },
    });
  },

  /**
   * Mark a payout as FAILED — used by Stripe reconciliation and worker error
   * handlers when the transfer is confirmed unrecoverable.
   */
  async markFailed(
    payoutId: string,
    failReason: string,
    tx?: DbClient,
  ): Promise<Prisma.PayoutGetPayload<Record<string, never>>> {
    const client = getClient(tx);
    return client.payout.update({
      where: { id: payoutId },
      data: { status: "FAILED", failedAt: new Date(), failReason },
    });
  },

  /**
   * Generic create — used at checkout when an order with online payment is
   * placed. Caller supplies the full unchecked input. Defaults to PENDING.
   */
  async create(
    data: Prisma.PayoutUncheckedCreateInput,
    tx?: DbClient,
  ): Promise<Prisma.PayoutGetPayload<Record<string, never>>> {
    const client = getClient(tx);
    return client.payout.create({ data });
  },
} as const;

export type PayoutRepository = typeof payoutRepository;
