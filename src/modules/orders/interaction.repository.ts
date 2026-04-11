// src/modules/orders/interaction.repository.ts
// ─── Interaction Repository — data access for interaction server actions ─────

import { getClient, type DbClient } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const interactionRepository = {
  /** Fetch order context for any interaction workflow action (cancellation,
   * return, partial refund, delay, response). Superset of all per-action selects. */
  async findOrderForWorkflow(orderId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        createdAt: true,
        stripePaymentIntentId: true,
        totalNzd: true,
        listing: { select: { title: true } },
      },
    });
  },

  /** Fetch buyer and seller IDs for an order (party lookup / notifications). */
  async findOrderParties(orderId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.order.findUnique({
      where: { id: orderId },
      select: { buyerId: true, sellerId: true },
    });
  },

  async updateInteractionResolution(
    interactionId: string,
    resolution: string,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.orderInteraction.update({
      where: { id: interactionId },
      data: { resolvedAt: new Date(), resolution },
    });
  },

  async updateInteractionCounter(
    interactionId: string,
    details: Prisma.InputJsonValue,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.orderInteraction.update({
      where: { id: interactionId },
      data: { status: "COUNTERED", details },
    });
  },

  async findUserEmailInfo(userId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.user.findUnique({
      where: { id: userId },
      select: { email: true, displayName: true },
    });
  },

  // ── OrderInteractionService methods ─────────────────────────────────────

  /** Fetch order id/parties/status for interaction creation auth checks. */
  async findOrderForInteraction(orderId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.order.findUnique({
      where: { id: orderId },
      select: { id: true, buyerId: true, sellerId: true, status: true },
    });
  },

  /** Find an existing pending interaction of the same type on an order. */
  async findPendingByTypeAndOrder(
    orderId: string,
    type: string,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.orderInteraction.findFirst({
      where: { orderId, type, status: "PENDING" },
    });
  },

  /** Create a new order interaction. */
  async createInteraction(
    data: Prisma.OrderInteractionUncheckedCreateInput,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.orderInteraction.create({ data });
  },

  /** Fetch an interaction with its order parties for response auth checks. */
  async findByIdWithOrder(interactionId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.orderInteraction.findUnique({
      where: { id: interactionId },
      include: {
        order: {
          select: { id: true, buyerId: true, sellerId: true, status: true },
        },
      },
    });
  },

  /** Update an interaction record. */
  async updateInteraction(
    id: string,
    data: Prisma.OrderInteractionUncheckedUpdateInput,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.orderInteraction.update({ where: { id }, data });
  },

  /** Fetch active (pending) interactions for an order with party display info. */
  async findActiveByOrder(orderId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.orderInteraction.findMany({
      where: { orderId, status: { in: ["PENDING"] } },
      orderBy: { createdAt: "desc" },
      include: {
        initiator: { select: { id: true, displayName: true, username: true } },
        responder: { select: { id: true, displayName: true, username: true } },
      },
    });
  },

  /** Count buyer interactions on an order prior to a given date (for auto-resolution). */
  async countPriorBuyerInteractions(
    orderId: string,
    buyerId: string,
    before: Date,
    tx?: DbClient,
  ): Promise<number> {
    const client = getClient(tx);
    return client.orderInteraction.count({
      where: {
        orderId,
        initiatedById: buyerId,
        createdAt: { lt: before },
      },
    });
  },

  /** Find the latest rejected interaction by the seller (for auto-resolution). */
  async findRejectedByResponder(
    orderId: string,
    sellerId: string,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.orderInteraction.findFirst({
      where: { orderId, status: "REJECTED", responseById: sellerId },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Find expired PENDING interactions with autoAction=AUTO_ESCALATE (cron). */
  async findExpiredAutoEscalate(now: Date, take: number, tx?: DbClient) {
    const client = getClient(tx);
    return client.orderInteraction.findMany({
      where: {
        status: "PENDING",
        expiresAt: { lte: now },
        autoAction: "AUTO_ESCALATE",
      },
      take,
      include: {
        order: {
          select: {
            id: true,
            buyerId: true,
            sellerId: true,
            status: true,
            listing: { select: { title: true } },
          },
        },
        initiator: { select: { displayName: true } },
      },
    });
  },

  /** Bulk-mark interactions as ESCALATED with the given resolvedAt. */
  async bulkMarkEscalated(ids: string[], resolvedAt: Date, tx?: DbClient) {
    const client = getClient(tx);
    return client.orderInteraction.updateMany({
      where: { id: { in: ids } },
      data: { status: "ESCALATED", resolvedAt },
    });
  },

  /** Fetch all interactions for an order with party display info. */
  async findAllByOrder(orderId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.orderInteraction.findMany({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      include: {
        initiator: { select: { id: true, displayName: true, username: true } },
        responder: { select: { id: true, displayName: true, username: true } },
      },
    });
  },
};
