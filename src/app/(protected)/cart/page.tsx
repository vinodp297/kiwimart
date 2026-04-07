"use client";
// src/app/(protected)/cart/page.tsx
// ─── Shopping Cart Page ──────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getCart,
  removeFromCart,
  clearCart,
  checkoutCart,
} from "@/server/actions/cart";
import type { CartData, DriftedItem } from "@/server/actions/cart";
import { Alert, Button } from "@/components/ui/primitives";

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ── Price Change Modal ──────────────────────────────────────────────────────

function PriceChangeModal({
  driftedItems,
  onAccept,
  onCancel,
  accepting,
}: {
  driftedItems: DriftedItem[];
  onAccept: () => void;
  onCancel: () => void;
  accepting: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[#E3E0D9]">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#D4A843"
                strokeWidth="2"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-[#141414]">
                Prices have changed
              </h2>
              <p className="text-[13px] text-[#73706A]">
                {driftedItems.length} item
                {driftedItems.length !== 1 ? "s have" : " has"} a different
                price since you added{" "}
                {driftedItems.length !== 1 ? "them" : "it"} to your cart.
              </p>
            </div>
          </div>
        </div>

        {/* Drifted items list */}
        <div className="px-6 py-4 max-h-64 overflow-y-auto space-y-3">
          {driftedItems.map((item) => (
            <div
              key={item.listingId}
              className="flex items-center justify-between gap-3 text-[13px]"
            >
              <span className="text-[#141414] font-medium truncate flex-1">
                {item.title}
              </span>
              <div className="text-right shrink-0">
                <span className="line-through text-[#9E9A91] mr-2">
                  {formatPrice(item.oldPriceNzd)}
                </span>
                <span
                  className={
                    item.differenceNzd > 0
                      ? "text-red-600 font-semibold"
                      : "text-emerald-600 font-semibold"
                  }
                >
                  {formatPrice(item.newPriceNzd)}
                </span>
                <p className="text-[11px] mt-0.5">
                  {item.differenceNzd > 0 ? (
                    <span className="text-red-500">
                      +{formatPrice(item.differenceNzd)}
                    </span>
                  ) : (
                    <span className="text-emerald-600">
                      {formatPrice(item.differenceNzd)}
                    </span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-[#E3E0D9] flex gap-3">
          <button
            onClick={onCancel}
            disabled={accepting}
            className="flex-1 h-11 rounded-xl border border-[#E3E0D9] text-[14px] font-medium text-[#73706A]
              hover:bg-[#F8F7F4] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onAccept}
            disabled={accepting}
            className="flex-1 h-11 rounded-xl bg-[#D4A843] text-[#141414] text-[14px] font-semibold
              hover:bg-[#B8912E] hover:text-white transition-colors disabled:opacity-50"
          >
            {accepting ? "Processing..." : "Accept & checkout"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [priceModal, setPriceModal] = useState<{
    driftedItems: DriftedItem[];
    idempotencyKey: string;
  } | null>(null);
  const [acceptingPrices, setAcceptingPrices] = useState(false);

  const loadCart = useCallback(async () => {
    try {
      const result = await getCart();
      if (result.success) {
        setCart(result.data);
      } else {
        setError(result.error);
      }
    } catch {
      setError(
        "We couldn't load your cart. Please check your connection and refresh the page.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCart();
  }, [loadCart]);

  async function handleRemove(listingId: string) {
    setRemoving(listingId);
    setError("");
    try {
      const result = await removeFromCart({ listingId });
      if (result.success) {
        await loadCart();
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      setError("We couldn't remove that item. Please try again.");
    } finally {
      setRemoving(null);
    }
  }

  async function handleClear() {
    setClearing(true);
    setError("");
    try {
      const result = await clearCart();
      if (result.success) {
        setCart(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      setError("We couldn't clear your cart. Please try again.");
    } finally {
      setClearing(false);
    }
  }

  async function handleCheckout(confirmedPriceVersion?: boolean) {
    setCheckingOut(true);
    setError("");
    try {
      const idempotencyKey = `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await checkoutCart({
        idempotencyKey,
        ...(confirmedPriceVersion ? { confirmedPriceVersion: true } : {}),
      });
      if (result.success) {
        setPriceModal(null);
        router.push(
          `/checkout/${result.data.orderId}?clientSecret=${result.data.clientSecret}`,
        );
      } else if (
        "requiresPriceConfirmation" in result &&
        result.requiresPriceConfirmation &&
        result.driftedItems
      ) {
        setPriceModal({ driftedItems: result.driftedItems, idempotencyKey });
        await loadCart();
      } else {
        setError(result.error);
        await loadCart();
      }
    } catch {
      setError("Checkout failed. Please try again.");
    } finally {
      setCheckingOut(false);
    }
  }

  async function handleAcceptPrices() {
    setAcceptingPrices(true);
    setError("");
    try {
      const result = await checkoutCart({
        idempotencyKey: priceModal?.idempotencyKey,
        confirmedPriceVersion: true,
      });
      if (result.success) {
        setPriceModal(null);
        router.push(
          `/checkout/${result.data.orderId}?clientSecret=${result.data.clientSecret}`,
        );
      } else if (
        "requiresPriceConfirmation" in result &&
        result.requiresPriceConfirmation &&
        result.driftedItems
      ) {
        // Price changed again (race condition) — update modal
        setPriceModal({
          driftedItems: result.driftedItems,
          idempotencyKey: priceModal?.idempotencyKey ?? "",
        });
        await loadCart();
      } else {
        setPriceModal(null);
        setError(result.error);
        await loadCart();
      }
    } catch {
      setError("Checkout failed. Please try again.");
      setPriceModal(null);
    } finally {
      setAcceptingPrices(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF9F6]">
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-[#E3E0D9] rounded w-48" />
            <div className="h-24 bg-[#E3E0D9] rounded-xl" />
            <div className="h-24 bg-[#E3E0D9] rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="min-h-screen bg-[#FAF9F6]">
        <div className="max-w-3xl mx-auto px-4 py-12 text-center">
          <div className="w-20 h-20 rounded-full bg-[#F8F7F4] flex items-center justify-center mx-auto mb-6">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9E9A91"
              strokeWidth="1.5"
            >
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
          </div>
          <h1 className="font-[family-name:var(--font-playfair)] text-2xl font-bold text-[#141414] mb-2">
            Your cart is empty
          </h1>
          <p className="text-[14px] text-[#73706A] mb-6">
            Browse listings and add items to your cart to checkout multiple
            items from the same seller.
          </p>
          <Link href="/search">
            <Button variant="primary" size="md">
              Browse listings
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const availableItems = cart.items.filter((i) => i.isAvailable);
  const unavailableItems = cart.items.filter((i) => !i.isAvailable);
  const canCheckout =
    availableItems.length > 0 && unavailableItems.length === 0;

  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-[family-name:var(--font-playfair)] text-2xl font-bold text-[#141414]">
              Shopping Cart
            </h1>
            <p className="text-[13px] text-[#9E9A91] mt-1">
              {cart.items.length} item{cart.items.length !== 1 ? "s" : ""} from{" "}
              <Link
                href={`/seller/${cart.sellerUsername}`}
                className="text-[#D4A843] hover:underline font-medium"
              >
                {cart.sellerName}
              </Link>
            </p>
          </div>
          <button
            onClick={handleClear}
            disabled={clearing}
            className="text-[13px] text-[#73706A] hover:text-red-600 font-medium
              transition-colors disabled:opacity-50"
          >
            {clearing ? "Clearing..." : "Clear cart"}
          </button>
        </div>

        {error && (
          <div className="mb-4">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {/* Unavailable items warning */}
        {unavailableItems.length > 0 && (
          <div className="mb-4">
            <Alert variant="warning">
              {unavailableItems.length} item
              {unavailableItems.length !== 1 ? "s are" : " is"} no longer
              available. Please remove{" "}
              {unavailableItems.length !== 1 ? "them" : "it"} to proceed.
            </Alert>
          </div>
        )}

        {/* Cart items */}
        <div className="space-y-3 mb-6">
          {cart.items.map((item) => (
            <div
              key={item.id}
              className={`bg-white rounded-xl border p-4 flex items-center gap-4 transition-opacity
                ${item.isAvailable ? "border-[#E3E0D9]" : "border-red-200 bg-red-50/50 opacity-75"}`}
            >
              {/* Thumbnail */}
              <Link href={`/listings/${item.listingId}`} className="shrink-0">
                <img
                  src={item.thumbnailUrl}
                  alt={item.title}
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg object-cover"
                />
              </Link>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <Link
                  href={`/listings/${item.listingId}`}
                  className="text-[14px] font-semibold text-[#141414] hover:text-[#D4A843]
                    transition-colors line-clamp-1"
                >
                  {item.title}
                </Link>
                <p className="text-[13px] text-[#73706A] mt-0.5">
                  {formatPrice(item.priceNzd)}
                  {item.shippingNzd > 0 && (
                    <span className="text-[#9E9A91]">
                      {" "}
                      + {formatPrice(item.shippingNzd)} shipping
                    </span>
                  )}
                  {item.shippingNzd === 0 && (
                    <span className="text-emerald-600 ml-1">Free shipping</span>
                  )}
                </p>
                {!item.isAvailable && (
                  <p className="text-[12px] text-red-600 font-medium mt-1">
                    No longer available
                  </p>
                )}
              </div>

              {/* Price + remove */}
              <div className="text-right shrink-0">
                <p className="text-[15px] font-bold text-[#141414]">
                  {formatPrice(item.priceNzd + item.shippingNzd)}
                </p>
                <button
                  onClick={() => handleRemove(item.listingId)}
                  disabled={removing === item.listingId}
                  className="text-[12px] text-[#9E9A91] hover:text-red-600 font-medium
                    mt-1 transition-colors disabled:opacity-50"
                >
                  {removing === item.listingId ? "Removing..." : "Remove"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Order summary */}
        <div className="bg-white rounded-xl border border-[#E3E0D9] p-5">
          <h2 className="text-[15px] font-semibold text-[#141414] mb-4">
            Order Summary
          </h2>
          <div className="space-y-2 text-[13.5px]">
            <div className="flex justify-between text-[#73706A]">
              <span>
                Subtotal ({availableItems.length} item
                {availableItems.length !== 1 ? "s" : ""})
              </span>
              <span>{formatPrice(cart.subtotalNzd)}</span>
            </div>
            <div className="flex justify-between text-[#73706A]">
              <span>Shipping</span>
              <span>
                {cart.shippingNzd === 0 ? (
                  <span className="text-emerald-600 font-medium">Free</span>
                ) : (
                  formatPrice(cart.shippingNzd)
                )}
              </span>
            </div>
            <div className="border-t border-[#E3E0D9] pt-2 mt-2 flex justify-between">
              <span className="font-bold text-[#141414] text-[15px]">
                Total
              </span>
              <span className="font-bold text-[#141414] text-[15px]">
                {formatPrice(cart.totalNzd)} NZD
              </span>
            </div>
          </div>

          {/* Buyer Protection */}
          <div
            className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-200
            rounded-xl px-4 py-2.5 mt-4"
          >
            <svg
              className="shrink-0 text-emerald-600"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <p className="text-[12px] text-emerald-700">
              <span className="font-bold text-emerald-800">
                {process.env.NEXT_PUBLIC_BUYER_PROTECTION_DISPLAY ?? "$3,000"}{" "}
                Buyer Protection
              </span>{" "}
              — Payment held securely until you confirm delivery
            </p>
          </div>

          {/* Checkout button */}
          <button
            onClick={() => handleCheckout()}
            disabled={!canCheckout || checkingOut}
            className="w-full mt-4 min-h-[52px] bg-[#D4A843] hover:bg-[#B8912E]
              text-[#141414] font-semibold text-[15px] rounded-xl flex items-center
              justify-center gap-2 transition-colors disabled:opacity-50
              disabled:cursor-not-allowed"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {checkingOut
              ? "Processing..."
              : `Checkout — ${formatPrice(cart.totalNzd)}`}
          </button>

          <p className="text-center text-[11.5px] text-[#9E9A91] mt-3">
            Cart expires {new Date(cart.expiresAt).toLocaleString("en-NZ")}
          </p>
        </div>

        {/* Continue shopping */}
        <div className="text-center mt-6">
          <Link
            href={`/search?seller=${cart.sellerUsername}`}
            className="text-[13px] text-[#D4A843] hover:text-[#B8912E] font-medium transition-colors"
          >
            Continue shopping from {cart.sellerName}
          </Link>
        </div>
      </div>

      {/* Price change confirmation modal */}
      {priceModal && (
        <PriceChangeModal
          driftedItems={priceModal.driftedItems}
          onAccept={handleAcceptPrices}
          onCancel={() => setPriceModal(null)}
          accepting={acceptingPrices}
        />
      )}
    </div>
  );
}
