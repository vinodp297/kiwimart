// src/modules/cart/cart.service.ts
// ─── Cart Service ────────────────────────────────────────────────────────────
// Shopping cart business logic. Single-seller cart: all items must belong to
// the same seller. Prices are snapshotted at add-time, re-validated at checkout.

import { audit } from "@/server/lib/audit";
import { formatCentsAsNzd } from "@/lib/currency";
import { logger } from "@/shared/logger";
import { createNotification } from "@/modules/notifications/notification.service";
import { fireAndForget } from "@/lib/fire-and-forget";
import { paymentService } from "@/modules/payments/payment.service";
import { sendOrderConfirmationEmail } from "@/server/email";
import { transitionOrder } from "@/modules/orders/order.transitions";
import { captureListingSnapshot } from "@/server/services/listing-snapshot.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { stripe } from "@/infrastructure/stripe/client";
import { userRepository } from "@/modules/users/user.repository";
import { CONFIG_KEYS, getConfigInt } from "@/lib/platform-config";
import { MS_PER_HOUR, SECONDS_PER_WEEK } from "@/lib/time";
import { getImageUrl } from "@/lib/image";
import { cartRepository } from "./cart.repository";
import { getRedisClient } from "@/infrastructure/redis/client";

// ── Constants ────────────────────────────────────────────────────────────────
const CART_REDIS_TTL = SECONDS_PER_WEEK; // 7 days in seconds

// Redis is a best-effort cache for the active-cart session pointer.
// If Upstash is not configured or unreachable, cart operations must still
// succeed (the cart itself lives in Postgres). All Redis writes/reads go
// through this helper so a Redis outage never breaks `addToCart`.
async function safeRedisSet(key: string, value: string): Promise<void> {
  try {
    await getRedisClient().set(key, value, { ex: CART_REDIS_TTL });
  } catch (err) {
    console.error("[cart] redis set failed (non-fatal)", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function safeRedisDel(key: string): Promise<void> {
  try {
    await getRedisClient().del(key);
  } catch (err) {
    console.error("[cart] redis del failed (non-fatal)", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface CartData {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerUsername: string;
  expiresAt: string;
  items: CartItemData[];
  subtotalNzd: number;
  shippingNzd: number;
  totalNzd: number;
}

export interface CartItemData {
  id: string;
  listingId: string;
  title: string;
  thumbnailUrl: string;
  priceNzd: number;
  shippingNzd: number;
  status: string;
  isAvailable: boolean;
}

export interface DriftedItem {
  listingId: string;
  title: string;
  oldPriceNzd: number;
  newPriceNzd: number;
  differenceNzd: number;
}

import type { ServiceResult as BaseServiceResult } from "@/shared/types/service-result";

// Extends the shared ServiceResult with cart-specific failure metadata
type ServiceResult<T> =
  | Extract<BaseServiceResult<T>, { ok: true }>
  | (Extract<BaseServiceResult<T>, { ok: false }> & {
      requiresPriceConfirmation?: true;
      driftedItems?: DriftedItem[];
    });

function r2Url(key: string | null): string {
  return getImageUrl(key);
}

export class CartService {
  // ── addToCart ────────────────────────────────────────────────────────────

  async addToCart(
    userId: string,
    listingId: string,
  ): Promise<ServiceResult<{ cartItemCount: number }>> {
    const cartExpiryHours = await getConfigInt(CONFIG_KEYS.CART_EXPIRY_HOURS);
    const CART_EXPIRY_MS = cartExpiryHours * MS_PER_HOUR;

    const listing = await cartRepository.findListingForCart(listingId);
    if (!listing) {
      return { ok: false, error: "Listing is not available." };
    }

    if (listing.sellerId === userId) {
      return {
        ok: false,
        error: "You cannot add your own listing to your cart.",
      };
    }

    const shippingNzd =
      listing.shippingOption === "PICKUP" ? 0 : (listing.shippingNzd ?? 0);

    const existingCart = await cartRepository.findByUser(userId);

    if (existingCart) {
      if (existingCart.sellerId !== listing.sellerId) {
        return { ok: false, error: "SELLER_MISMATCH" };
      }

      if (existingCart.items.some((item) => item.listingId === listingId)) {
        return { ok: false, error: "This item is already in your cart." };
      }

      await cartRepository.addItemToCart(
        existingCart.id,
        {
          listingId,
          priceNzd: listing.priceNzd,
          shippingNzd,
          snapshotPriceNzd: listing.priceNzd,
        },
        new Date(Date.now() + CART_EXPIRY_MS),
      );

      await safeRedisSet(`cart:active:${userId}`, existingCart.id);

      return {
        ok: true,
        data: { cartItemCount: existingCart.items.length + 1 },
      };
    }

    const newCart = await cartRepository.createCart({
      userId,
      sellerId: listing.sellerId,
      expiresAt: new Date(Date.now() + CART_EXPIRY_MS),
      listingId,
      priceNzd: listing.priceNzd,
      shippingNzd,
      snapshotPriceNzd: listing.priceNzd,
    });

    await safeRedisSet(`cart:active:${userId}`, newCart.id);

    return { ok: true, data: { cartItemCount: newCart.items.length } };
  }

  // ── removeFromCart ──────────────────────────────────────────────────────

  async removeFromCart(
    userId: string,
    listingId: string,
  ): Promise<ServiceResult<{ cartItemCount: number }>> {
    const cartExpiryHours = await getConfigInt(CONFIG_KEYS.CART_EXPIRY_HOURS);
    const CART_EXPIRY_MS = cartExpiryHours * MS_PER_HOUR;

    const cart = await cartRepository.findByUserWithItems(userId);
    if (!cart) {
      return { ok: false, error: "Cart not found." };
    }

    const itemToRemove = cart.items.find((i) => i.listingId === listingId);
    if (!itemToRemove) {
      return { ok: false, error: "Item not in cart." };
    }

    if (cart.items.length === 1) {
      await cartRepository.deleteCart(cart.id);
      return { ok: true, data: { cartItemCount: 0 } };
    }

    await cartRepository.removeItemAndExtendExpiry(
      itemToRemove.id,
      cart.id,
      new Date(Date.now() + CART_EXPIRY_MS),
    );

    await safeRedisSet(`cart:active:${userId}`, cart.id);

    return { ok: true, data: { cartItemCount: cart.items.length - 1 } };
  }

  // ── clearCart ──────────────────────────────────────────────────────────

  async clearCart(userId: string): Promise<void> {
    await cartRepository.deleteCartByUser(userId);
    await safeRedisDel(`cart:active:${userId}`);
  }

  // ── getCart ────────────────────────────────────────────────────────────

  async getCart(userId: string): Promise<CartData | null> {
    const cart = await cartRepository.findByUserForDisplay(userId);
    if (!cart) return null;

    if (new Date(cart.expiresAt) < new Date()) {
      await cartRepository.deleteCart(cart.id);
      return null;
    }

    const seller = await userRepository.findDisplayInfo(cart.sellerId);

    const items: CartItemData[] = cart.items.map((item) => {
      const isAvailable =
        item.listing.status === "ACTIVE" && !item.listing.deletedAt;
      return {
        id: item.id,
        listingId: item.listingId,
        title: item.listing.title,
        thumbnailUrl: r2Url(item.listing.images[0]?.r2Key ?? null),
        priceNzd: item.priceNzd,
        shippingNzd: item.shippingNzd,
        status: item.listing.status,
        isAvailable,
      };
    });

    const subtotalNzd = items.reduce((sum, i) => sum + i.priceNzd, 0);
    const shippingNzd = items.reduce((sum, i) => sum + i.shippingNzd, 0);

    return {
      id: cart.id,
      sellerId: cart.sellerId,
      sellerName: seller?.displayName ?? "Unknown Seller",
      sellerUsername: seller?.username ?? "",
      expiresAt: cart.expiresAt.toISOString(),
      items,
      subtotalNzd,
      shippingNzd,
      totalNzd: subtotalNzd + shippingNzd,
    };
  }

  // ── getCartCount ──────────────────────────────────────────────────────

  async getCartCount(userId: string): Promise<number> {
    const cart = await cartRepository.findByUserCount(userId);
    if (!cart || new Date(cart.expiresAt) < new Date()) {
      return 0;
    }
    return cart._count.items;
  }

  // ── checkoutCart ──────────────────────────────────────────────────────

  async checkoutCart(
    userId: string,
    userEmail: string,
    input: {
      idempotencyKey?: string;
      shippingAddress?: {
        name: string;
        line1: string;
        line2?: string;
        city: string;
        region: string;
        postcode: string;
      };
      confirmedPriceVersion?: boolean;
    },
  ): Promise<ServiceResult<{ orderId: string; clientSecret: string }>> {
    const { idempotencyKey, shippingAddress, confirmedPriceVersion } = input;

    // Idempotency check
    if (idempotencyKey) {
      const existingOrder = await cartRepository.findIdempotentOrder(
        idempotencyKey,
        userId,
      );
      if (
        existingOrder &&
        existingOrder.status === "AWAITING_PAYMENT" &&
        existingOrder.stripePaymentIntentId
      ) {
        const clientSecret = await paymentService.getClientSecret(
          existingOrder.stripePaymentIntentId,
        );
        if (clientSecret) {
          return {
            ok: true,
            data: { orderId: existingOrder.id, clientSecret },
          };
        }
      }
    }

    // Load cart
    const cart = await cartRepository.findByUserForCheckout(userId);
    if (!cart || cart.items.length === 0) {
      return { ok: false, error: "Your cart is empty." };
    }

    if (new Date(cart.expiresAt) < new Date()) {
      await cartRepository.deleteCart(cart.id);
      await safeRedisDel(`cart:active:${userId}`);
      return {
        ok: false,
        error: "Your cart has expired. Please add items again.",
      };
    }

    // Re-validate items
    const unavailable: string[] = [];
    for (const item of cart.items) {
      if (item.listing.status !== "ACTIVE" || item.listing.deletedAt) {
        unavailable.push(item.listing.title);
      }
      if (item.listing.sellerId !== cart.sellerId) {
        return {
          ok: false,
          error: "Cart contains items from different sellers.",
        };
      }
    }

    if (unavailable.length > 0) {
      return {
        ok: false,
        error: `The following items are no longer available: ${unavailable.join(", ")}. Please remove them from your cart.`,
      };
    }

    // ── Price drift detection ──────────────────────────────────────────────
    // Compare snapshotPriceNzd (captured at add-time) with current listing price.
    // If any item has drifted, update the snapshot to the current price and
    // return a requiresPriceConfirmation response. On re-submit with
    // confirmedPriceVersion=true, drift is re-checked to prevent race conditions.
    const driftedItems: DriftedItem[] = [];
    for (const item of cart.items) {
      if (item.snapshotPriceNzd !== item.listing.priceNzd) {
        driftedItems.push({
          listingId: item.listingId,
          title: item.listing.title,
          oldPriceNzd: item.snapshotPriceNzd,
          newPriceNzd: item.listing.priceNzd,
          differenceNzd: item.listing.priceNzd - item.snapshotPriceNzd,
        });
      }
    }

    if (driftedItems.length > 0) {
      // Update snapshots to current prices so the next confirmation check
      // compares against the prices shown in the modal
      await cartRepository.updateItemSnapshots(
        driftedItems.map((d) => {
          const cartItem = cart.items.find((i) => i.listingId === d.listingId)!;
          return {
            itemId: cartItem.id,
            snapshotPriceNzd: d.newPriceNzd,
            priceNzd: d.newPriceNzd,
          };
        }),
      );

      return {
        ok: false,
        error: "Prices have changed since you added items to your cart.",
        requiresPriceConfirmation: true,
        driftedItems,
      };
    }

    // Verify seller Stripe setup
    const seller = await userRepository.findWithStripe(cart.sellerId);
    if (!seller?.stripeAccountId || !seller.isStripeOnboarded) {
      return {
        ok: false,
        error:
          "This seller has not completed payment setup. Contact them directly.",
      };
    }

    const isRealConnectAccount =
      typeof seller.stripeAccountId === "string" &&
      /^acct_[A-Za-z0-9]{16,}$/.test(seller.stripeAccountId);

    if (!isRealConnectAccount) {
      return {
        ok: false,
        error: "Seller payment account is not properly configured.",
      };
    }

    // Calculate totals from snapshot prices (confirmed by buyer)
    let totalItemNzd = 0;
    let totalShippingNzd = 0;
    const orderItemsData: Array<{
      listingId: string;
      priceNzd: number;
      shippingNzd: number;
      title: string;
    }> = [];

    for (const item of cart.items) {
      const currentShipping =
        item.listing.shippingOption === "PICKUP"
          ? 0
          : (item.listing.shippingNzd ?? 0);
      totalItemNzd += item.snapshotPriceNzd;
      totalShippingNzd += currentShipping;
      orderItemsData.push({
        listingId: item.listing.id,
        priceNzd: item.snapshotPriceNzd,
        shippingNzd: currentShipping,
        title: item.listing.title,
      });
    }

    const totalNzd = totalItemNzd + totalShippingNzd;
    const listingIds = cart.items.map((i) => i.listingId);

    // Reserve all listings atomically
    const reservation = await cartRepository.reserveListings(listingIds);

    if (reservation.count !== listingIds.length) {
      await cartRepository.releaseListings(listingIds);
      return {
        ok: false,
        error: "Some items are no longer available. Please refresh your cart.",
      };
    }

    // Create order + capture snapshots in transaction
    const order = await cartRepository.$transaction(async (tx) => {
      const created = await cartRepository.createOrder(
        {
          buyerId: userId,
          sellerId: cart.sellerId,
          listingId: cart.items[0]?.listingId ?? "",
          itemNzd: totalItemNzd,
          shippingNzd: totalShippingNzd,
          totalNzd,
          status: "AWAITING_PAYMENT",
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(shippingAddress
            ? {
                shippingName: shippingAddress.name,
                shippingLine1: shippingAddress.line1,
                shippingLine2: shippingAddress.line2,
                shippingCity: shippingAddress.city,
                shippingRegion: shippingAddress.region,
                shippingPostcode: shippingAddress.postcode,
              }
            : {}),
          items: {
            create: orderItemsData,
          },
        } as Parameters<typeof cartRepository.createOrder>[0],
        tx,
      );

      await Promise.all(
        cart.items.map((item) =>
          captureListingSnapshot(created.id, item.listingId, tx),
        ),
      );

      return created;
    });

    // Create Stripe PaymentIntent
    try {
      const itemTitles = orderItemsData.map((i) => i.title).join(", ");
      const paymentResult = await paymentService.createPaymentIntent({
        amountNzd: totalNzd,
        sellerId: cart.sellerId,
        sellerStripeAccountId: seller.stripeAccountId!,
        orderId: order.id,
        listingId: cart.items[0]?.listingId ?? "",
        listingTitle:
          itemTitles.length > 200
            ? itemTitles.slice(0, 197) + "..."
            : itemTitles,
        buyerId: userId,
        metadata: {
          cartId: cart.id,
          itemCount: String(cart.items.length),
        },
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });

      await cartRepository.updateOrderStripePI(
        order.id,
        paymentResult.paymentIntentId,
      );

      // Audit (fire-and-forget)
      audit({
        userId,
        action: "CART_CHECKOUT",
        entityType: "Order",
        entityId: order.id,
        metadata: {
          cartId: cart.id,
          itemCount: cart.items.length,
          totalNzd,
          listingIds,
        },
      });

      orderEventService.recordEvent({
        orderId: order.id,
        type: ORDER_EVENT_TYPES.ORDER_CREATED,
        actorId: userId,
        actorRole: ACTOR_ROLES.BUYER,
        summary: `Cart order placed — ${cart.items.length} item(s), ${formatCentsAsNzd(totalNzd)}`,
        metadata: { cartId: cart.id, itemCount: cart.items.length, totalNzd },
      });

      // Notify seller (fire-and-forget)
      fireAndForget(
        cartRepository.findBuyerDisplayName(userId).then((buyer) => {
          const buyerName = buyer?.displayName ?? "A buyer";
          fireAndForget(
            createNotification({
              userId: cart.sellerId,
              type: "ORDER_PLACED",
              title: "New cart order received!",
              body: `${buyerName} purchased ${cart.items.length} item(s) for ${formatCentsAsNzd(totalNzd)}`,
              orderId: order.id,
              link: "/dashboard/seller?tab=orders",
            }),
            "cart.checkout.notify.seller",
            { orderId: order.id, sellerId: cart.sellerId },
          );
          fireAndForget(
            sendOrderConfirmationEmail({
              to: userEmail,
              buyerName,
              sellerName: seller.displayName ?? "the seller",
              listingTitle: `${cart.items.length} items`,
              totalNzd,
              orderId: order.id,
              listingId: cart.items[0]?.listingId ?? "",
            }),
            "cart.checkout.email.confirmation",
            { orderId: order.id },
          );
        }),
        "cart.checkout.buyerLookup",
        { orderId: order.id, userId },
      );

      await safeRedisDel(`cart:active:${userId}`);

      logger.info("cart.checkout.success", {
        userId,
        orderId: order.id,
        cartId: cart.id,
        itemCount: cart.items.length,
        totalNzd,
      });

      return {
        ok: true,
        data: { orderId: order.id, clientSecret: paymentResult.clientSecret },
      };
    } catch (stripeErr) {
      // Cleanup: cancel orphan PI if it exists
      try {
        const orphanOrder = await cartRepository.findOrderStripePI(order.id);
        if (orphanOrder?.stripePaymentIntentId) {
          await stripe.paymentIntents.cancel(orphanOrder.stripePaymentIntentId);
          logger.info("cart.checkout.orphan_pi.cancelled", {
            orderId: order.id,
            paymentIntentId: orphanOrder.stripePaymentIntentId,
          });
        }
      } catch (cancelErr) {
        logger.warn("cart.checkout.orphan_pi.cancel_failed", {
          orderId: order.id,
          error:
            cancelErr instanceof Error ? cancelErr.message : String(cancelErr),
        });
      }

      // Cancel order
      await transitionOrder(
        order.id,
        "CANCELLED",
        {},
        { fromStatus: "AWAITING_PAYMENT" },
      );

      // Release reserved listings
      await cartRepository.releaseListings(listingIds).catch((err: unknown) => {
        logger.error("cart.checkout.releaseListings.failed", {
          error: err instanceof Error ? err.message : String(err),
          orderId: order.id,
          listingIds,
        });
      });

      orderEventService.recordEvent({
        orderId: order.id,
        type: ORDER_EVENT_TYPES.CANCELLED,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary: "Cart order cancelled: payment setup failed",
        metadata: { trigger: "STRIPE_CREATION_FAILED", cartId: cart.id },
      });

      logger.error("cart.checkout.failed", {
        orderId: order.id,
        cartId: cart.id,
        error:
          stripeErr instanceof Error ? stripeErr.message : String(stripeErr),
      });

      return { ok: false, error: "Payment setup failed. Please try again." };
    }
  }
}

export const cartService = new CartService();
