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
};
