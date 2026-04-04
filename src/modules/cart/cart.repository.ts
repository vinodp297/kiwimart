// src/modules/cart/cart.repository.ts
// ─── Cart Repository — data access only, no business logic ──────────────────

import db from "@/lib/db";
import { Prisma } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof db;

export const cartRepository = {
  // ── Cart queries ──────────────────────────────────────────────────────────

  async findByUser(userId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        sellerId: true,
        items: { select: { listingId: true } },
      },
    });
  },

  async findByUserForDisplay(userId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        sellerId: true,
        expiresAt: true,
        items: {
          select: {
            id: true,
            listingId: true,
            priceNzd: true,
            shippingNzd: true,
            listing: {
              select: {
                title: true,
                status: true,
                deletedAt: true,
                priceNzd: true,
                shippingNzd: true,
                shippingOption: true,
                images: {
                  where: { order: 0 },
                  select: { r2Key: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
  },

  async findByUserForCheckout(userId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        sellerId: true,
        expiresAt: true,
        items: {
          select: {
            id: true,
            listingId: true,
            priceNzd: true,
            shippingNzd: true,
            listing: {
              select: {
                id: true,
                title: true,
                priceNzd: true,
                shippingNzd: true,
                shippingOption: true,
                status: true,
                sellerId: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });
  },

  async findByUserCount(userId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.cart.findUnique({
      where: { userId },
      select: {
        expiresAt: true,
        _count: { select: { items: true } },
      },
    });
  },

  async findByUserWithItems(userId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.cart.findUnique({
      where: { userId },
      select: { id: true, items: { select: { id: true, listingId: true } } },
    });
  },

  // ── Cart mutations ────────────────────────────────────────────────────────

  async createCart(
    data: {
      userId: string;
      sellerId: string;
      expiresAt: Date;
      listingId: string;
      priceNzd: number;
      shippingNzd: number;
    },
    tx?: DbClient,
  ) {
    const client = tx ?? db;
    return client.cart.create({
      data: {
        userId: data.userId,
        sellerId: data.sellerId,
        expiresAt: data.expiresAt,
        items: {
          create: {
            listingId: data.listingId,
            priceNzd: data.priceNzd,
            shippingNzd: data.shippingNzd,
          },
        },
      },
      select: { items: { select: { id: true } } },
    });
  },

  async addItemToCart(
    cartId: string,
    item: { listingId: string; priceNzd: number; shippingNzd: number },
    expiresAt: Date,
    tx?: DbClient,
  ) {
    const client = tx ?? db;
    return client.cart.update({
      where: { id: cartId },
      data: {
        expiresAt,
        items: {
          create: {
            listingId: item.listingId,
            priceNzd: item.priceNzd,
            shippingNzd: item.shippingNzd,
          },
        },
      },
    });
  },

  async deleteCart(cartId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.cart.delete({ where: { id: cartId } });
  },

  async deleteCartByUser(userId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.cart.deleteMany({ where: { userId } });
  },

  async removeItemAndExtendExpiry(
    itemId: string,
    cartId: string,
    expiresAt: Date,
    tx?: DbClient,
  ) {
    const client = tx ?? db;
    return client.$transaction([
      client.cartItem.delete({ where: { id: itemId } }),
      client.cart.update({
        where: { id: cartId },
        data: { expiresAt },
      }),
    ]);
  },

  // ── Checkout: order creation ──────────────────────────────────────────────

  async findIdempotentOrder(
    idempotencyKey: string,
    buyerId: string,
    tx?: DbClient,
  ) {
    const client = tx ?? db;
    return client.order.findFirst({
      where: { idempotencyKey, buyerId },
      select: { id: true, status: true, stripePaymentIntentId: true },
    });
  },

  async reserveListings(listingIds: string[], tx?: DbClient) {
    const client = tx ?? db;
    return client.listing.updateMany({
      where: { id: { in: listingIds }, status: "ACTIVE" },
      data: { status: "RESERVED" },
    });
  },

  async releaseListings(listingIds: string[], tx?: DbClient) {
    const client = tx ?? db;
    return client.listing.updateMany({
      where: { id: { in: listingIds }, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
  },

  async createOrder(data: Prisma.OrderUncheckedCreateInput, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.create({ data, select: { id: true } });
  },

  async updateOrderStripePI(
    orderId: string,
    stripePaymentIntentId: string,
    tx?: DbClient,
  ) {
    const client = tx ?? db;
    return client.order.update({
      where: { id: orderId },
      data: { stripePaymentIntentId },
    });
  },

  async findOrderStripePI(orderId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.order.findUnique({
      where: { id: orderId },
      select: { stripePaymentIntentId: true },
    });
  },

  async findBuyerDisplayName(userId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
  },

  // ── Listing lookup (for addToCart) ────────────────────────────────────────

  async findListingForCart(listingId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.listing.findUnique({
      where: { id: listingId, status: "ACTIVE", deletedAt: null },
      select: {
        id: true,
        title: true,
        priceNzd: true,
        shippingNzd: true,
        shippingOption: true,
        sellerId: true,
      },
    });
  },

  // ── Transaction ───────────────────────────────────────────────────────────

  async $transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return db.$transaction(fn);
  },
};
