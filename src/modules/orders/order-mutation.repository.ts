// src/modules/orders/order-mutation.repository.ts
// ─── Write / update / delete / transaction methods ────────────────────────────

import db, { getClient, type DbClient } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { fireAndForget } from "@/lib/fire-and-forget";

export const orderMutationRepository = {
  async markPayoutsProcessing(orderId: string, tx: DbClient) {
    return tx.payout.updateMany({
      where: { orderId },
      data: { status: "PROCESSING", initiatedAt: new Date() },
    });
  },

  async markListingSold(listingId: string, tx: DbClient) {
    return tx.listing.update({
      where: { id: listingId },
      data: { status: "SOLD", soldAt: new Date() },
    });
  },

  async reactivateListingInTx(listingId: string, tx: DbClient) {
    return tx.listing.updateMany({
      where: { id: listingId, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
  },

  async createStripeEvent(id: string, type: string): Promise<void> {
    await db.stripeEvent.create({ data: { id, type } });
  },

  async deleteStripeEvent(id: string): Promise<void> {
    await db.stripeEvent.delete({ where: { id } });
  },

  async updatePayoutByTransferId(transferId: string): Promise<void> {
    await db.payout.updateMany({
      where: { stripeTransferId: transferId },
      data: { status: "PROCESSING" },
    });
  },

  async updateOtpJobId(orderId: string, otpJobId: string): Promise<void> {
    await db.order.update({
      where: { id: orderId },
      data: { otpJobId },
    });
  },

  async $transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T> {
    return options !== undefined
      ? db.$transaction(fn, options)
      : db.$transaction(fn);
  },

  createEvent(data: Prisma.OrderEventUncheckedCreateInput, tx?: DbClient) {
    const client = getClient(tx);
    return client.orderEvent.create({ data });
  },

  async updateStatusOptimistic(
    id: string,
    currentStatus: string,
    newStatus: string,
    data: Record<string, unknown>,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.order.updateMany({
      where: {
        id,
        status: currentStatus as Prisma.OrderGetPayload<
          Record<string, unknown>
        >["status"],
      },
      data: {
        status: newStatus as Prisma.OrderGetPayload<
          Record<string, unknown>
        >["status"],
        ...data,
      },
    });
  },

  async attachPaymentIntent(id: string, piId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.order.update({
      where: { id },
      data: { stripePaymentIntentId: piId },
    });
  },

  async createInTx(data: Prisma.OrderUncheckedCreateInput, tx: DbClient) {
    return tx.order.create({ data, select: { id: true } });
  },

  async setStripePaymentIntentId(
    id: string,
    stripePaymentIntentId: string,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.order.update({
      where: { id },
      data: { stripePaymentIntentId },
    });
  },

  async reserveListing(listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    const now = new Date();
    const reservedUntil = new Date(now.getTime() + 10 * 60 * 1000);
    return client.listing.updateMany({
      where: {
        id: listingId,
        OR: [
          { status: "ACTIVE" },
          { status: "RESERVED", reservedUntil: { lt: now } },
        ],
      },
      data: { status: "RESERVED", reservedUntil },
    });
  },

  async releaseListing(listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: { id: listingId, status: "RESERVED" },
      data: { status: "ACTIVE", reservedUntil: null },
    });
  },

  async updateScheduleDeadlineJobId(
    orderId: string,
    jobId: string,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.order.update({
      where: { id: orderId },
      data: { scheduleDeadlineJobId: jobId },
    });
  },

  async updatePickupFields(
    id: string,
    data: Prisma.OrderUncheckedUpdateInput,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.order.update({ where: { id }, data });
  },

  setPickupWindowJobId(id: string, jobId: string): void {
    fireAndForget(
      db.order.update({ where: { id }, data: { pickupWindowJobId: jobId } }),
      "order.pickup.set_window_job_id",
      { orderId: id, jobId },
    );
  },

  async updateOrderEventMetadata(
    eventId: string,
    metadata: Prisma.InputJsonValue,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.orderEvent.update({
      where: { id: eventId },
      data: { metadata },
    });
  },

  async upsertPickupPayoutProcessing(
    orderId: string,
    sellerId: string,
    amountNzd: number,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.payout.upsert({
      where: { orderId },
      create: {
        orderId,
        userId: sellerId,
        amountNzd,
        platformFeeNzd: 0,
        stripeFeeNzd: 0,
        status: "PROCESSING",
        initiatedAt: new Date(),
      },
      update: {
        status: "PROCESSING",
        initiatedAt: new Date(),
      },
    });
  },
};
