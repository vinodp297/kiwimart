"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/cart.ts
// ─── Shopping Cart Server Actions ────────────────────────────────────────────
// Single-seller cart: all items must belong to the same seller.
// Prices are snapshotted at add-time, re-validated at checkout.
// Cart expires 48 hours after last update.

import { requireUser } from "@/server/lib/requireUser";
import { rateLimit } from "@/server/lib/rateLimit";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { createNotification } from "@/modules/notifications/notification.service";
import { paymentService } from "@/modules/payments/payment.service";
import { sendOrderConfirmationEmail } from "@/server/email";
import { transitionOrder } from "@/modules/orders/order.transitions";
import { stripe } from "@/infrastructure/stripe/client";
import db from "@/lib/db";
import { getImageUrl } from "@/lib/image";
import type { ActionResult } from "@/types";
import { z } from "zod";

// ── Constants ────────────────────────────────────────────────────────────────

const CART_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours

// ── Types ────────────────────────────────────────────────────────────────────

export interface CartData {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerUsername: string;
  expiresAt: string;
  items: CartItemData[];
  subtotalNzd: number; // cents
  shippingNzd: number; // cents
  totalNzd: number; // cents
}

export interface CartItemData {
  id: string;
  listingId: string;
  title: string;
  thumbnailUrl: string;
  priceNzd: number; // cents
  shippingNzd: number; // cents
  status: string; // listing status (for availability checks)
  isAvailable: boolean;
}

// ── Helper: R2 URL ───────────────────────────────────────────────────────────

function r2Url(key: string | null): string {
  return getImageUrl(key);
}

// ── addToCart ────────────────────────────────────────────────────────────────

const AddToCartSchema = z.object({
  listingId: z.string().min(1, "Listing ID is required"),
});

export async function addToCart(
  raw: unknown,
): Promise<ActionResult<{ cartItemCount: number }>> {
  try {
    const user = await requireUser();

    // Rate limit
    const limit = await rateLimit("cart", user.id);
    if (!limit.success) {
      return {
        success: false,
        error: "Too many cart actions. Please wait a moment.",
      };
    }

    const parsed = AddToCartSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const { listingId } = parsed.data;

    // Load listing
    const listing = await db.listing.findUnique({
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

    if (!listing) {
      return { success: false, error: "Listing is not available." };
    }

    // Cannot add own listing
    if (listing.sellerId === user.id) {
      return {
        success: false,
        error: "You cannot add your own listing to your cart.",
      };
    }

    const shippingNzd =
      listing.shippingOption === "PICKUP" ? 0 : (listing.shippingNzd ?? 0);

    // Check existing cart
    const existingCart = await db.cart.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        sellerId: true,
        items: { select: { listingId: true } },
      },
    });

    if (existingCart) {
      // Single-seller constraint
      if (existingCart.sellerId !== listing.sellerId) {
        return {
          success: false,
          error: "SELLER_MISMATCH",
        };
      }

      // Check if already in cart
      if (existingCart.items.some((item) => item.listingId === listingId)) {
        return { success: false, error: "This item is already in your cart." };
      }

      // Add item and extend expiry
      await db.cart.update({
        where: { id: existingCart.id },
        data: {
          expiresAt: new Date(Date.now() + CART_EXPIRY_MS),
          items: {
            create: {
              listingId,
              priceNzd: listing.priceNzd,
              shippingNzd,
            },
          },
        },
      });

      const itemCount = existingCart.items.length + 1;
      return { success: true, data: { cartItemCount: itemCount } };
    }

    // Create new cart
    const newCart = await db.cart.create({
      data: {
        userId: user.id,
        sellerId: listing.sellerId,
        expiresAt: new Date(Date.now() + CART_EXPIRY_MS),
        items: {
          create: {
            listingId,
            priceNzd: listing.priceNzd,
            shippingNzd,
          },
        },
      },
      select: { items: { select: { id: true } } },
    });

    return { success: true, data: { cartItemCount: newCart.items.length } };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't add this item to your cart. Please try again.",
      ),
    };
  }
}

// ── removeFromCart ───────────────────────────────────────────────────────────

const RemoveFromCartSchema = z.object({
  listingId: z.string().min(1, "Listing ID is required"),
});

export async function removeFromCart(
  raw: unknown,
): Promise<ActionResult<{ cartItemCount: number }>> {
  try {
    const user = await requireUser();

    const limit = await rateLimit("cart", user.id);
    if (!limit.success) {
      return {
        success: false,
        error: "Too many cart actions. Please wait a moment.",
      };
    }

    const parsed = RemoveFromCartSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const cart = await db.cart.findUnique({
      where: { userId: user.id },
      select: { id: true, items: { select: { id: true, listingId: true } } },
    });

    if (!cart) {
      return { success: false, error: "Cart not found." };
    }

    const itemToRemove = cart.items.find(
      (i) => i.listingId === parsed.data.listingId,
    );
    if (!itemToRemove) {
      return { success: false, error: "Item not in cart." };
    }

    // If this is the last item, delete the entire cart
    if (cart.items.length === 1) {
      await db.cart.delete({ where: { id: cart.id } });
      return { success: true, data: { cartItemCount: 0 } };
    }

    // Remove item and extend expiry
    await db.$transaction([
      db.cartItem.delete({ where: { id: itemToRemove.id } }),
      db.cart.update({
        where: { id: cart.id },
        data: { expiresAt: new Date(Date.now() + CART_EXPIRY_MS) },
      }),
    ]);

    return { success: true, data: { cartItemCount: cart.items.length - 1 } };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't remove this item from your cart. Please try again.",
      ),
    };
  }
}

// ── clearCart ────────────────────────────────────────────────────────────────

export async function clearCart(): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    const limit = await rateLimit("cart", user.id);
    if (!limit.success) {
      return {
        success: false,
        error: "Too many cart actions. Please wait a moment.",
      };
    }

    // Delete cart (cascade deletes items)
    await db.cart.deleteMany({ where: { userId: user.id } });
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't clear your cart. Please try again.",
      ),
    };
  }
}

// ── getCart ──────────────────────────────────────────────────────────────────

export async function getCart(): Promise<ActionResult<CartData | null>> {
  try {
    const user = await requireUser();

    const cart = await db.cart.findUnique({
      where: { userId: user.id },
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

    if (!cart) {
      return { success: true, data: null };
    }

    // Check if cart expired
    if (new Date(cart.expiresAt) < new Date()) {
      await db.cart.delete({ where: { id: cart.id } });
      return { success: true, data: null };
    }

    // Load seller info
    const seller = await db.user.findUnique({
      where: { id: cart.sellerId },
      select: { displayName: true, username: true },
    });

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
      success: true,
      data: {
        id: cart.id,
        sellerId: cart.sellerId,
        sellerName: seller?.displayName ?? "Unknown Seller",
        sellerUsername: seller?.username ?? "",
        expiresAt: cart.expiresAt.toISOString(),
        items,
        subtotalNzd,
        shippingNzd,
        totalNzd: subtotalNzd + shippingNzd,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't update your cart. Please try again.",
      ),
    };
  }
}

// ── getCartCount — lightweight count for NavBar badge ────────────────────────

export async function getCartCount(): Promise<ActionResult<number>> {
  try {
    const user = await requireUser();

    const cart = await db.cart.findUnique({
      where: { userId: user.id },
      select: {
        expiresAt: true,
        _count: { select: { items: true } },
      },
    });

    if (!cart || new Date(cart.expiresAt) < new Date()) {
      return { success: true, data: 0 };
    }

    return { success: true, data: cart._count.items };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't update the cart quantity. Please try again.",
      ),
    };
  }
}

// ── checkoutCart ─────────────────────────────────────────────────────────────
// Re-validates all items, reserves listings atomically, creates order + PI.

const CheckoutCartSchema = z.object({
  idempotencyKey: z.string().max(128).optional(),
  shippingAddress: z
    .object({
      name: z.string().min(2, "Name is required").max(100),
      line1: z.string().min(5, "Street address is required").max(200),
      line2: z.string().max(200).optional(),
      city: z.string().min(2, "City is required").max(100),
      region: z.string().min(2, "Region is required").max(100),
      postcode: z.string().regex(/^\d{4}$/, "Invalid NZ postcode"),
    })
    .optional(),
});

export async function checkoutCart(
  raw: unknown,
): Promise<ActionResult<{ orderId: string; clientSecret: string }>> {
  try {
    const user = await requireUser();

    // Rate limit — use order limiter for checkout (stricter)
    const limit = await rateLimit("order", user.id);
    if (!limit.success) {
      return {
        success: false,
        error: "Too many checkout attempts. Please wait before trying again.",
      };
    }

    const parsed = CheckoutCartSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const idempotencyKey = parsed.data.idempotencyKey;

    // Idempotency check
    if (idempotencyKey) {
      const existingOrder = await db.order.findFirst({
        where: { idempotencyKey, buyerId: user.id },
        select: { id: true, status: true, stripePaymentIntentId: true },
      });
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
            success: true,
            data: { orderId: existingOrder.id, clientSecret },
          };
        }
      }
    }

    // Load cart with items
    const cart = await db.cart.findUnique({
      where: { userId: user.id },
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

    if (!cart || cart.items.length === 0) {
      return { success: false, error: "Your cart is empty." };
    }

    // Check expiry
    if (new Date(cart.expiresAt) < new Date()) {
      await db.cart.delete({ where: { id: cart.id } });
      return {
        success: false,
        error: "Your cart has expired. Please add items again.",
      };
    }

    // Re-validate all items at checkout
    const unavailable: string[] = [];
    for (const item of cart.items) {
      if (item.listing.status !== "ACTIVE" || item.listing.deletedAt) {
        unavailable.push(item.listing.title);
      }
      if (item.listing.sellerId !== cart.sellerId) {
        // Shouldn't happen, but guard
        return {
          success: false,
          error: "Cart contains items from different sellers.",
        };
      }
    }

    if (unavailable.length > 0) {
      return {
        success: false,
        error: `The following items are no longer available: ${unavailable.join(", ")}. Please remove them from your cart.`,
      };
    }

    // Load seller Stripe info
    const seller = await db.user.findUnique({
      where: { id: cart.sellerId },
      select: {
        stripeAccountId: true,
        stripeOnboarded: true,
        displayName: true,
        email: true,
      },
    });

    if (!seller?.stripeAccountId || !seller.stripeOnboarded) {
      return {
        success: false,
        error:
          "This seller has not completed payment setup. Contact them directly.",
      };
    }

    const isRealConnectAccount =
      typeof seller.stripeAccountId === "string" &&
      /^acct_[A-Za-z0-9]{16,}$/.test(seller.stripeAccountId);

    if (!isRealConnectAccount) {
      return {
        success: false,
        error: "Seller payment account is not properly configured.",
      };
    }

    // Calculate totals from CURRENT DB prices (not snapshot prices)
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
      totalItemNzd += item.listing.priceNzd;
      totalShippingNzd += currentShipping;
      orderItemsData.push({
        listingId: item.listing.id,
        priceNzd: item.listing.priceNzd,
        shippingNzd: currentShipping,
        title: item.listing.title,
      });
    }

    const totalNzd = totalItemNzd + totalShippingNzd;

    // Atomically reserve ALL listings — if any fail, none are reserved
    const listingIds = cart.items.map((i) => i.listingId);

    const reservation = await db.listing.updateMany({
      where: { id: { in: listingIds }, status: "ACTIVE" },
      data: { status: "RESERVED" },
    });

    if (reservation.count !== listingIds.length) {
      // Rollback: restore any that were reserved
      await db.listing.updateMany({
        where: { id: { in: listingIds }, status: "RESERVED" },
        data: { status: "ACTIVE" },
      });
      return {
        success: false,
        error: "Some items are no longer available. Please refresh your cart.",
      };
    }

    // Create order with order items (use first listing as the primary listingId for backward compat)
    const order = await db.order.create({
      data: {
        buyerId: user.id,
        sellerId: cart.sellerId,
        listingId: cart.items[0]?.listingId ?? "",
        itemNzd: totalItemNzd,
        shippingNzd: totalShippingNzd,
        totalNzd,
        status: "AWAITING_PAYMENT",
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(parsed.data.shippingAddress
          ? {
              shippingName: parsed.data.shippingAddress.name,
              shippingLine1: parsed.data.shippingAddress.line1,
              shippingLine2: parsed.data.shippingAddress.line2,
              shippingCity: parsed.data.shippingAddress.city,
              shippingRegion: parsed.data.shippingAddress.region,
              shippingPostcode: parsed.data.shippingAddress.postcode,
            }
          : {}),
        items: {
          create: orderItemsData,
        },
      },
      select: { id: true },
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
        buyerId: user.id,
        metadata: {
          cartId: cart.id,
          itemCount: String(cart.items.length),
        },
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });

      // Persist PI ID
      await db.order.update({
        where: { id: order.id },
        data: { stripePaymentIntentId: paymentResult.paymentIntentId },
      });

      // Audit
      audit({
        userId: user.id,
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

      // Notify seller (fire-and-forget)
      db.user
        .findUnique({ where: { id: user.id }, select: { displayName: true } })
        .then((buyer) => {
          const buyerName = buyer?.displayName ?? "A buyer";
          createNotification({
            userId: cart.sellerId,
            type: "ORDER_PLACED",
            title: "New cart order received!",
            body: `${buyerName} purchased ${cart.items.length} item(s) for $${(totalNzd / 100).toFixed(2)} NZD`,
            orderId: order.id,
            link: "/dashboard/seller?tab=orders",
          }).catch(() => {});
          sendOrderConfirmationEmail({
            to: user.email,
            buyerName,
            sellerName: seller.displayName ?? "the seller",
            listingTitle: `${cart.items.length} items`,
            totalNzd,
            orderId: order.id,
            listingId: cart.items[0]?.listingId ?? "",
          }).catch(() => {});
        })
        .catch(() => {});

      // NOTE: Cart is NOT cleared here — it's cleared after webhook confirms payment.
      // This prevents loss of cart data if the user abandons checkout.

      logger.info("cart.checkout.success", {
        userId: user.id,
        orderId: order.id,
        cartId: cart.id,
        itemCount: cart.items.length,
        totalNzd,
      });

      return {
        success: true,
        data: { orderId: order.id, clientSecret: paymentResult.clientSecret },
      };
    } catch (stripeErr) {
      // Cleanup: cancel orphan PI if it exists
      try {
        const orphanOrder = await db.order.findUnique({
          where: { id: order.id },
          select: { stripePaymentIntentId: true },
        });
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

      // Release all reserved listings
      await db.listing
        .updateMany({
          where: { id: { in: listingIds }, status: "RESERVED" },
          data: { status: "ACTIVE" },
        })
        .catch(() => {});

      logger.error("cart.checkout.failed", {
        orderId: order.id,
        cartId: cart.id,
        error:
          stripeErr instanceof Error ? stripeErr.message : String(stripeErr),
      });

      return {
        success: false,
        error: "Payment setup failed. Please try again.",
      };
    }
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "Checkout failed. Please try again or contact support if the problem persists.",
      ),
    };
  }
}
