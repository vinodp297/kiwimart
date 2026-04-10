"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/cart.ts
// ─── Shopping Cart Server Actions ────────────────────────────────────────────

import { requireUser } from "@/server/lib/requireUser";
import { logger } from "@/shared/logger";
import { rateLimit } from "@/server/lib/rateLimit";
import { cartService } from "@/modules/cart/cart.service";
import type { CartData, DriftedItem } from "@/modules/cart/cart.service";
import type { ActionResult } from "@/types";
import {
  addToCartSchema as AddToCartSchema,
  removeFromCartSchema as RemoveFromCartSchema,
  checkoutCartSchema as CheckoutCartSchema,
} from "@/server/validators";
import { withActionContext } from "@/lib/action-context";

// Re-export types for consumers that import from this file
export type { CartData, DriftedItem };
export type { CartItemData } from "@/modules/cart/cart.service";

// ── addToCart ────────────────────────────────────────────────────────────────

export async function addToCart(
  raw: unknown,
): Promise<ActionResult<{ cartItemCount: number }>> {
  return withActionContext(async () => {
    try {
      const user = await requireUser();

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

      const result = await cartService.addToCart(
        user.id,
        parsed.data.listingId,
      );
      if (!result.ok) {
        return { success: false, error: result.error };
      }
      return { success: true, data: result.data };
    } catch (err) {
      logger.error("cart.add_to_cart.unhandled_error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        success: false,
        error: safeActionError(
          err,
          "We couldn't add this item to your cart. Please try again.",
        ),
      };
    }
  }); // end withActionContext
}

// ── removeFromCart ───────────────────────────────────────────────────────────

export async function removeFromCart(
  raw: unknown,
): Promise<ActionResult<{ cartItemCount: number }>> {
  return withActionContext(async () => {
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

      const result = await cartService.removeFromCart(
        user.id,
        parsed.data.listingId,
      );
      if (!result.ok) {
        return { success: false, error: result.error };
      }
      return { success: true, data: result.data };
    } catch (err) {
      return {
        success: false,
        error: safeActionError(
          err,
          "We couldn't remove this item from your cart. Please try again.",
        ),
      };
    }
  }); // end withActionContext
}

// ── clearCart ────────────────────────────────────────────────────────────────

export async function clearCart(): Promise<ActionResult<void>> {
  return withActionContext(async () => {
    try {
      const user = await requireUser();

      const limit = await rateLimit("cart", user.id);
      if (!limit.success) {
        return {
          success: false,
          error: "Too many cart actions. Please wait a moment.",
        };
      }

      await cartService.clearCart(user.id);
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
  }); // end withActionContext
}

// ── getCart ──────────────────────────────────────────────────────────────────

export async function getCart(): Promise<ActionResult<CartData | null>> {
  return withActionContext(async () => {
    try {
      const user = await requireUser();
      const data = await cartService.getCart(user.id);
      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: safeActionError(
          err,
          "We couldn't update your cart. Please try again.",
        ),
      };
    }
  }); // end withActionContext
}

// ── getCartCount ────────────────────────────────────────────────────────────

export async function getCartCount(): Promise<ActionResult<number>> {
  return withActionContext(async () => {
    try {
      const user = await requireUser();
      const count = await cartService.getCartCount(user.id);
      return { success: true, data: count };
    } catch (err) {
      return {
        success: false,
        error: safeActionError(
          err,
          "We couldn't update the cart quantity. Please try again.",
        ),
      };
    }
  }); // end withActionContext
}

// ── checkoutCart ─────────────────────────────────────────────────────────────

export type CheckoutResult =
  | { success: true; data: { orderId: string; clientSecret: string } }
  | {
      success: false;
      error: string;
      requiresPriceConfirmation?: true;
      driftedItems?: DriftedItem[];
    };

export async function checkoutCart(raw: unknown): Promise<CheckoutResult> {
  return withActionContext(async () => {
    try {
      const user = await requireUser();

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

      const result = await cartService.checkoutCart(
        user.id,
        user.email,
        parsed.data,
      );
      if (!result.ok) {
        return {
          success: false,
          error: result.error,
          ...(result.requiresPriceConfirmation
            ? {
                requiresPriceConfirmation: true,
                driftedItems: result.driftedItems,
              }
            : {}),
        };
      }
      return { success: true, data: result.data };
    } catch (err) {
      return {
        success: false,
        error: safeActionError(
          err,
          "Checkout failed. Please try again or contact support if the problem persists.",
        ),
      };
    }
  }); // end withActionContext
}
