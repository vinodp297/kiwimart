"use client";
// src/app/(public)/listings/[id]/ListingActions.tsx
// Price + CTA panel. Handles: Buy Now, Make Offer modal, watchlist toggle, share.
// Sprint 3: calls will be replaced with server actions (createOrder, createOffer,
// toggleWatch) — component API stays identical.

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSessionSafe } from "@/hooks/useSessionSafe";
import type { ListingDetail } from "@/types";
import { formatPrice } from "@/lib/utils";
import {
  Button,
  ConditionBadge,
  Alert,
  Input,
} from "@/components/ui/primitives";
import { addToCart } from "@/server/actions/cart";
import { toggleWatch } from "@/server/actions/listings";
import { createOffer } from "@/server/actions/offers";
import EmailVerificationModal from "@/components/EmailVerificationModal";

interface Props {
  listing: ListingDetail;
  initialWatched?: boolean;
  offerMinPercentage?: number;
}

export default function ListingActions({
  listing,
  initialWatched = false,
  offerMinPercentage = 50,
}: Props) {
  const [watched, setWatched] = useState(initialWatched);
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerAmount, setOfferAmount] = useState("");
  const [offerNote, setOfferNote] = useState("");
  const [offerSubmitted, setOfferSubmitted] = useState(false);
  const [offerError, setOfferError] = useState("");
  const [shareTooltip, setShareTooltip] = useState(false);
  const [offerLoading, setOfferLoading] = useState(false);
  const [cartLoading, setCartLoading] = useState(false);
  const [cartMessage, setCartMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const pendingAction = useRef<"watch" | "cart" | null>(null);
  const { data: session, status: sessionStatus } = useSessionSafe();
  const router = useRouter();

  const isSold = listing.status === "sold";
  const shipping = listing.shippingPrice;

  async function handleOfferSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sessionStatus !== "authenticated") {
      router.push(`/login?from=/listings/${listing.id}`);
      return;
    }
    if (!session?.user?.emailVerified) {
      pendingAction.current = null;
      setVerifyModalOpen(true);
      return;
    }
    const amount = Number(offerAmount);
    if (!amount || amount <= 0) {
      setOfferError("Please enter a valid offer amount.");
      return;
    }
    if (amount >= listing.price) {
      setOfferError(
        'Your offer must be less than the asking price. Use "Buy Now" instead.',
      );
      return;
    }
    if (amount < listing.price * (offerMinPercentage / 100)) {
      setOfferError(
        `Offers below ${offerMinPercentage}% of the asking price are not accepted.`,
      );
      return;
    }
    setOfferError("");
    setOfferLoading(true);
    try {
      const result = await createOffer({
        listingId: listing.id,
        amount,
        note: offerNote || undefined,
      });
      if (result.success) {
        setOfferSubmitted(true);
      } else {
        setOfferError(
          result.error ?? "Your offer couldn't be submitted. Please try again.",
        );
      }
    } catch {
      setOfferError(
        "Your offer couldn't be submitted. Please check your connection and try again.",
      );
    } finally {
      setOfferLoading(false);
    }
  }

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: listing.title, url });
    } else {
      await navigator.clipboard.writeText(url);
      setShareTooltip(true);
      setTimeout(() => setShareTooltip(false), 2000);
    }
  }

  function requireVerifiedEmail(action: "watch" | "cart"): boolean {
    if (sessionStatus !== "authenticated") {
      router.push(`/login?from=/listings/${listing.id}`);
      return false;
    }
    if (!session?.user?.emailVerified) {
      pendingAction.current = action;
      setVerifyModalOpen(true);
      return false;
    }
    return true;
  }

  function handleVerified() {
    setVerifyModalOpen(false);
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action === "watch") doToggleWatch();
    else if (action === "cart") doAddToCart();
  }

  async function doToggleWatch() {
    setWatched((w) => !w);
    const result = await toggleWatch({ listingId: listing.id });
    if (!result.success) setWatched((w) => !w);
  }

  async function doAddToCart() {
    setCartLoading(true);
    setCartMessage(null);
    try {
      const result = await addToCart({ listingId: listing.id });
      if (result.success) {
        setCartMessage({ type: "success", text: "Added to cart!" });
        router.refresh();
      } else if (result.error === "SELLER_MISMATCH") {
        setCartMessage({
          type: "error",
          text: "Your cart contains items from a different seller. Clear your cart first or checkout the existing items.",
        });
      } else {
        setCartMessage({ type: "error", text: result.error });
      }
    } catch {
      setCartMessage({
        type: "error",
        text: "Something went wrong. Please try again.",
      });
    } finally {
      setCartLoading(false);
    }
  }

  function handleAddToCart() {
    if (!requireVerifiedEmail("cart")) return;
    doAddToCart();
  }

  return (
    <>
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5 md:p-6 sticky top-[88px]">
        {/* Price row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p
              className="font-[family-name:var(--font-playfair)] text-[2rem]
                font-bold text-[#141414] leading-none tracking-tight"
            >
              {formatPrice(listing.price)}
              <span className="text-[14px] font-normal text-[#9E9A91] ml-1.5">
                NZD
              </span>
            </p>
            {listing.gstIncluded && (
              <p className="text-[11px] text-[#9E9A91] mt-1">GST included</p>
            )}
          </div>
          <ConditionBadge condition={listing.condition} size="md" />
        </div>

        {/* Shipping info */}
        <div className="flex items-center gap-2 mb-4 text-[12.5px] text-[#73706A]">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="1" y="3" width="15" height="13" />
            <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
            <circle cx="5.5" cy="18.5" r="2.5" />
            <circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
          {listing.shippingOption === "pickup" ? (
            <span>
              Pickup only ·{" "}
              {listing.pickupAddress ?? `${listing.suburb}, ${listing.region}`}
            </span>
          ) : shipping === 0 || shipping === null ? (
            <span className="text-emerald-600 font-semibold">
              Free shipping
            </span>
          ) : (
            <span>+{formatPrice(shipping)} shipping</span>
          )}
        </div>

        {/* Location */}
        <div className="flex items-center gap-2 mb-5 text-[12.5px] text-[#9E9A91]">
          <svg
            width="12"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          {listing.suburb}, {listing.region}
        </div>

        {isSold ? (
          <div className="space-y-3">
            <div
              className="w-full py-3 rounded-xl bg-[#F8F7F4] border border-[#E3E0D9]
              text-center text-[13.5px] font-semibold text-[#9E9A91]"
            >
              This item has been sold
            </div>
            <Link href={`/search?category=${listing.categoryName}`}>
              <Button variant="secondary" fullWidth size="md">
                Find similar items
              </Button>
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Buyer Protection Badge */}
            <div
              className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-200
              rounded-xl px-4 py-2.5"
            >
              <svg
                className="shrink-0 text-emerald-600"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              <div>
                <p className="text-[12.5px] font-bold text-emerald-800 leading-tight">
                  {process.env.NEXT_PUBLIC_BUYER_PROTECTION_DISPLAY ?? "$3,000"}{" "}
                  Buyer Protection
                </p>
                <p className="text-[11px] text-emerald-700 leading-tight">
                  Payment held securely until you confirm delivery
                </p>
              </div>
            </div>

            {/* Buy Now */}
            <Link href={`/checkout/${listing.id}`}>
              <button
                className="w-full min-h-[52px] bg-[#D4A843] hover:bg-[#B8912E]
                  text-[#141414] font-semibold text-[15px] rounded-xl flex items-center
                  justify-center gap-2 transition-colors"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
                Buy now — {formatPrice(listing.price)}
              </button>
            </Link>

            {/* Add to Cart */}
            <button
              onClick={handleAddToCart}
              disabled={cartLoading}
              className="w-full min-h-[52px] border-2 border-[#C9C5BC]
                hover:border-[#141414] text-[#141414] font-semibold text-[15px]
                rounded-xl flex items-center justify-center gap-2 transition-colors
                bg-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
              {cartLoading ? "Adding..." : "Add to cart"}
            </button>

            {/* Cart feedback message */}
            {cartMessage && (
              <Alert
                variant={cartMessage.type === "success" ? "success" : "error"}
              >
                {cartMessage.text}
              </Alert>
            )}

            {/* Make Offer */}
            {listing.offersEnabled && (
              <button
                onClick={() => setOfferOpen(true)}
                className="w-full min-h-[52px] border-2 border-[#C9C5BC]
                  hover:border-[#141414] text-[#141414] font-semibold text-[15px]
                  rounded-xl flex items-center justify-center transition-colors bg-white"
              >
                Make an offer
              </button>
            )}

            {/* Watch + Share row */}
            <div className="border-t border-[#E3E0D9] pt-4 mt-1">
              <div className="flex items-center justify-around">
                <button
                  onClick={() => {
                    if (!requireVerifiedEmail("watch")) return;
                    doToggleWatch();
                  }}
                  aria-pressed={watched}
                  className="flex items-center gap-2 px-6 py-3 text-[#73706A]
                    hover:text-[#141414] transition-colors text-[14px] font-medium"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill={watched ? "#D4A843" : "none"}
                    stroke={watched ? "#D4A843" : "currentColor"}
                    strokeWidth="2"
                  >
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  {watched ? "Watching" : "Watch"}
                </button>

                <div className="relative">
                  <button
                    onClick={handleShare}
                    aria-label="Share listing"
                    className="flex items-center gap-2 px-6 py-3 text-[#73706A]
                      hover:text-[#141414] transition-colors text-[14px] font-medium"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="18" cy="5" r="3" />
                      <circle cx="6" cy="12" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    </svg>
                    Share
                  </button>
                  {shareTooltip && (
                    <div
                      className="absolute -top-9 left-1/2 -translate-x-1/2
                      bg-[#141414] text-white text-[11px] px-2.5 py-1.5 rounded-lg
                      whitespace-nowrap shadow-lg"
                    >
                      Link copied!
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Email Verification Modal ──────────────────────────────────────── */}
      <EmailVerificationModal
        open={verifyModalOpen}
        onClose={() => {
          setVerifyModalOpen(false);
          pendingAction.current = null;
        }}
        onVerified={handleVerified}
      />

      {/* ── Make Offer Modal ───────────────────────────────────────────────── */}
      {offerOpen && (
        <div
          className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm
            flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="offer-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOfferOpen(false);
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E3E0D9]">
              <h2
                id="offer-modal-title"
                className="font-[family-name:var(--font-playfair)] text-[1.15rem]
                  font-semibold text-[#141414]"
              >
                Make an offer
              </h2>
              <button
                onClick={() => {
                  setOfferOpen(false);
                  setOfferSubmitted(false);
                  setOfferError("");
                }}
                aria-label="Close"
                className="w-8 h-8 rounded-full bg-[#F8F7F4] flex items-center
                  justify-center hover:bg-[#EFEDE8] transition-colors"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5">
              {offerSubmitted ? (
                <div className="text-center py-6">
                  <div
                    className="w-14 h-14 rounded-full bg-emerald-50 flex items-center
                      justify-center mx-auto mb-4"
                  >
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#16a34a"
                      strokeWidth="2.5"
                    >
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-[#141414] mb-1.5">
                    Offer sent!
                  </h3>
                  <p className="text-[13px] text-[#73706A] max-w-xs mx-auto">
                    Your offer of{" "}
                    <strong className="text-[#141414]">
                      {formatPrice(Number(offerAmount))}
                    </strong>{" "}
                    has been sent to the seller. You&apos;ll be notified when
                    they respond.
                  </p>
                  <Button
                    variant="secondary"
                    size="md"
                    className="mt-5"
                    onClick={() => {
                      setOfferOpen(false);
                      setOfferSubmitted(false);
                    }}
                  >
                    Done
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleOfferSubmit} noValidate>
                  {/* Listing summary */}
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-[#F8F7F4] border border-[#E3E0D9] mb-5">
                    <img
                      src={listing.thumbnailUrl}
                      alt={listing.title}
                      className="w-12 h-12 rounded-lg object-cover shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-[#141414] truncate">
                        {listing.title}
                      </p>
                      <p className="text-[12px] text-[#9E9A91]">
                        Asking price:{" "}
                        <strong>{formatPrice(listing.price)}</strong>
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <Input
                      label="Your offer"
                      type="number"
                      value={offerAmount}
                      onChange={(e) => {
                        setOfferAmount(e.target.value);
                        setOfferError("");
                      }}
                      placeholder={Math.round(listing.price * 0.9).toString()}
                      min={1}
                      max={listing.price - 1}
                      required
                      leftAddon={<span className="text-[13px]">$</span>}
                      hint={`Seller is asking ${formatPrice(listing.price)}. Reasonable offers considered.`}
                      error={offerError}
                    />

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[12.5px] font-semibold text-[#141414]">
                        Note to seller{" "}
                        <span className="text-[#9E9A91] font-normal">
                          (optional)
                        </span>
                      </label>
                      <textarea
                        value={offerNote}
                        onChange={(e) => setOfferNote(e.target.value)}
                        placeholder="e.g. Can do pickup this weekend..."
                        maxLength={300}
                        rows={3}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC]
                          bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC]
                          outline-none focus:ring-2 focus:ring-[#D4A843]/25
                          focus:border-[#D4A843] resize-none transition"
                      />
                    </div>

                    <Alert variant="info">
                      Your offer is binding if accepted. You&apos;ll have 24
                      hours to complete payment via{" "}
                      {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}&apos;s
                      secure escrow.
                    </Alert>

                    <Button
                      type="submit"
                      variant="gold"
                      fullWidth
                      size="md"
                      loading={offerLoading}
                      disabled={offerLoading}
                    >
                      {offerLoading ? "Sending..." : "Send offer"}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
