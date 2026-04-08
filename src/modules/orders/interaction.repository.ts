// src/modules/orders/interaction.repository.ts
// ─── Interaction Repository — data access for interaction server actions ─────

import db from "@/lib/db";
import { Prisma } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof db;

export const interactionRepository = {
  async findOrderForCancellation(orderId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        createdAt: true,
        stripePaymentIntentId: true,
        listing: { select: { title: true } },
      },
    });
  },

  async findOrderForReturn(orderId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        listing: { select: { title: true } },
      },
    });
  },

  async findOrderForPartialRefund(orderId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        totalNzd: true,
        listing: { select: { title: true } },
      },
    });
  },

  async findOrderForDelay(orderId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        listing: { select: { title: true } },
      },
    });
  },

  async findOrderAfterResponse(orderId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        stripePaymentIntentId: true,
        listing: { select: { title: true } },
      },
    });
  },

  async findOrderListingTitle(orderId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id: orderId },
      select: { listing: { select: { title: true } } },
    });
  },

  async findOrderBuyerId(orderId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id: orderId },
      select: { buyerId: true, sellerId: true },
    });
  },

  async findOrderParties(orderId: string, tx?: DbClient) {
    const client = tx ?? db;
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
    const client = tx ?? db;
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
    const client = tx ?? db;
    return client.orderInteraction.update({
      where: { id: interactionId },
      data: { status: "COUNTERED", details },
    });
  },

  async findUserEmailInfo(userId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.user.findUnique({
      where: { id: userId },
      select: { email: true, displayName: true },
    });
  },

  // ── OrderInteractionService methods ─────────────────────────────────────

  /** Fetch order id/parties/status for interaction creation auth checks.
   * @source src/modules/orders/order-interaction.service.ts — createInteraction */
  async findOrderForInteraction(orderId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id: orderId },
      select: { id: true, buyerId: true, sellerId: true, status: true },
    });
  },

  /** Find an existing pending interaction of the same type on an order.
   * @source src/modules/orders/order-interaction.service.ts — createInteraction */
  async findPendingByTypeAndOrder(
    orderId: string,
    type: string,
    tx?: DbClient,
  ) {
    const client = tx ?? db;
    return client.orderInteraction.findFirst({
      where: { orderId, type, status: "PENDING" },
    });
  },

  /** Create a new order interaction.
   * @source src/modules/orders/order-interaction.service.ts — createInteraction */
  async createInteraction(
    data: Prisma.OrderInteractionUncheckedCreateInput,
    tx?: DbClient,
  ) {
    const client = tx ?? db;
    return client.orderInteraction.create({ data });
  },

  /** Fetch an interaction with its order parties for response auth checks.
   * @source src/modules/orders/order-interaction.service.ts — respondToInteraction */
  async findByIdWithOrder(interactionId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.orderInteraction.findUnique({
      where: { id: interactionId },
      include: {
        order: {
          select: { id: true, buyerId: true, sellerId: true, status: true },
        },
      },
    });
  },

  /** Update an interaction record.
   * @source src/modules/orders/order-interaction.service.ts — respondToInteraction */
  async updateInteraction(
    id: string,
    data: Prisma.OrderInteractionUncheckedUpdateInput,
    tx?: DbClient,
  ) {
    const client = tx ?? db;
    return client.orderInteraction.update({ where: { id }, data });
  },

  /** Fetch active (pending) interactions for an order with party display info.
   * @source src/modules/orders/order-interaction.service.ts — getActiveInteractions */
  async findActiveByOrder(orderId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.orderInteraction.findMany({
      where: { orderId, status: { in: ["PENDING"] } },
      orderBy: { createdAt: "desc" },
      include: {
        initiator: { select: { id: true, displayName: true, username: true } },
        responder: { select: { id: true, displayName: true, username: true } },
      },
    });
  },

  /** Count buyer interactions on an order prior to a given date (for auto-resolution).
   * @source src/modules/disputes/auto-resolution.service.ts — evaluateDispute */
  async countPriorBuyerInteractions(
    orderId: string,
    buyerId: string,
    before: Date,
    tx?: DbClient,
  ): Promise<number> {
    const client = tx ?? db;
    return client.orderInteraction.count({
      where: {
        orderId,
        initiatedById: buyerId,
        createdAt: { lt: before },
      },
    });
  },

  /** Find the latest rejected interaction by the seller (for auto-resolution).
   * @source src/modules/disputes/auto-resolution.service.ts — evaluateDispute */
  async findRejectedByResponder(
    orderId: string,
    sellerId: string,
    tx?: DbClient,
  ) {
    const client = tx ?? db;
    return client.orderInteraction.findFirst({
      where: { orderId, status: "REJECTED", responseById: sellerId },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Fetch all interactions for an order with party display info.
   * @source src/modules/orders/order-interaction.service.ts — getInteractionsByOrder */
  async findAllByOrder(orderId: string, tx?: DbClient) {
    const client = tx ?? db;
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
